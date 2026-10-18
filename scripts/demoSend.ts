import { google } from "googleapis";

/**
 * Insert one fake phishing message into the demo inbox.
 * DEMO_GMAIL_REFRESH_TOKEN must be minted with the gmail.insert scope.
 * The app itself stays on gmail.readonly.
 */
const raw = [
  "From: Chase Security <alerts@chase-secure-login.net>",
  "Subject: Your account is locked",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Your Chase account is locked. Verify your account immediately:",
  "https://chase-secure-login.net/login",
].join("\r\n");

async function main(): Promise<void> {
  const refresh = process.env.DEMO_GMAIL_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect = process.env.GOOGLE_REDIRECT_URI;
  if (!refresh || !clientId || !clientSecret || !redirect) {
    throw new Error("Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, and DEMO_GMAIL_REFRESH_TOKEN.");
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirect);
  auth.setCredentials({ refresh_token: refresh });
  const gmail = google.gmail({ version: "v1", auth });
  const encoded = Buffer.from(raw).toString("base64url");
  const inserted = await gmail.users.messages.insert({
    userId: "me",
    requestBody: { raw: encoded, labelIds: ["INBOX"] },
  });
  console.log("inserted " + (inserted.data.id ?? "message"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "demo send failed");
  process.exit(1);
});
