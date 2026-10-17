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

/** Send a plain-text iMessage. Does not log the phone number or the message body. */
export async function sendText(phone: string, text: string): Promise<void> {
  const api = photon();
  const project = projectId();
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
  await api.projects.sendMessage({
    path: { id: project },
    headers: { "idempotency-key": `text:${randomUUID()}` },
    body: {
      spaceId: asId(space.id, "space id"),
      senderId: agentId,
      content: { type: "text", format: "plain", text },
    },
  });
}

function asId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Photon ${label} was missing`);
  return value;
}
