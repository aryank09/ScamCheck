import { listInboundTexts, type MessagePlatform } from "./photon.js";
import { handleInboundText } from "../core/inbound.js";

let started = false;

/** Poll Photon for received iMessages and SMS. Beta docs use listMessages, not an invented webhook body. */
export function startInbox(): void {
  if (started || !process.env.PHOTON_API_KEY || !process.env.PHOTON_PROJECT_ID) return;
  started = true;
  let since = new Date(Date.now() - 20_000).toISOString();
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const batch = (await Promise.all(
        (["imessage", "sms"] as const).map((platform: MessagePlatform) => listInboundTexts(since, platform)),
      )).flat().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
