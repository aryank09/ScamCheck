// Rehearse the outbound warning call without the email pipeline.
// Run: npx tsx --env-file=.env scripts/testCall.ts +1XXXXXXXXXX [ur|es|hi|en]
import { startWarningCall } from "../src/voice/outbound.js";

const openings: Record<string, string> = {
  en: "Hi, this is ScamCheck. You got an email pretending to be Chase, but it came from a different website. Please don't click it or reply.",
  ur: "السلام علیکم، یہ اسکیم چیک ہے۔ آپ کو ایک ای میل آئی ہے جو چیس بینک ہونے کا دعویٰ کرتی ہے، لیکن یہ کسی اور ویب سائٹ سے آئی ہے۔ براہ کرم اس پر کلک نہ کریں اور جواب نہ دیں۔",
  es: "Hola, soy ScamCheck. Recibió un correo que dice ser de Chase, pero vino de otro sitio web. Por favor, no haga clic ni responda.",
  hi: "नमस्ते, यह स्कैमचेक है। आपको एक ईमेल आया है जो Chase बैंक होने का दावा करता है, लेकिन यह किसी दूसरी वेबसाइट से आया है। कृपया उस पर क्लिक न करें और जवाब न दें।",
};

const [toPhone, language = "ur"] = process.argv.slice(2);
if (!toPhone?.startsWith("+") || !openings[language]) {
  console.error("Usage: npx tsx --env-file=.env scripts/testCall.ts +1XXXXXXXXXX [ur|es|hi|en]");
  process.exit(1);
}

startWarningCall({
  toPhone,
  caseId: "none",
  language,
  brand: "Chase",
  scamType: "fake Chase login",
  opening: openings[language],
}).then((conversationId) => {
  console.log(conversationId ? `Calling… conversation ${conversationId}` : "Call failed to start; check ELEVENLABS_* in .env.");
  process.exit(conversationId ? 0 : 1);
});
