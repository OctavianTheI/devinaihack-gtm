import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const base = process.env.TRAINING_TEST_BASE_URL;
const readOnly = { skip: !base };
const writeTests = { skip: !base || process.env.TRAINING_TEST_WRITE !== "1" };
const post = (path, data, headers = {}) => fetch(`${base}/api/training/${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data),
});
const input = () => ({
  id: randomUUID(), repId: "rep-26", startedAt: new Date().toISOString(), durationSec: 8,
  outcome: "scored", transcript: [
    { speaker: "customer", text: "Hello? Alex speaking.", atSec: 0 },
    { speaker: "rep", text: "I'm Peter from Northstar. We offer CRM automation to save your team time. Can we discuss next steps?", atSec: 2 },
  ],
});

test("config includes varied shared objections, technical questions, and no credentials", readOnly, async () => {
  const response = await fetch(`${base}/api/training/config`);
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.equal(config.objections.length, 5);
  assert.equal(config.objections[1].category, "technical");
  assert.equal(new Set(config.objections.map(item => item.category)).size, 5);
  assert.ok(["elevenlabs", "browser"].includes(config.voice));
  assert.ok(["elevenlabs", "browser"].includes(config.stt));
  assert.ok(["model", "scripted"].includes(config.replies));
  assert.deepEqual(Object.keys(config).sort(), ["objections", "replies", "stt", "voice"]);
});

test("transcribe route validates content type, size, and origin before calling ElevenLabs", readOnly, async () => {
  const send = (body, headers) => fetch(`${base}/api/training/transcribe`, { method: "POST", headers, body });
  assert.equal((await send(new Uint8Array(2000), { "content-type": "audio/webm", origin: "https://untrusted.example" })).status, 403);
  assert.equal((await send("{}", { "content-type": "application/json" })).status, 415);
  assert.equal((await send(new Uint8Array(4_000_001), { "content-type": "audio/webm" })).status, 413);
  const tiny = await send(new Uint8Array(200), { "content-type": "audio/webm" });
  assert.ok([200, 503].includes(tiny.status));
  if (tiny.status === 200) assert.deepEqual(await tiny.json(), { text: "" });
});

test("prospect route phrases every beat, validates input, and falls back to scripted lines", readOnly, async () => {
  const scenario = { repName: "Sarah Kim", company: "Northstar", offer: "CRM automation" };
  const greeting = await post("prospect", { scenario, event: "greeting", transcript: [] });
  assert.equal(greeting.status, 200);
  const body = await greeting.json();
  assert.ok(["model", "scripted"].includes(body.mode));
  assert.ok(body.text.length > 0 && body.text.length <= 600);
  const interrupt = await post("prospect", { scenario, event: "interrupt", objectionId: "obj-price-1", transcript: [{ speaker: "rep", text: "We save you hours every week.", atSec: 5 }] });
  assert.equal(interrupt.status, 200);
  if ((await interrupt.json()).mode === "scripted") assert.match(body.text, /Alex/);
  assert.equal((await post("prospect", { scenario, event: "interrupt", objectionId: "nope", transcript: [] })).status, 400);
  assert.equal((await post("prospect", { scenario, event: "dance", transcript: [] })).status, 400);
});

test("provider routes reject cross-origin and invalid input before model calls", readOnly, async () => {
  for (const route of ["reply", "prospect", "speech", "score", "sessions"]) {
    assert.equal((await post(route, {}, { origin: "https://untrusted.example" })).status, 403);
    assert.equal((await post(route, {})).status, 400);
  }
  assert.equal((await post("speech", { text: "x".repeat(5000) })).status, 413);
  assert.equal((await fetch(`${base}/api/training/score`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status, 415);
});

test("scoring rejects unknown reps, customer-only transcripts, and invalid timestamps", readOnly, async () => {
  assert.equal((await post("score", { ...input(), repId: "no-such-rep" })).status, 404);
  assert.equal((await post("score", { ...input(), transcript: [{ speaker: "customer", text: "Hello", atSec: 0 }] })).status, 400);
  assert.equal((await post("score", { ...input(), durationSec: 0 })).status, 400);
});

test("scores through shared scorer, then saves a TrainingSession and safely replays its id", writeTests, async () => {
  const response = await post("score", input());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(["model", "placeholder"].includes(result.grading));
  if (process.env.TRAINING_TEST_PLACEHOLDER === "1") assert.equal(result.grading, "placeholder");
  assert.equal(result.session.outcome, "scored");
  for (const value of Object.values(result.session.scores)) assert.ok(value >= 0 && value <= 100);
  const saved = await post("sessions", result.session);
  assert.equal(saved.status, 201);
  const savedBody = await saved.json();
  assert.equal(savedBody.session.id, result.session.id);
  assert.deepEqual(savedBody.rep.training, result.session.scores);
  const replay = await post("sessions", result.session);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).session.id, result.session.id);
  assert.equal((await post("sessions", { ...result.session, summary: "Conflicting retry" })).status, 409);
});
