import { google } from "googleapis";
import { findAccountById, findParentLinkByConnectToken, rememberParentUser } from "../db/accounts.js";
import { createUser, findUserByConnectToken, findUserByPhone, listGmailUsers, saveUser } from "../db/users.js";
import { encryptToken } from "./tokens.js";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
// OAuth state for a link made on the account site. A bare state is the user's own connect token.
const PARENT_STATE = "p.";

type ConnectResult = { status: number; html: string };

export function oauthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirect) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirect);
}

export async function revokeGmail(refreshToken: string): Promise<void> {
  const client = oauthClient();
  if (!client) return;
  await client.revokeToken(refreshToken);
}

/** `userToken` comes from an onboarding text (?u=), `parentToken` from the account site (?p=). */
export async function connectPage(userToken: string, parentToken = ""): Promise<ConnectResult> {
  if (parentToken) return parentConnectPage(parentToken);
  const user = await findUserByConnectToken(userToken);
  if (!user) return { status: 404, html: page("That connect link is not valid.") };
  if (!oauthClient()) return { status: 503, html: page("Gmail connect is not configured.") };
  const start = `/connect/gmail/start?u=${encodeURIComponent(userToken)}`;
  return {
    status: 200,
    html: page(
      `<p>ScamCheck will only read your email to look for scams. It does not store your messages.</p><p><a href="${start}">Connect Gmail</a></p>`,
    ),
  };
}

async function parentConnectPage(token: string): Promise<ConnectResult> {
  const link = await findParentLinkByConnectToken(token);
  if (!link) return { status: 404, html: page("That connect link is not valid.") };
  if (!oauthClient() || !process.env.TOKEN_ENCRYPTION_KEY) {
    return { status: 503, html: page("Gmail connect is not configured.") };
  }
  const account = await findAccountById(link.accountId);
  return {
    status: 200,
    html: parentConsentHtml({
      accountName: account?.name || "Your family",
      email: link.email,
      phoneLast4: link.phone.replace(/\D/g, "").slice(-4),
      language: link.language,
      startUrl: `/connect/gmail/start?p=${encodeURIComponent(token)}`,
    }),
  };
}

export async function authRedirect(
  userToken: string,
  parentToken = "",
): Promise<{ location: string } | ConnectResult> {
  const client = oauthClient();
  if (!client) return { status: 503, html: page("Gmail connect is not configured.") };
  const options = { access_type: "offline", prompt: "consent", scope: [SCOPE] };
  if (!parentToken) {
    if (!userToken) return { status: 404, html: page("That connect link is not valid.") };
    return { location: client.generateAuthUrl({ ...options, state: userToken }) };
  }
  const link = await findParentLinkByConnectToken(parentToken);
  if (!link) return { status: 404, html: page("That connect link is not valid.") };
  return {
    location: client.generateAuthUrl({
      ...options,
      state: PARENT_STATE + parentToken,
      ...(link.email ? { login_hint: link.email } : {}),
    }),
  };
}

export async function finishConnect(code: string, state: string): Promise<ConnectResult> {
  if (state.startsWith(PARENT_STATE)) return finishParentConnect(code, state.slice(PARENT_STATE.length));
  const client = oauthClient();
  const user = await findUserByConnectToken(state);
  if (!client || !user || !code) return { status: 400, html: page("Gmail connect did not finish.") };
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) return { status: 400, html: page("Google did not return a refresh token. Try again.") };
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress;
  if (!email) return { status: 400, html: page("Google did not return an email address.") };
  await saveUser(user._id, {
    gmail: { email, refreshTokenEnc: encryptToken(tokens.refresh_token) },
  });
  return { status: 200, html: page("Gmail is connected. You can close this page.") };
}

/**
 * A parent signing in from their account-site link. Signing in is their consent.
 * Only the mailbox the account typed can connect, and it never replaces a different mailbox
 * already connected to that phone number.
 */
async function finishParentConnect(code: string, token: string): Promise<ConnectResult> {
  const client = oauthClient();
  const link = await findParentLinkByConnectToken(token);
  if (!client || !link || !code) return { status: 400, html: page("Gmail connect did not finish.") };
  const { tokens } = await client.getToken(code);
  const refreshToken = tokens.refresh_token;
  if (!refreshToken) return { status: 400, html: page("Google did not return a refresh token. Try again.") };
  if (typeof tokens.scope === "string" && !tokens.scope.split(" ").includes(SCOPE)) {
    return { status: 400, html: page("ScamCheck needs permission to read your email. Open the link again and allow it.") };
  }
  client.setCredentials(tokens);
  const profile = await google
    .gmail({ version: "v1", auth: client })
    .users.getProfile({ userId: "me" }, { timeout: 10_000 });
  const email = profile.data.emailAddress;
  if (!email) return { status: 400, html: page("Google did not return an email address.") };
  if (link.email && !sameMailbox(email, link.email)) {
    await discardToken(refreshToken, email);
    const expected = escapeHtml(link.email);
    return {
      status: 400,
      html: page(
        `<p>This link is for ${expected}, but you signed in with a different Google account.</p><p>Open the link again and choose ${expected}.</p>`,
      ),
    };
  }
  const user = (await findUserByPhone(link.phone)) ?? (await createUser(link.phone));
  if (user.gmail && !sameMailbox(user.gmail.email, email)) {
    await discardToken(refreshToken, email);
    return { status: 409, html: page("That phone number already has a different Gmail connected to ScamCheck.") };
  }
  const onboarding = user.onboardingStep === "language" || user.onboardingStep === "consent";
  await saveUser(user._id, {
    gmail: { email, refreshTokenEnc: encryptToken(refreshToken) },
    ...(user.consentAcceptedAt ? {} : { consentAcceptedAt: new Date() }),
    ...(onboarding ? { onboardingStep: "done" as const, displayName: user.displayName?.trim() || link.parentName } : {}),
    ...(user.onboardingStep === "language" ? { language: link.language } : {}),
  });
  await rememberParentUser(link.phone, user._id);
  const copy = consentCopy(link.language);
  return { status: 200, html: page(`<p>${escapeHtml(copy.connected)}</p>`, copy.lang) };
}

/** Gmail ignores dots and +tags, and googlemail.com is gmail.com. Other domains compare as typed. */
export function sameMailbox(a: string, b: string): boolean {
  return mailboxKey(a) === mailboxKey(b);
}

function mailboxKey(address: string): string {
  const value = address.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1) return value;
  let local = value.slice(0, at);
  let domain = value.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = (local.split("+")[0] ?? local).replace(/\./g, "");
  return `${local}@${domain}`;
}

// Revoking can drop ScamCheck's whole grant on that Google account, which would cut off
// another ScamCheck user who already connected the same mailbox.
async function discardToken(refreshToken: string, email: string): Promise<void> {
  try {
    const users = await listGmailUsers();
    if (users.some((user) => user.gmail && sameMailbox(user.gmail.email, email))) return;
    await revokeGmail(refreshToken);
  } catch (error) {
    console.error("gmail revoke failed error=" + (error as Error).name);
  }
}

interface ConsentCopy {
  title: string;
  yourGmail: string;
  intro: string;
  sharing: string;
  disclaimer: string;
  storage: string;
  agree: string;
  button: string;
  unverified: string;
  connected: string;
}

// Section 14 consent, worded for a button instead of a YES reply.
const CONSENT_COPY: Record<string, ConsentCopy> = {
  en: {
    title: "Connect your Gmail",
    yourGmail: "your Gmail",
    intro:
      "{name} added you to ScamCheck. ScamCheck reads new emails in {mailbox} only to look for scams. If one looks risky, it can call you at ···{last4}.",
    sharing: "{name} will see short warning summaries on the ScamCheck website, never your emails.",
    disclaimer:
      "ScamCheck is an automated tool that uses AI. It can miss scams and can flag real messages by mistake. It is not a guarantee and is not affiliated with any bank, company, or government agency. Always confirm by contacting the company directly, using the number on your card or their website. Never share codes or passwords.",
    storage: "We don't store your emails. You can remove access anytime in your Google Account.",
    agree: "By tapping Connect Gmail, you agree to let ScamCheck read your email to check for scams.",
    button: "Connect Gmail",
    unverified: "Google may say this app isn't verified yet. That is expected while ScamCheck is in testing. Tap Continue.",
    connected: "Gmail is connected. ScamCheck will check new emails for scams. You can close this page.",
  },
  es: {
    title: "Conecta tu Gmail",
    yourGmail: "tu Gmail",
    intro:
      "{name} te agregó a ScamCheck. ScamCheck lee los correos nuevos de {mailbox} solo para buscar estafas. Si uno parece riesgoso, puede llamarte al ···{last4}.",
    sharing: "{name} verá resúmenes cortos de advertencias en el sitio de ScamCheck, nunca tus correos.",
    disclaimer:
      "ScamCheck es una herramienta automática que usa IA. Puede no detectar una estafa y puede marcar un mensaje real por error. No es una garantía y no está afiliada a ningún banco, empresa o gobierno. Confirma siempre con la empresa directamente, usando el número de tu tarjeta o su sitio web. Nunca compartas códigos ni contraseñas.",
    storage: "No guardamos tus correos. Puedes quitar el acceso cuando quieras en tu cuenta de Google.",
    agree: "Al tocar Conectar Gmail, aceptas que ScamCheck lea tu correo para buscar estafas.",
    button: "Conectar Gmail",
    unverified: "Google puede decir que esta app aún no está verificada. Es normal mientras ScamCheck está en pruebas. Toca Continuar.",
    connected: "Gmail está conectado. ScamCheck revisará los correos nuevos para buscar estafas. Puedes cerrar esta página.",
  },
};

function consentCopy(language: string): ConsentCopy & { lang: string } {
  const lang = CONSENT_COPY[language] ? language : "en";
  return { ...(CONSENT_COPY[lang] ?? (CONSENT_COPY.en as ConsentCopy)), lang };
}

export function parentConsentHtml(input: {
  accountName: string;
  email?: string;
  phoneLast4: string;
  language: string;
  startUrl: string;
}): string {
  const copy = consentCopy(input.language);
  const values: Record<string, string> = {
    name: input.accountName,
    mailbox: input.email || copy.yourGmail,
    last4: input.phoneLast4,
  };
  const fill = (template: string) => template.replace(/\{(\w+)\}/g, (_, key: string) => escapeHtml(values[key] ?? ""));
  return page(
    `<h2>${escapeHtml(copy.title)}</h2>
    <p>${fill(copy.intro)}</p>
    <p>${fill(copy.sharing)}</p>
    <p class="fine">${escapeHtml(copy.disclaimer)}</p>
    <p class="fine">${escapeHtml(copy.storage)}</p>
    <p>${escapeHtml(copy.agree)}</p>
    <p><a class="button" href="${escapeHtml(input.startUrl)}">${escapeHtml(copy.button)}</a></p>
    <p class="fine">${escapeHtml(copy.unverified)}</p>`,
    copy.lang,
  );
}

export function connectErrorHtml(): string {
  return page("Gmail connect did not finish. Open the link again.");
}

function page(body: string, language = "en"): string {
  const lang = /^[a-z]{2}$/.test(language) ? language : "en";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>ScamCheck</title><style>body{margin:0;background:#f3efe6;color:#1c1714;font:18px/1.5 ui-sans-serif,system-ui,sans-serif}main{max-width:560px;margin:0 auto;padding:32px 20px 64px}h1{margin:0 0 8px;font-family:Georgia,serif}p{margin:0 0 14px}.fine{color:#6d645c;font-size:15px}.button{display:inline-block;padding:14px 22px;border-radius:999px;background:#1c1714;color:#fff;text-decoration:none;font-weight:600}</style></head><body><main><h1>ScamCheck</h1>${body}</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
