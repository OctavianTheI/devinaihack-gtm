// Black-box check that the reps store persists across server instances.
// Usage: node scripts/verify-store.mjs <baseUrl> <phase>
//   phase "write": GET list, GET one, POST a synthetic session, GET again
//   phase "read":  GET the same rep from a *fresh* server/instance and expect
//                  the training scores written in the previous phase.
// Writes are synthetic and only touch rep-13 (Zara Petrov, training: null in seed).
import assert from "node:assert/strict";
import fs from "node:fs";

const [base, phase] = process.argv.slice(2);
const REP = "rep-13";
const marker = { closeRate: 77, objectionHandling: 66, scriptAdherence: 55, technicalAnswers: 44 };
const seed = JSON.parse(fs.readFileSync(new URL("../shared/mock/reps.json", import.meta.url), "utf8"));
const get = async (p) => { const r = await fetch(base + p); assert.equal(r.status, 200, p); return r.json(); };

if (phase === "write") {
  const list = await get("/api/reps?source=live");
  assert.equal(list.reps.length, seed.length, "all seeded reps present");
  const seedAvg = Math.round(seed.reduce((s, r) => s + r.live.closeRate, 0) / seed.length);
  assert.equal(list.teamAverage.closeRate, seedAvg, "live team average matches the mock file");
  const before = await get(`/api/reps/${REP}?source=training`);
  console.log(`before: ${REP} hasTraining=${before.rep.hasTraining} training=${JSON.stringify(before.rep.training)}`);
  const res = await fetch(base + "/api/training/sessions", {
    method: "POST", headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ repId: REP, durationSec: 5, outcome: "scored", scores: marker, divergences: [], summary: "verify-store synthetic write",
      transcript: [{ speaker: "rep", text: "synthetic persistence check", atSec: 1 }] }),
  });
  assert.equal(res.status, 201, "POST /api/training/sessions");
  const after = await get(`/api/reps/${REP}?source=training`);
  assert.deepEqual(after.rep.training, marker, "same-process read sees the write");
  assert.equal((await fetch(base + "/api/reps/nope")).status, 404);
  console.log("WRITE OK: list/avg match seed, POST 201, same-process read sees it, 404 intact");
} else if (phase === "read") {
  const rep = await get(`/api/reps/${REP}?source=training`);
  assert.deepEqual(rep.rep.training, marker, "training scores survived a fresh server instance");
  assert.equal(rep.rep.hasTraining, true);
  const list = await get("/api/reps?source=training");
  assert.deepEqual(list.reps.find((r) => r.id === REP).scores, marker, "list endpoint sees it too");
  console.log("READ OK: write is visible from a different server instance — persisted in Redis, not memory");
} else {
  throw new Error("phase must be write|read");
}
