// The single scoring function both sides call (PLAN.md §5): the mock-data
// generator and the live voice coach grade transcripts through here so "the
// AI is consistently identifying what works" is literally the same judgment
// applied twice.
//
// NOTE: deliberately no `import "server-only"` — Owner A's plain-node seed
// script also needs to import this file, and that package throws outside a
// React Server Components bundler.

import { z } from "zod";
import { RUBRIC, SCRIPT_STEPS } from "./rubric";
import { divergenceSchema, scoresSchema } from "./validation";
import type { Divergence, Scores } from "./types";

export interface ScorerTranscriptTurn {
  speaker: "rep" | "customer";
  text: string;
}

export interface ScorerResult {
  scores: Scores;
  divergences: Divergence[];
  summary: string;
}

// A rubric is one { label, description } per Scores key. RUBRIC satisfies
// this; callers may pass a variant (e.g. an uploaded custom script's criteria).
export type ScorerRubric = Record<
  keyof Scores,
  { label: string; description: string }
>;

const scorerResultSchema = z.object({
  scores: scoresSchema,
  divergences: z.array(divergenceSchema),
  summary: z.string(),
});

function buildInstructions(rubric: ScorerRubric): string {
  return `
You are grading a sales training call transcript. Score each criterion 0-100:
${Object.entries(rubric)
  .map(([key, r]) => `- ${key} (${r.label}): ${r.description}`)
  .join("\n")}

Also list any Divergences: points where the rep departed from the standard
script steps (${SCRIPT_STEPS.join(", ")}). For each, note what they did, and
rate it "good" (should be adopted into the script), "neutral", or "bad".

Return strict JSON: { "scores": Scores, "divergences": Divergence[], "summary": string }
`.trim();
}

function formatTranscript(transcript: ScorerTranscriptTurn[]): string {
  return transcript.map((t) => `${t.speaker.toUpperCase()}: ${t.text}`).join("\n");
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
}

// TODO(scorer): the model/API for grading isn't configured in this repo yet.
// This calls any OpenAI-compatible chat-completions endpoint, configured via
// env vars (set them in Vercel, don't commit keys):
//   SCORER_API_KEY  (falls back to OPENAI_API_KEY)
//   SCORER_BASE_URL (default https://api.openai.com/v1)
//   SCORER_MODEL    (default gpt-4o-mini)
// Swap this for whatever provider the team lands on — Anthropic, the Vercel
// AI SDK, the voice provider's built-in LLM — keeping the signature and the
// parsed return shape the same.
async function llmScore(
  transcript: ScorerTranscriptTurn[],
  rubric: ScorerRubric
): Promise<ScorerResult> {
  const baseUrl = process.env.SCORER_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = process.env.SCORER_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("no scorer API key configured");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.SCORER_MODEL ?? "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildInstructions(rubric) },
        {
          role: "user",
          content: `Transcript:\n${formatTranscript(transcript)}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`scorer model call failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("scorer model returned no content");
  return scorerResultSchema.parse(JSON.parse(content));
}

// Deterministic placeholder so nothing blocks while the model call above is
// unwired: same transcript in -> same scores out. Heuristics are intentionally
// crude (rep talk share + whether they ever asked for the sale) — they're only
// there so a placeholder-graded session doesn't look like pure noise in the
// dashboard. Do NOT ship demo results produced by this path as "AI rated".
function hashTranscript(transcript: ScorerTranscriptTurn[]): number {
  let h = 2166136261;
  const s = transcript.map((t) => `${t.speaker}:${t.text}`).join("\n");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const clampScore = (n: number) => Math.max(5, Math.min(99, Math.round(n)));

function placeholderScore(transcript: ScorerTranscriptTurn[]): ScorerResult {
  const rand = seededRand(hashTranscript(transcript));
  const repTurns = transcript.filter((t) => t.speaker === "rep");
  const repShare = transcript.length ? repTurns.length / transcript.length : 0;
  const askedForSale = repTurns.some((t) =>
    /\b(sign|buy|purchase|get started|next step|send (me |you )?a link)\b/i.test(t.text)
  );
  const base = 45 + repShare * 30 + (askedForSale ? 10 : 0);
  const jitter = () => clampScore(base + (rand() - 0.5) * 20);
  return {
    scores: {
      closeRate: jitter(),
      objectionHandling: jitter(),
      scriptAdherence: jitter(),
      technicalAnswers: jitter(),
    },
    divergences: [],
    summary:
      "Placeholder score (no scoring model configured). Deterministic estimate from " +
      "transcript stats only — wire up an API key for real AI grading.",
  };
}

/**
 * Grade a sales-call transcript against the rubric. Returns parsed
 * { scores, divergences, summary } matching the shared types.
 *
 * Uses the configured model endpoint when SCORER_API_KEY/OPENAI_API_KEY is
 * set; otherwise (or if the model call/parse fails) falls back to the
 * deterministic placeholder so callers are never blocked.
 */
export async function scoreTranscript(
  transcript: ScorerTranscriptTurn[],
  rubric: ScorerRubric = RUBRIC
): Promise<ScorerResult> {
  try {
    return await llmScore(transcript, rubric);
  } catch (err) {
    console.warn("[scorer] model scoring unavailable, using placeholder:", err);
    return placeholderScore(transcript);
  }
}
