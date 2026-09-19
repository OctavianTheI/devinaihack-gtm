import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { guardTrainingRequest, readTrainingBody, trainingError } from "../_lib/requests";
import { addTrainingSession, StoreError } from "@/shared/store";
import { trainingSessionInputSchema } from "@/shared/validation";
import type { RepView, TrainingSession } from "@/shared/types";

const savedSessions = new Map<string, { signature: string; session: TrainingSession; rep: RepView; expires: number }>();

// POST /api/training/sessions
// Called by the Train tab when a voice-coach session ends. Body must match
// TrainingSessionInput (see shared/types.ts). On success, updates the rep's
// `training` scores/divergences and returns the resolved RepView so the
// caller can show a "here's your new score" confirmation immediately.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    guardTrainingRequest(req, "sessions", 20);
    body = await readTrainingBody(req, z.unknown());
  } catch (error) {
    return trainingError(error);
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

  const signature = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  const now = Date.now();
  for (const [id, saved] of savedSessions) if (saved.expires <= now) savedSessions.delete(id);
  const existing = savedSessions.get(session.id);
  if (existing) {
    return existing.signature === signature
      ? NextResponse.json({ session: existing.session, rep: existing.rep }, { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json({ error: "Session id already used with different content" }, { status: 409 });
  }
  if (savedSessions.size >= 100) savedSessions.delete(savedSessions.keys().next().value!);

  try {
    const rep = await addTrainingSession(session);
    savedSessions.set(session.id, { signature, session, rep, expires: now + 15 * 60_000 });
    return NextResponse.json({ session, rep }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof StoreError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
