import { NextRequest, NextResponse } from "next/server";
import { scoreTranscript } from "@/shared/scorer";
import type { ScorerTranscriptTurn } from "@/shared/scorer";

// POST /api/training/score
// Body: { transcript: { speaker: "rep" | "customer", text: string }[] }
// Grades the transcript through the shared scorer (LLM-backed, deterministic
// fallback). Server-side only so the model API key never reaches the browser.
// The Train tab calls this twice: once mid-call to decide the success branch,
// once after the call for the final TrainingSession scores.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const transcript = (body as { transcript?: unknown })?.transcript;
  if (
    !Array.isArray(transcript) ||
    !transcript.every(
      (t) =>
        t &&
        (t.speaker === "rep" || t.speaker === "customer") &&
        typeof t.text === "string"
    )
  ) {
    return NextResponse.json(
      { error: "Expected { transcript: { speaker, text }[] }" },
      { status: 400 }
    );
  }

  const result = await scoreTranscript(transcript as ScorerTranscriptTurn[]);
  return NextResponse.json(result);
}
