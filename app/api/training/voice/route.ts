import { NextResponse } from "next/server";

// POST /api/training/voice
// Returns a signed URL the browser uses to open an ElevenLabs ConvAI session.
// Lazily creates the "cold-call prospect" agent on first call and caches its
// ID in-module (fine for a hackathon server process). Set ELEVENLABS_AGENT_ID
// to skip creation and reuse an agent you configured in the dashboard.

const XI_API = "https://api.elevenlabs.io/v1";

const PROSPECT_PROMPT = `You are Jordan, an office manager at a mid-size company. You have just answered your phone to a COLD CALL — you did not ask for this call and you are mildly skeptical and busy.

Rules you must follow:
- The caller is a sales rep. Do NOT treat the pitch as started until they have told you: who they are, what company they represent, and what they are offering. If they skip any of that, push back instead of engaging ("Sorry, who is this?", "How did you get this number?", "What is this about?").
- Once they have introduced themselves properly, let them pitch. Listen with polite but noncommittal reactions.
- When you receive a system note that the pitch window is over, cut the caller off and start raising objections and pointed questions. Push back hard but stay realistic: busy, budget-conscious, burned by vendors before.
- If you receive a system note that the caller is doing well enough to win the deal, drop the skeptic act: say you're genuinely impressed, that you're ready to purchase, ask them to send a link to your email, and tell them to stay on the line so you can get this going now. Sound pleased.
- If you receive a system note that the session is over, wrap up politely and say goodbye.
- Keep every response SHORT — one to three sentences of natural spoken English. No lists, no markdown.
- Never break character. You are the prospect, not an assistant. Never offer help.`;

let cachedAgentId: string | null = null;

async function ensureAgent(apiKey: string): Promise<string> {
  if (process.env.ELEVENLABS_AGENT_ID) return process.env.ELEVENLABS_AGENT_ID;
  if (cachedAgentId) return cachedAgentId;

  const res = await fetch(`${XI_API}/convai/agents/create`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      name: "sales-coach-prospect",
      conversation_config: {
        agent: {
          prompt: { prompt: PROSPECT_PROMPT },
          first_message: "Hello?",
          language: "en",
        },
        tts: { model_id: "eleven_flash_v2_5" },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`agent create failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { agent_id?: string };
  if (!data.agent_id) throw new Error("agent create returned no agent_id");
  cachedAgentId = data.agent_id;
  return cachedAgentId;
}

export async function POST() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY not set — add it to .env.local" },
      { status: 503 }
    );
  }

  try {
    const agentId = await ensureAgent(apiKey);
    const res = await fetch(
      `${XI_API}/convai/conversation/get-signed-url?agent_id=${agentId}`,
      { headers: { "xi-api-key": apiKey } }
    );
    if (!res.ok) {
      throw new Error(`get-signed-url failed: HTTP ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { signed_url?: string };
    if (!data.signed_url) throw new Error("no signed_url in response");
    return NextResponse.json({ signedUrl: data.signed_url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
