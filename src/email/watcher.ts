import { google, type gmail_v1 } from "googleapis";
import { collectEvidence } from "../core/evidence.js";
import { analyze } from "../core/analyze.js";
import { notifyEmail } from "../core/notify.js";
import { recentSummaries } from "../core/memory.js";
import { displayNameFromHeader } from "./headers.js";
import { parseHtml } from "./parse.js";
import { decryptToken } from "./tokens.js";
import { oauthClient } from "./oauth.js";
import { incrementEmailsChecked, listGmailUsers, saveUser, type User } from "../db/users.js";
import type { MessageLink, ParsedMessage } from "../core/types.js";

const URGENCY = /urgent|immediately|gift\s*card|wire|password|verify your account|small fee|suspended/i;

export function startEmailWatcher(): void {
  const seconds = Number(process.env.EMAIL_POLL_SECONDS ?? "20");
  const delay = Number.isFinite(seconds) && seconds >= 10 ? seconds * 1000 : 20_000;
  let polling = false;
  const run = () => {
    if (polling) return;
    polling = true;
    pollInboxes()
      .catch((error: unknown) => {
        console.error("gmail poll failed error=" + (error as Error).name);
      })
      .finally(() => {
        polling = false;
      });
  };
  setInterval(run, delay);
  run();
}

async function pollInboxes(): Promise<void> {
  if (!oauthClient()) return;
  const users = await listGmailUsers();
  for (const user of users) {
    try {
      await pollUser(user);
    } catch (error) {
      console.error("gmail user poll failed error=" + (error as Error).name);
    }
  }
}

async function pollUser(user: User): Promise<void> {
  if (!user.gmail) return;
  const client = oauthClient();
  if (!client) return;
  client.setCredentials({ refresh_token: decryptToken(user.gmail.refreshTokenEnc) });
  const gmail = google.gmail({ version: "v1", auth: client });
  const listed = await gmail.users.messages.list({
    userId: "me",
    q: "in:inbox newer_than:1d",
    maxResults: 8,
  });
  const ids = (listed.data.messages ?? []).map((message) => message.id).filter((id): id is string => Boolean(id));
  for (const id of ids) {
    if (user.seenEmailIds.includes(id)) continue;
    try {
      const full = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const parsed = parseGmail(full.data);
      const findings = collectEvidence(parsed);
      const worthModel =
        parsed.links.length > 0 ||
        (parsed.text.length > 0 && URGENCY.test(parsed.text)) ||
        findings.some((finding) => finding.severity === "high") ||
        hasAttachment(full.data.payload);
      if (worthModel) {
        const result = await analyze(parsed, {
          language: user.language,
          recentCaseSummaries: await recentSummaries(user),
        });
        await notifyEmail(user, result);
      }
      const alreadySeen = user.seenEmailIds.length;
      await saveUser(user._id, { seenEmailId: id, gmail: { ...user.gmail, lastCheckedAt: new Date() } });
      await incrementEmailsChecked(user._id, alreadySeen);
      user.seenEmailIds.push(id);
    } catch (error) {
      console.error("gmail message failed error=" + (error as Error).name);
    }
  }
}

function hasAttachment(payload: gmail_v1.Schema$MessagePart | undefined): boolean {
  if (!payload) return false;
  if (payload.filename) return true;
  return (payload.parts ?? []).some((part) => hasAttachment(part));
}

function parseGmail(message: gmail_v1.Schema$Message): ParsedMessage {
  const headers = message.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
  const html = partText(message.payload, "text/html");
  const plain = partText(message.payload, "text/plain");
  const parsedHtml = html ? parseHtml(html) : { text: "", links: [] as MessageLink[] };
  return {
    source: "email",
    from: header("from"),
    replyTo: header("reply-to"),
    subject: header("subject"),
    displayName: displayNameFromHeader(header("from")),
    text: plain || parsedHtml.text,
    html,
    links: parsedHtml.links,
    authenticationResults: header("authentication-results"),
    seenSenderBefore: false,
  };
}

function partText(part: gmail_v1.Schema$MessagePart | undefined, mime: string): string | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data) return decode(part.body.data);
  for (const child of part.parts ?? []) {
    const text = partText(child, mime);
    if (text) return text;
  }
  return undefined;
}

function decode(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
