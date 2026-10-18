// Photon 2.0 beta. Docs: https://photon.codes/docs/beta/api-reference/messages/send-a-message
import { randomUUID } from "node:crypto";
import { Photon } from "@photon-ai/api";
import { imageMime, type AnalysisImage } from "../core/images.js";

const TIMEOUT_MS = 10_000;
export type MessagePlatform = "imessage" | "sms";

let client: Photon | undefined;

/** Test hook so a text send can be asserted without calling Photon. */
export function usePhotonForTests(next: Photon | undefined): void {
  client = next;
}

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

async function agentUserId(api: Photon, project: string, platform: MessagePlatform): Promise<string> {
  const configured = platform === "sms" ? process.env.PHOTON_SMS_AGENT_USER_ID : process.env.PHOTON_AGENT_USER_ID;
  if (configured) return configured;
  let pageToken: string | undefined;
  do {
    const page = await api.projects.listUsers({
      path: { id: project },
      query: { platform, pageSize: 100, ...(pageToken ? { pageToken } : {}) },
    });
    const agent = page.items.find((user) => user.platform === platform && user.kind === "agent");
    if (agent) return asId(agent.id, "agent id");
    pageToken = page.nextPageToken;
  } while (pageToken);
  throw new Error(`No ${platform} agent user on this Photon project`);
}

export interface InboundText {
  id: string;
  phone: string;
  text: string;
  createdAt: string;
  attachmentId?: string;
  platform: MessagePlatform;
}

export interface OutboundText {
  id: string;
  status: string;
  platform: MessagePlatform;
  failure?: string;
}

/**
 * Send plain text on iMessage.
 * The Photon SMS number is for voice calls only, so this never opens an SMS conversation.
 * Does not log phone numbers or message bodies.
 */
export async function sendText(phone: string, text: string): Promise<OutboundText> {
  const api = photon();
  const project = projectId();
  const platform = "imessage" as const;
  const convo = await conversation(api, project, phone, platform);
  const sent = await api.projects.sendMessage({
    path: { id: project },
    headers: { "idempotency-key": `text:${randomUUID()}` },
    body: {
      spaceId: convo.spaceId,
      senderId: convo.senderId,
      content: { type: "text", format: "plain", text },
    },
  });
  const status = typeof sent.status === "string" ? sent.status : "dispatched";
  const failure = failureCode(sent);
  return { id: asId(sent.id, "message id"), status, platform, ...(failure ? { failure } : {}) };
}

/** Latest delivery state for one outbound message. Docs: get a message. */
export async function messageStatus(messageId: string): Promise<{ status: string; failure?: string }> {
  const message = await photon().projects.getMessage({
    path: { id: projectId(), messageId },
  });
  if (!message || typeof message.status !== "string") return { status: "dispatched" };
  const code = failureCode(message);
  return code ? { status: message.status, failure: code } : { status: message.status };
}

function failureCode(message: object): string | undefined {
  if (!("failure" in message)) return undefined;
  const failure = message.failure;
  if (!failure || typeof failure !== "object" || !("code" in failure)) return undefined;
  return typeof failure.code === "string" ? failure.code : undefined;
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
  const convo = await conversation(api, project, phone, "imessage");
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

const MAX_IMAGE_BYTES = 4_000_000;

/**
 * Download a received photo for one analysis. Returns null when it is not an image.
 * Throws when Photon fails, so the caller can retry. Bytes are not stored.
 */
export async function downloadInboundImage(attachmentId: string): Promise<AnalysisImage | null> {
  const api = photon();
  const project = projectId();
  const meta = await api.projects.getAttachment({ path: { id: project, attachmentId } });
  const mimeType = imageMime(meta.contentType);
  if (!mimeType || meta.sizeBytes > MAX_IMAGE_BYTES) return null;
  const downloaded = await api.projects.downloadAttachment({ path: { id: project, attachmentId } });
  const data = await fileBytes(downloaded);
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES) return null;
  return { mimeType, data };
}

/**
 * Inbound iMessage via the beta listMessages query.
 * https://photon.codes/docs/beta/get-started/imessage
 */
export async function listInboundTexts(createdSince: string, platform: MessagePlatform): Promise<InboundText[]> {
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
        platform,
        ...(pageToken ? { pageToken } : {}),
      },
    });
    for (const message of page.items) {
      const text = inboundText(message as unknown, platform);
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
  platform: MessagePlatform,
): Promise<{ spaceId: string; senderId: string }> {
  const person = await api.projects.createOrGetUser({
    path: { id: project },
    body: { handle: phone, platform },
  });
  const personId = asId(person.id, "user id");
  const agentId = await agentUserId(api, project, platform);
  const space = await api.projects.createOrGetSpace({
    path: { id: project },
    headers: { "idempotency-key": `space:${agentId}:${personId}` },
    body: { platform, participantIds: [agentId, personId] },
  });
  return { spaceId: asId(space.id, "space id"), senderId: agentId };
}

function inboundText(value: unknown, platform: MessagePlatform): InboundText | null {
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
  const typed = content as { type?: unknown; text?: unknown; attachmentId?: unknown };
  if (typed.type === "text" && typeof typed.text === "string" && typed.text.trim()) {
    return { id: message.id, phone: sentBy.handle, text: typed.text.trim(), createdAt: message.createdAt, platform };
  }
  if (typed.type === "attachment" && typeof typed.attachmentId === "string" && typed.attachmentId) {
    return {
      id: message.id,
      phone: sentBy.handle,
      text: "",
      createdAt: message.createdAt,
      attachmentId: typed.attachmentId,
      platform,
    };
  }
  return null;
}

async function fileBytes(value: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value && typeof value === "object" && "arrayBuffer" in value && typeof value.arrayBuffer === "function") {
    const blob = value as { arrayBuffer: () => Promise<ArrayBuffer> };
    return Buffer.from(await blob.arrayBuffer());
  }
  throw new Error("attachment bytes were not a file");
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
