import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { addTrainingSession, StoreError } from "@/shared/store";
import { trainingSessionInputSchema } from "@/shared/validation";
import type { TrainingSession } from "@/shared/types";

// POST /api/training/sessions
// Called by the Train tab when a voice-coach session ends. Body must match
// TrainingSessionInput (see shared/types.ts). On success, updates the rep's
// `training` scores/divergences and returns the resolved RepView so the
// caller can show a "here's your new score" confirmation immediately.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = trainingSessionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid TrainingSession", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const session: TrainingSession = {
    ...parsed.data,
    id: parsed.data.id ?? randomUUID(),
    startedAt: parsed.data.startedAt ?? new Date().toISOString(),
  };

  try {
    const rep = addTrainingSession(session);
    return NextResponse.json({ session, rep }, { status: 201 });
  } catch (err) {
    if (err instanceof StoreError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
