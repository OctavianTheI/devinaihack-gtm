// Unit checks for shared/scorer.ts that need no server, no Redis, no model.
// Run: node --experimental-strip-types --test shared/scorer.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreTranscript, __internal } from "./scorer.ts";
import { RUBRIC } from "./rubric.ts";

const { buildInstructions, extractJson } = __internal;
const script = { id: "s1", text: "OPENING: Hi, this is {name} from Northstar. PRICING: Lead with payback period, never discount first.", uploadedAt: "2026-09-19T12:00:00.000Z" };

test("without a script the prompt is the generic step-list assessment and never mentions scriptSimilarity", () => {
  const p = buildInstructions(RUBRIC, null);
  assert.match(p, /standard\s+script steps \(Opening, Discovery, Pitch/);
  assert.doesNotMatch(p, /scriptSimilarity/);
  assert.doesNotMatch(p, /TEAM SCRIPT/);
});

test("with a script the prompt embeds the actual text and asks for scriptSimilarity + line-level divergences", () => {
  const p = buildInstructions(RUBRIC, script);
  assert.match(p, /Lead with payback period, never discount first/, "uploaded text is in the prompt verbatim");
  assert.match(p, /"scriptSimilarity":number/, "asked for in the JSON shape");
  assert.match(p, /quote the specific script line/i, "divergences must cite the script");
  assert.match(p, /scriptAdherence is still about the generic step order/, "the two scores are distinguished");
  assert.match(p, /uploaded 2026-09-19T12:00:00.000Z/);
});

test("very long scripts are truncated with a visible marker rather than silently cut", () => {
  const long = { ...script, text: "x".repeat(20_000) };
  const p = buildInstructions(RUBRIC, long);
  assert.match(p, /script truncated for length/);
  assert.ok(p.length < 12_000 + 3_000, "12k of script + instructions, not 20k");
});

test("extractJson tolerates fences and a leading sentence, and passes clean JSON through", () => {
  const obj = '{"scores":{"closeRate":1},"summary":"ok"}';
  assert.equal(extractJson(obj), obj);
  assert.equal(extractJson("```json\n" + obj + "\n```"), obj);
  assert.equal(extractJson("Here is the grading:\n" + obj + "\nHope this helps."), obj);
});

test("with no key configured, scoring falls back to the placeholder and never fabricates scriptSimilarity", async () => {
  const saved = { a: process.env.SCORER_API_KEY, b: process.env.OPENAI_API_KEY };
  delete process.env.SCORER_API_KEY; delete process.env.OPENAI_API_KEY;
  try {
    const r = await scoreTranscript([{ speaker: "rep", text: "Hi, I'm Sarah from Northstar. Ready to get started?" }]);
    assert.match(r.summary, /^Placeholder score/);
    assert.equal("scriptSimilarity" in r, false);
    for (const k of Object.keys(RUBRIC)) assert.ok(r.scores[k] >= 0 && r.scores[k] <= 100);
  } finally {
    if (saved.a) process.env.SCORER_API_KEY = saved.a;
    if (saved.b) process.env.OPENAI_API_KEY = saved.b;
  }
});
