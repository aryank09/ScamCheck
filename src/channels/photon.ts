// Photon 2.0 beta. Docs: https://photon.codes/docs/beta/api-reference/messages/send-a-message
import { randomUUID } from "node:crypto";
import { Photon } from "@photon-ai/api";

const TIMEOUT_MS = 10_000;

let client: Photon | undefined;

function photon(): Photon {
  const key = process.env.PHOTON_API_KEY;
  if (!key) throw new Error("PHOTON_API_KEY is not set");
  client ??= new Photon({
    headers: { Authorization: `Bearer ${key}` },
    timeoutMs: TIMEOUT_MS,
  });
  return client;
}

function projectId(): string {
  const id = process.env.PHOTON_PROJECT_ID;
  if (!id) throw new Error("PHOTON_PROJECT_ID is not set");
  return id;
}

async function agentUserId(api: Photon, project: string): Promise<string> {
  const configured = process.env.PHOTON_AGENT_USER_ID;
  if (configured) return configured;
  let pageToken: string | undefined;
  do {
    const page = await api.projects.listUsers({
      path: { id: project },
      query: { platform: "imessage", pageSize: 100, ...(pageToken ? { pageToken } : {}) },
    });
    const agent = page.items.find((user) => user.platform === "imessage" && user.kind === "agent");
    if (agent) return asId(agent.id, "agent id");
    pageToken = page.nextPageToken;
  } while (pageToken);
  throw new Error("No iMessage agent user on this Photon project");
}

export interface InboundText {
  id: string;
  phone: string;
  text: string;
  createdAt: string;
}

/** Send a plain-text iMessage. Does not log the phone number or the message body. */
export async function sendText(phone: string, text: string): Promise<void> {
  const api = photon();
  const project = projectId();
  const convo = await conversation(api, project, phone);
  await api.projects.sendMessage({
    path: { id: project },
    headers: { "idempotency-key": `text:${randomUUID()}` },
    body: {
      spaceId: convo.spaceId,
      senderId: convo.senderId,
      content: { type: "text", format: "plain", text },
    },
  });
}

/** Upload an mp3 and send it as a Photon voice message. Docs: send-a-message SendVoiceContent. */
export async function sendVoiceNote(phone: string, audio: Buffer): Promise<void> {
  const api = photon();
  const project = projectId();
  const boundary = `scamcheck-${randomUUID()}`;
  const meta = JSON.stringify({
    contentType: "audio/mpeg",
    sizeBytes: audio.length,
    filename: "note.mp3",
  });
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: audio/mpeg\r\nContent-Disposition: form-data; name="file"; filename="note.mp3"\r\n\r\n`,
    ),
    audio,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploaded = await api.projects.uploadAttachment({
    path: { id: project },
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(payload.length),
      "idempotency-key": `upload:${randomUUID()}`,
    },
    body: new Blob([new Uint8Array(payload)]),
  });
  const convo = await conversation(api, project, phone);
  await api.projects.sendMessage({
    path: { id: project },
    headers: { "idempotency-key": `voice:${randomUUID()}` },
    body: {
      spaceId: convo.spaceId,
      senderId: convo.senderId,
      content: { type: "voice", attachmentId: uploaded.id },
    },
  });
}

/**
 * Inbound iMessage via the beta listMessages query.
 * https://photon.codes/docs/beta/get-started/imessage
 */
export async function listInboundTexts(createdSince: string): Promise<InboundText[]> {
  const api = photon();
  const project = projectId();
  const found: InboundText[] = [];
  let pageToken: string | undefined;
  do {
    const page = await api.projects.listMessages({
      path: { id: project },
      query: {
        createdSince,
        direction: "received",
        order: "asc",
        pageSize: 50,
        platform: "imessage",
        ...(pageToken ? { pageToken } : {}),
      },
    });
    for (const message of page.items) {
      const text = inboundText(message as unknown);
      if (text) found.push(text);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return found;
}

async function conversation(
  api: Photon,
  project: string,
  phone: string,
): Promise<{ spaceId: string; senderId: string }> {
  const person = await api.projects.createOrGetUser({
    path: { id: project },
    body: { handle: phone, platform: "imessage" },
  });
  const personId = asId(person.id, "user id");
  const agentId = await agentUserId(api, project);
  const space = await api.projects.createOrGetSpace({
    path: { id: project },
    headers: { "idempotency-key": `space:${agentId}:${personId}` },
    body: { platform: "imessage", participantIds: [agentId, personId] },
  });
  return { spaceId: asId(space.id, "space id"), senderId: agentId };
}

function inboundText(value: unknown): InboundText | null {
  if (!value || typeof value !== "object") return null;
  const message = value as {
    id?: unknown;
    status?: unknown;
    createdAt?: unknown;
    sentBy?: unknown;
    receivedBy?: unknown;
    content?: unknown;
  };
  const sentBy = party(message.sentBy);
  const receivedBy = party(message.receivedBy);
  if (message.status !== "received" || !sentBy || !receivedBy) return null;
  if (sentBy.kind !== "human" || !sentBy.handle) return null;
  if (receivedBy.kind !== "agent") return null;
  if (typeof message.id !== "string" || typeof message.createdAt !== "string") return null;
  const content = message.content;
  if (!content || typeof content !== "object" || !("type" in content)) return null;
  const typed = content as { type?: unknown; text?: unknown };
  if (typed.type === "text" && typeof typed.text === "string" && typed.text.trim()) {
    return { id: message.id, phone: sentBy.handle, text: typed.text.trim(), createdAt: message.createdAt };
  }
  if (typed.type === "attachment") {
    return { id: message.id, phone: sentBy.handle, text: "The user forwarded an image.", createdAt: message.createdAt };
  }
  return null;
}

function party(value: unknown): { kind: string; handle?: string } | null {
  if (!value || typeof value !== "object" || !("kind" in value)) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== "string") return null;
  const handle = (value as { handle?: unknown }).handle;
  return { kind, handle: typeof handle === "string" ? handle : undefined };
}

function asId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Photon ${label} was missing`);
  return value;
}
