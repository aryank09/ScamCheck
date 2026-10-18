import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadEnv } from "./config.js";
import { startInbox } from "./channels/inbox.js";
import { authRedirect, connectPage, finishConnect } from "./email/oauth.js";
import { startEmailWatcher } from "./email/watcher.js";
import { addHelper, familyErrorHtml, getFamilyApi, renderFamilyPage, replyOnFamilyPage } from "./web/family.js";
import { checkAuditToken, runCheck } from "./web/check.js";
import { handleSite, isSitePath, siteErrorHtml } from "./web/site.js";
import { checkToolSecret, voiceTools } from "./voice/tools.js";
import { handlePostCall } from "./voice/postCall.js";

loadEnv();

const MAX_BODY_BYTES = 64 * 1024;
// Post-call payloads carry the whole transcript; a long call easily passes 64 KB.
const MAX_POST_CALL_BYTES = 2 * 1024 * 1024;
const MAX_CHECK_BYTES = 8 * 1024 * 1024;
const port = Number(process.env.PORT ?? "3000");

class PayloadTooLargeError extends Error {}

async function readRawBody(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  response.end(html);
}

async function serveFamily(
  response: ServerResponse,
  load: () => Promise<{ status: number; body: object }>,
): Promise<void> {
  response.setHeader("cache-control", "no-store");
  response.setHeader("referrer-policy", "no-referrer");
  try {
    const result = await load();
    sendJson(response, result.status, result.body);
  } catch (error) {
    console.error("family page failed error=" + (error as Error).name);
    sendJson(response, 500, { error: "That didn't work. Try again." });
  }
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, { service: "ScamCheck", ok: true });
    return;
  }

  if (isSitePath(url.pathname)) {
    try {
      const body = request.method === "POST" ? await readRawBody(request) : undefined;
      const result = await handleSite(request.method ?? "GET", url, header(request, "cookie"), body);
      if (result.cookie) response.setHeader("set-cookie", result.cookie);
      if (result.redirect) {
        response.writeHead(result.status, {
          location: result.redirect,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        });
        response.end();
        return;
      }
      sendHtml(response, result.status, result.html ?? "");
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendHtml(response, 413, siteErrorHtml("That form is too large."));
      } else if (error instanceof Error && error.message.includes("MONGODB_URI")) {
        sendHtml(response, 503, siteErrorHtml("Set MONGODB_URI before creating accounts."));
      } else {
        console.error("site failed error=" + (error as Error).name);
        sendHtml(response, 500, siteErrorHtml("That didn't work. Try again."));
      }
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/connect/gmail") {
    const result = await connectPage(url.searchParams.get("u") ?? "");
    response.writeHead(result.status, { "content-type": "text/html; charset=utf-8" });
    response.end(result.html);
    return;
  }

  if (request.method === "GET" && url.pathname === "/connect/gmail/start") {
    const target = authRedirect(url.searchParams.get("u") ?? "");
    if (!target) {
      sendJson(response, 503, { error: "Gmail connect is not configured" });
      return;
    }
    response.writeHead(302, { location: target });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/connect/gmail/callback") {
    const result = await finishConnect(url.searchParams.get("code") ?? "", url.searchParams.get("state") ?? "");
    response.writeHead(result.status, { "content-type": "text/html; charset=utf-8" });
    response.end(result.html);
    return;
  }

  if (request.method === "GET" && url.pathname === "/family") {
    try {
      const result = await renderFamilyPage(url.searchParams.get("t") ?? "");
      sendHtml(response, result.status, result.html);
    } catch (error) {
      console.error("family page failed error=" + (error as Error).name);
      sendHtml(response, 500, familyErrorHtml());
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/family/api") {
    await serveFamily(response, () => getFamilyApi(url.searchParams.get("t") ?? ""));
    return;
  }

  if (request.method === "POST" && (url.pathname === "/family/helpers" || url.pathname === "/family/reply")) {
    const token = url.searchParams.get("t") ?? "";
    try {
      const rawBody = await readRawBody(request);
      const payload: unknown = JSON.parse(rawBody.toString("utf8"));
      const handler = url.pathname === "/family/helpers" ? addHelper : replyOnFamilyPage;
      await serveFamily(response, () => handler(token, payload));
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: "Request body is too large" });
      } else if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: "Invalid JSON" });
      } else {
        console.error("family page failed error=" + (error as Error).name);
        sendJson(response, 500, { error: "That didn't work. Try again." });
      }
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/check") {
    if (!process.env.VEYZL_AUDIT_TOKEN) {
      sendJson(response, 503, { error: "Audit route is not configured" });
      return;
    }
    if (!checkAuditToken(header(request, "authorization"))) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    try {
      // Audit probes can carry a base64 screenshot.
      const rawBody = await readRawBody(request, MAX_CHECK_BYTES);
      const result = await runCheck(JSON.parse(rawBody.toString("utf8")));
      sendJson(response, result.status, result.body);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: "Request body is too large" });
      } else if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: "Invalid JSON" });
      } else {
        console.error("api check failed error=" + (error as Error).name);
        sendJson(response, 500, { error: "Check failed" });
      }
    }
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
      const rawBody = await readRawBody(request, MAX_POST_CALL_BYTES);
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
  startInbox();
  if (process.env.MONGODB_URI && process.env.GOOGLE_CLIENT_ID) startEmailWatcher();
});
