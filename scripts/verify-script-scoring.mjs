// End-to-end check for script-aware scoring, against a running server that has
// a real scorer key + Redis (local: `vercel env pull .env.local`; or a preview).
// Usage: node scripts/verify-script-scoring.mjs <baseUrl>
// Makes ~2 model calls and writes one synthetic session for rep-25.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2];
assert.ok(base, "usage: node scripts/verify-script-scoring.mjs <baseUrl>");
const H = { "content-type": "application/json", origin: base };
const post = (p, data) => fetch(base + p, { method: "POST", headers: H, body: JSON.stringify(data) });
const get = async (p) => { const r = await fetch(base + p); assert.equal(r.status, 200, p); return r.json(); };

// A script with a line no model would invent, so a citation proves it read it.
const SENTINEL = "Ask about their Q3 headcount plan before any pricing";
const SCRIPT = `OPENING
Hi {prospect}, this is {rep} from Northstar. I'll keep this to two minutes.

DISCOVERY
${SENTINEL}. Then ask how many hours a week reps lose to manual CRM entry.

PITCH
Northstar writes CRM notes automatically from calls and email. Lead with time saved, never with features.

PRICING OBJECTION
Never discount. Reframe to payback period and offer a two-week pilot on one team.

CLOSE
Propose a specific 15-minute slot this week with whoever owns the CRM.`;

const transcript = [
  { speaker: "customer", text: "Alex here.", atSec: 0 },
  { speaker: "rep", text: "Hi Alex, this is Peter from Northstar. I'll keep this to two minutes.", atSec: 3 },
  { speaker: "customer", text: "Go on.", atSec: 6 },
  { speaker: "rep", text: "Northstar writes your CRM notes automatically from calls and email, so your reps get hours back every week.", atSec: 12 },
  { speaker: "customer", text: "That's more expensive than what we pay today. Why switch?", atSec: 20 },
  { speaker: "rep", text: "Fair. Most teams see payback inside a quarter — a two-week pilot on one team shows the real hours saved before you commit.", atSec: 30 },
  { speaker: "customer", text: "I have to jump.", atSec: 40 },
  { speaker: "rep", text: "Before you go — can I grab fifteen minutes Thursday with you and whoever owns the CRM?", atSec: 45 },
];
const session = (id) => ({ id, repId: "rep-25", startedAt: new Date(Date.now() - 60_000).toISOString(), durationSec: 60, outcome: "scored", transcript });

// 1. Baseline: no script active -> old behaviour.
let cur = await get("/api/script");
if (cur.script) console.log("note: a script was already active; the baseline check below assumes none — clearing is manual (Upstash) so we test order-of-operations on a fresh session id instead.");
const noScriptRun = cur.script ? null : await (await post("/api/training/score", session(randomUUID()))).json();
if (noScriptRun) {
  assert.equal(noScriptRun.grading, "model", "baseline must be a real model grade, not placeholder");
  assert.equal("scriptSimilarity" in noScriptRun.session, false, "no script -> no scriptSimilarity");
  console.log(`1. no script:    grading=${noScriptRun.grading} scriptSimilarity=absent  ✔ (old behaviour)`);
}

// 2. Upload.
const up = await post("/api/script", { text: SCRIPT });
assert.equal(up.status, 201, "POST /api/script");
const { script } = await up.json();
assert.equal((await get("/api/script")).script.id, script.id, "GET returns the active script");
console.log(`2. uploaded:     id=${script.id.slice(0, 8)} at ${script.uploadedAt}`);
assert.equal((await post("/api/script", { text: "too short" })).status, 400);

// 3. Score with the script active.
const sid = randomUUID();
const r = await post("/api/training/score", session(sid));
assert.equal(r.status, 200);
const scored = await r.json();
assert.equal(scored.grading, "model", "must be a real model grade");
const s = scored.session;
assert.equal(typeof s.scriptSimilarity, "number", "scriptSimilarity populated");
assert.ok(s.scriptSimilarity >= 0 && s.scriptSimilarity <= 100);
const cites = s.divergences.filter((d) => /headcount|Q3/i.test(d.scriptStep + " " + d.whatTheyDid + " " + d.aiReason));
const mentionsScript = /headcount|Q3|discovery/i.test(s.summary) || cites.length > 0;
console.log(`3. with script:  scriptSimilarity=${s.scriptSimilarity}  divergences=${s.divergences.length}  cite the skipped sentinel line: ${cites.length}`);
for (const d of s.divergences) console.log(`     [${d.verdict}] ${d.scriptStep} — ${d.whatTheyDid}`);
console.log(`     summary: ${s.summary.slice(0, 220)}${s.summary.length > 220 ? "…" : ""}`);
assert.ok(mentionsScript, "grade should reference the uploaded script's content (the skipped Q3 headcount line), not generic boilerplate");

// 4. Persist and read back on the rep.
assert.equal((await post("/api/training/sessions", s)).status, 201);
const rep = await get("/api/reps/rep-25?source=training");
assert.equal(rep.rep.scriptSimilarity, s.scriptSimilarity, "RepView.scriptSimilarity reflects the saved session");
const live = await get("/api/reps/rep-25?source=live");
assert.equal("scriptSimilarity" in live.rep, false, "live view never carries it");
const list = await get("/api/reps?source=training");
assert.deepEqual(Object.keys(list.teamAverage).sort(), ["closeRate", "objectionHandling", "scriptAdherence", "technicalAnswers"], "teamAverage shape unchanged");
console.log(`4. persisted:    GET /api/reps/rep-25?source=training -> scriptSimilarity=${rep.rep.scriptSimilarity}; live view has none; teamAverage shape unchanged`);
console.log("PASS");
