import { listInboundTexts, type MessagePlatform } from "./photon.js";
import { handleInboundText } from "../core/inbound.js";

let started = false;

/** Poll Photon for received iMessages and SMS. Replies always go out on iMessage. */
export function startInbox(): void {
  if (started || !process.env.PHOTON_API_KEY || !process.env.PHOTON_PROJECT_ID) return;
  started = true;
  let since = new Date(Date.now() - 20_000).toISOString();
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      // Each channel on its own: an SMS error (not enabled, carrier, API) must not stop iMessage.
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
        await handleInboundText(message);
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
