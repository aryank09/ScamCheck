import { listInboundTexts } from "./photon.js";
import { handleInboundText } from "../core/inbound.js";

let started = false;

/** Poll Photon for received iMessages. Beta docs use listMessages, not an invented webhook body. */
export function startInbox(): void {
  if (started || !process.env.PHOTON_API_KEY || !process.env.PHOTON_PROJECT_ID) return;
  started = true;
  let since = new Date(Date.now() - 20_000).toISOString();
  const tick = async () => {
    const batch = await listInboundTexts(since);
    for (const message of batch) {
      if (message.createdAt > since) since = message.createdAt;
      await handleInboundText(message.id, message.phone, message.text);
    }
  };
  setInterval(() => {
    tick().catch((error: unknown) => {
      console.error("imessage poll failed error=" + (error as Error).name);
    });
  }, 5_000);
}
