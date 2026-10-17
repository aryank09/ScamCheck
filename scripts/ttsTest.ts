// Generate sample voice notes to check ElevenLabs TTS by ear.
// Run: npx tsx --env-file=.env scripts/ttsTest.ts
// Needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tts } from "../src/core/tts.js";

const samples: Record<string, string> = {
  en: "This looks like a scam. The email says it's from Chase, but it came from a different website. Please don't click the link or reply.",
  ur: "یہ دھوکہ لگتا ہے۔ ای میل کہتی ہے کہ یہ چیس بینک سے ہے، لیکن یہ کسی اور ویب سائٹ سے آئی ہے۔ براہ کرم لنک پر کلک نہ کریں اور جواب نہ دیں۔",
  es: "Esto parece una estafa. El correo dice que es de Chase, pero vino de otro sitio web. Por favor, no haga clic en el enlace ni responda.",
  hi: "यह धोखा लगता है। ईमेल कहता है कि यह Chase बैंक से है, लेकिन यह किसी दूसरी वेबसाइट से आया है। कृपया लिंक पर क्लिक न करें और जवाब न दें।",
};

const outDir = join(tmpdir(), "scamcheck-tts");
mkdirSync(outDir, { recursive: true });

async function main() {
  let failed = 0;
  for (const [lang, text] of Object.entries(samples)) {
    const started = Date.now();
    const audio = await tts(text);
    if (!audio) {
      failed++;
      console.log(`${lang}: FAILED`);
      continue;
    }
    const file = join(outDir, `${lang}.mp3`);
    writeFileSync(file, audio);
    console.log(`${lang}: ${file} (${Math.round(audio.length / 1024)} KB, ${Date.now() - started} ms)`);
  }

  if (failed) {
    console.log(`\n${failed} failed. Check ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID in .env.`);
    process.exit(1);
  }
  console.log(`\nListen: open ${outDir}`);
}

main();
