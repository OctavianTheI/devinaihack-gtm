// In-memory store for the hackathon: loads the seeded reps, serves the
// Monitor tab's reads, and applies TrainingSession writes from the Train tab.
// Backed by nothing more than a module-level array — fine for a demo, and
// swappable for a real DB later without changing the API contract.
//
// NOTE: Next.js dev/serverless can spin up more than one module instance
// (route handlers, edge/node runtimes, hot reload). For a hackathon demo run
// with `next start` (or `next dev` without touching route files mid-demo)
// this is a non-issue; don't rely on it surviving a redeploy.

import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Rep, RepView, Scores, DataSource, TrainingSession } from "./types";

const MOCK_PATH = path.join(process.cwd(), "shared", "mock", "reps.json");

function loadSeed(): Rep[] {
  const raw = fs.readFileSync(MOCK_PATH, "utf-8");
  return JSON.parse(raw) as Rep[];
}

// Module-level cache so repeated requests in the same server process don't
// re-read the file, while still allowing POSTs to mutate it in memory.
let reps: Rep[] | null = null;

function getAll(): Rep[] {
  if (!reps) reps = loadSeed();
  return reps;
}

export function resetStore(): void {
  reps = null;
}

function average(scoresList: Scores[]): Scores | null {
  if (scoresList.length === 0) return null;
  const sum = scoresList.reduce(
    (acc, s) => ({
      closeRate: acc.closeRate + s.closeRate,
      objectionHandling: acc.objectionHandling + s.objectionHandling,
      scriptAdherence: acc.scriptAdherence + s.scriptAdherence,
      technicalAnswers: acc.technicalAnswers + s.technicalAnswers,
    }),
    { closeRate: 0, objectionHandling: 0, scriptAdherence: 0, technicalAnswers: 0 }
  );
  const n = scoresList.length;
  return {
    closeRate: Math.round(sum.closeRate / n),
    objectionHandling: Math.round(sum.objectionHandling / n),
    scriptAdherence: Math.round(sum.scriptAdherence / n),
    technicalAnswers: Math.round(sum.technicalAnswers / n),
  };
}

function toView(rep: Rep, source: DataSource): RepView {
  const hasTraining = rep.training !== null;
  const scores = source === "training" ? rep.training ?? rep.live : rep.live;
  return { ...rep, source, scores, hasTraining };
}

export function listReps(source: DataSource): RepView[] {
  return getAll().map((r) => toView(r, source));
}

export function getRep(id: string, source: DataSource): RepView | null {
  const rep = getAll().find((r) => r.id === id);
  return rep ? toView(rep, source) : null;
}

/** Team average across whichever source is requested. Reps without a
 * training score are excluded from the training-source average rather than
 * counted as zero. */
export function teamAverage(source: DataSource): Scores | null {
  const all = getAll();
  const scoresList =
    source === "training"
      ? all.map((r) => r.training).filter((s): s is Scores => s !== null)
      : all.map((r) => r.live);
  return average(scoresList);
}

export function addTrainingSession(session: TrainingSession): RepView {
  const all = getAll();
  const idx = all.findIndex((r) => r.id === session.repId);
  if (idx === -1) {
    throw new StoreError(`Unknown repId: ${session.repId}`, 404);
  }
  const rep = all[idx];
  const updated: Rep = {
    ...rep,
    training: session.scores,
    // Training divergences replace prior training-derived ones but keep the
    // rep's live-call divergences alongside them, tagged by keeping whatever
    // was already there — simplest correct behavior for a hackathon: append
    // and let the UI show both, most recent first.
    divergences: [...session.divergences, ...rep.divergences],
  };
  all[idx] = updated;
  return toView(updated, "training");
}

export class StoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
