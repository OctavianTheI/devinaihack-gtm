import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";

let mode = "valid";
let providerCalls = 0;
let providerFailure;
const expected = { scores: { closeRate: 65, objectionHandling: 72, scriptAdherence: 81, technicalAnswers: 67 }, divergences: [], summary: "Acknowledge the concern and make the next step concrete." };
const provider = createServer(async (request, response) => {
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    assert.equal(data.model, "inclusionai/ling-3.0-flash-vl:free");
    assert.equal(data.response_format, undefined);
    assert.equal(data.max_tokens, 1200);
    assert.match(data.messages[0].content, /Objection handling/);
    providerCalls++;
    response.setHeader("content-type", "application/json");
    if (mode === "http-error") { response.writeHead(400); response.end(JSON.stringify({ error: "Synthetic provider error" })); return; }
    const content = mode === "invalid-json" ? "not JSON" : JSON.stringify(mode === "invalid-scores" ? { ...expected, scores: { ...expected.scores, closeRate: 999 } } : expected);
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  } catch (error) { providerFailure = error; response.writeHead(500); response.end("{}"); }
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
const port = process.env.TRAINING_ADAPTER_TEST_PORT ?? "3003";
const base = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", port], {
  stdio: ["ignore", "ignore", "pipe"],
  env: { ...process.env, SCORER_API_KEY: "synthetic-local-test-key", SCORER_MODEL: "inclusionai/ling-3.0-flash-vl:free", SCORER_BASE_URL: `http://127.0.0.1:${provider.address().port}` },
});
app.stderr.on("data", () => {});
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (app.exitCode !== null) throw new Error("Adapter test server failed to start; check that the test port is available and npm run build succeeded.");
    try { ready = (await fetch(`${base}/api/training/config`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(ready, true);
  const input = { id: randomUUID(), repId: "rep-26", startedAt: new Date().toISOString(), durationSec: 10, outcome: "scored", transcript: [{ speaker: "rep", text: "I'm Peter from Northstar. We offer CRM automation.", atSec: 1 }] };
  const score = () => fetch(`${base}/api/training/score`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(input) });
  const result = await score();
  if (providerFailure) throw providerFailure;
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.grading, "model");
  assert.equal(data.scorer, "rubric-adapter");
  assert.deepEqual(data.session.scores, expected.scores);
  assert.equal(data.session.id, input.id);
  for (const next of ["invalid-json", "invalid-scores", "http-error"]) {
    mode = next;
    const failure = await score();
    assert.equal(failure.status, 503);
    assert.match((await failure.json()).error, /retained/);
  }
  assert.equal(providerCalls, 4);
  console.log("PASS: model-specific rubric adapter omits JSON mode, reuses shared rubric/schema, validates model results, and retains failed sessions for retry. Mock provider only; no real credentials or credits used.");
} finally {
  if (app.exitCode === null) { app.kill("SIGTERM"); await once(app, "exit"); }
  provider.closeAllConnections();
  provider.close();
}
