// ElevenLabs text-to-speech for voice notes.
// Returns null on any failure so callers still send the text (AGENTS.md §13).

const TTS_TIMEOUT_MS = 10_000;

export async function tts(text: string): Promise<Buffer | null> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!voiceId || !apiKey) return null;

  const started = Date.now();
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_TTS_MODEL_ID || "eleven_multilingual_v2",
        }),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      console.error(`tts failed status=${res.status} ms=${Date.now() - started}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error(`tts error=${(err as Error).name} ms=${Date.now() - started}`);
    return null;
  }
}
