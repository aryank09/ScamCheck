import { google } from "googleapis";
import { findUserByConnectToken, saveUser } from "../db/users.js";
import { encryptToken } from "./tokens.js";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

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

export async function connectPage(token: string): Promise<{ status: number; html: string }> {
  const user = await findUserByConnectToken(token);
  if (!user) return { status: 404, html: page("That connect link is not valid.") };
  if (!oauthClient()) return { status: 503, html: page("Gmail connect is not configured.") };
  const start = `/connect/gmail/start?u=${encodeURIComponent(token)}`;
  return {
    status: 200,
    html: page(
      `<p>ScamCheck will only read your email to look for scams. It does not store your messages.</p><p><a href="${start}">Connect Gmail</a></p>`,
    ),
  };
}

export function authRedirect(token: string): string | null {
  const client = oauthClient();
  if (!client || !token) return null;
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [SCOPE],
    state: token,
  });
}

export async function finishConnect(code: string, token: string): Promise<{ status: number; html: string }> {
  const client = oauthClient();
  const user = await findUserByConnectToken(token);
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

function page(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>ScamCheck</title></head><body><h1>ScamCheck</h1>${body}</body></html>`;
}
