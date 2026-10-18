// Trigger an outbound warning call through ElevenLabs over the Photon SIP trunk.
// Docs: https://elevenlabs.io/docs/api-reference/sip-trunk/outbound-call

export interface WarningCall {
  toPhone: string; // E.164
  caseId: string;
  language: string;
  userName?: string;
  brand?: string;
  scamType: string;
  /** Spoken first, in the user's language, so they hear the warning right away. */
  opening?: string;
}

// ponytail: must match the agent's language presets in ElevenLabs; others stay on the default.
const AGENT_LANGUAGES = new Set(["en", "es", "hi", "ur"]);

export async function startWarningCall(call: WarningCall): Promise<string | null> {
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call", {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: process.env.ELEVENLABS_AGENT_ID,
        agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
        to_number: call.toPhone,
        conversation_initiation_client_data: {
          // Names must match the placeholders in agentPrompt.md.
          dynamic_variables: {
            call_type: "outbound",
            case_id: call.caseId,
            user_language: call.language,
            user_name: call.userName ?? "unknown",
            brand: call.brand ?? "none",
            scam_type: call.scamType,
          },
          // Both overrides are enabled on the agent (Security → Overrides).
          conversation_config_override: {
            agent: {
              ...(call.opening ? { first_message: call.opening } : {}),
              ...(AGENT_LANGUAGES.has(call.language) ? { language: call.language } : {}),
            },
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      conversation_id?: string | null;
    };
    if (!res.ok || !body.success) {
      console.error(`outbound call failed status=${res.status} case=${call.caseId}`);
      return null;
    }
    return body.conversation_id ?? null;
  } catch (err) {
    console.error(`outbound call error=${(err as Error).name} case=${call.caseId}`);
    return null;
  }
}
