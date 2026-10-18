import { listInboundTexts, type MessagePlatform } from "./photon.js";
import { handleInboundText } from "../core/inbound.js";

let started = false;

/** Poll iMessage, and passively poll SMS so a stray text is not dropped. Replies go out on iMessage. */
export function startInbox(): void {
  if (started || !process.env.PHOTON_API_KEY || !process.env.PHOTON_PROJECT_ID) return;
  started = true;
  let since = new Date(Date.now() - 20_000).toISOString();
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      // Each channel on its own: an SMS receive error must not stop iMessage. SMS is not used to send text.
      const platforms = ["imessage", "sms"] as const satisfies readonly MessagePlatform[];
      const results = await Promise.allSettled(platforms.map((platform) => listInboundTexts(since, platform)));
      results.forEach((result, i) => {
        if (result.status === "rejected") {
          console.error(platforms[i] + " poll failed error=" + (result.reason as Error).name);
        }
      });
      const batch = results
        .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const message of batch) {
        const done = await handleInboundText(message);
        if (!done) break;
        if (message.createdAt > since) since = message.createdAt;
      }
    } finally {
      ticking = false;
    }
  };
  const run = () => {
    tick().catch((error: unknown) => {
      console.error("message poll failed error=" + (error as Error).name);
    });
  };
  setInterval(run, 5_000);
  run();
}
