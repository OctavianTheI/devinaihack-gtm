// Redis-backed store (Upstash, via Vercel Marketplace): serves the Monitor
// tab's reads and applies TrainingSession writes from the Train tab.
//
// Why Redis and not an in-memory array: on Vercel every request may land on a
// different serverless instance, so a write in one function was invisible to a
// read in another and gone on the next cold start. Redis is the one place all
// instances agree on.
//
// Layout (sized for the free tier — 500K commands/month is plenty here):
//   rep:<id>     one JSON document per rep (SDK auto-serializes)
//   reps:index   SET of rep ids, so listing is SMEMBERS + one MGET (2 commands)
//                instead of KEYS/SCAN
// First run on an empty database seeds both from shared/mock/reps.json, so the
// demo data is identical to what the in-memory version served.
//
// Credentials come from the variables `vercel install upstash` writes:
// KV_REST_API_URL / KV_REST_API_TOKEN (Vercel-KV-compatible names, not the
// UPSTASH_REDIS_REST_* names the SDK's fromEnv() looks for).

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import type { Rep, RepView, Scores, DataSource, TrainingSession } from "./types";

const MOCK_PATH = path.join(process.cwd(), "shared", "mock", "reps.json");
const INDEX_KEY = "reps:index";
const SEED_LOCK_KEY = "reps:seeding";
const repKey = (id: string) => `rep:${id}`;

function loadSeed(): Rep[] {
  const raw = fs.readFileSync(MOCK_PATH, "utf-8");
  return JSON.parse(raw) as Rep[];
}

let client: Redis | null = null;

function redis(): Redis {
  if (client) return client;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new StoreError(
      "Redis is not configured: KV_REST_API_URL / KV_REST_API_TOKEN are missing. Run `vercel env pull .env.local`.",
      503
    );
  }
  client = new Redis({ url, token });
  return client;
}

// Per-process memo so the "is it seeded?" check runs once per warm instance,
// not once per request. Cold instances re-check, which is what we want.
let seeded: Promise<void> | null = null;

async function seedIfEmpty(): Promise<void> {
  const r = redis();
  if ((await r.scard(INDEX_KEY)) > 0) return;
  // Two cold instances racing on a fresh database: whoever gets the lock seeds;
  // the other waits briefly and re-reads. Lock expires so a crash can't wedge it.
  const locked = await r.set(SEED_LOCK_KEY, "1", { nx: true, ex: 30 });
  if (locked !== "OK") {
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if ((await r.scard(INDEX_KEY)) > 0) return;
    }
    throw new StoreError("Store is still seeding, retry shortly", 503);
  }
  try {
    const reps = loadSeed();
    const entries = Object.fromEntries(reps.map((rep) => [repKey(rep.id), rep]));
    const [first, ...rest] = reps.map((rep) => rep.id);
    const pipeline = r.pipeline();
    pipeline.mset(entries);
    pipeline.sadd(INDEX_KEY, first, ...rest);
    await pipeline.exec();
  } finally {
    await r.del(SEED_LOCK_KEY);
  }
}

function ensureSeeded(): Promise<void> {
  if (!seeded) {
    seeded = seedIfEmpty().catch((error) => {
      seeded = null; // let the next request try again rather than caching the failure
      throw error;
    });
  }
  return seeded;
}

async function getAll(): Promise<Rep[]> {
  await ensureSeeded();
  const r = redis();
  const ids = await r.smembers(INDEX_KEY);
  if (ids.length === 0) return [];
  const reps = await r.mget<(Rep | null)[]>(...ids.sort().map(repKey));
  return reps.filter((rep): rep is Rep => rep !== null);
}

async function getOne(id: string): Promise<Rep | null> {
  await ensureSeeded();
  return redis().get<Rep>(repKey(id));
}

/** Drops all rep data so the next request re-seeds from the mock file.
 * Kept for parity with the in-memory store; only use it on a demo database. */
export async function resetStore(): Promise<void> {
  const r = redis();
  const ids = await r.smembers(INDEX_KEY);
  await r.del(INDEX_KEY, SEED_LOCK_KEY, ...ids.map(repKey));
  seeded = null;
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

export async function listReps(source: DataSource): Promise<RepView[]> {
  return (await getAll()).map((r) => toView(r, source));
}

export async function getRep(id: string, source: DataSource): Promise<RepView | null> {
  const rep = await getOne(id);
  return rep ? toView(rep, source) : null;
}

/** Team average across whichever source is requested. Reps without a
 * training score are excluded from the training-source average rather than
 * counted as zero. */
export async function teamAverage(source: DataSource): Promise<Scores | null> {
  const all = await getAll();
  const scoresList =
    source === "training"
      ? all.map((r) => r.training).filter((s): s is Scores => s !== null)
      : all.map((r) => r.live);
  return average(scoresList);
}

export async function addTrainingSession(session: TrainingSession): Promise<RepView> {
  const rep = await getOne(session.repId);
  if (!rep) {
    throw new StoreError(`Unknown repId: ${session.repId}`, 404);
  }
  const updated: Rep = {
    ...rep,
    training: session.scores,
    // Training divergences replace prior training-derived ones but keep the
    // rep's live-call divergences alongside them, tagged by keeping whatever
    // was already there — simplest correct behavior for a hackathon: append
    // and let the UI show both, most recent first.
    divergences: [...session.divergences, ...rep.divergences],
  };
  await redis().set(repKey(updated.id), updated);
  return toView(updated, "training");
}

export class StoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
