import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { checkToolSecret, voiceTools } from "./voice/tools.js";
import { handlePostCall } from "./voice/postCall.js";

const MAX_BODY_BYTES = 64 * 1024;
const port = Number(process.env.PORT ?? "3000");

class PayloadTooLargeError extends Error {}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
    sendJson(response, 200, { service: "ScamCheck", ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/voice/tools/")) {
    const name = decodeURIComponent(url.pathname.slice("/voice/tools/".length));
    const tool = voiceTools[name];
    if (!tool) {
      sendJson(response, 404, { error: "Unknown voice tool" });
      return;
    }
    if (!process.env.VOICE_TOOL_SECRET) {
      sendJson(response, 503, { error: "Voice tools are not configured" });
      return;
    }
    if (!checkToolSecret(header(request, "x-scamcheck-secret"))) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    try {
      const rawBody = await readRawBody(request);
      const payload: unknown = JSON.parse(rawBody.toString("utf8"));
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        sendJson(response, 400, { error: "Expected a JSON object" });
        return;
      }
      sendJson(response, 200, await tool(payload as Parameters<typeof tool>[0]));
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: "Request body is too large" });
      } else if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: "Invalid JSON" });
      } else {
        console.error("voice tool failed name=" + name + " error=" + (error as Error).name);
        sendJson(response, 500, { error: "Voice tool failed" });
      }
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/voice/post-call") {
    try {
      const rawBody = await readRawBody(request);
      const status = await handlePostCall(rawBody, header(request, "elevenlabs-signature"));
      response.writeHead(status);
      response.end();
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: "Request body is too large" });
      } else {
        console.error("post-call webhook failed error=" + (error as Error).name);
        sendJson(response, 400, { error: "Invalid webhook request" });
      }
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.info("ScamCheck API listening on port " + port);
});
