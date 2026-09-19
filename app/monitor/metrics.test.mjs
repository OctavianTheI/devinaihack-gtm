import assert from "node:assert/strict";
import { test } from "node:test";
import { deltaDescription, formatMetric, hasScores, metricValue, scoreDeltas, sortReps } from "./metrics.ts";

const scores = { closeRate: 50, objectionHandling: 60, scriptAdherence: 70, technicalAnswers: 80 };
const rep = {
  id: "test", name: "Test Rep", biggestDealUsd: 150000, avgDealSizeUsd: 50000,
  monthlySalesVolume: 9, live: scores, training: null, scores,
  hasTraining: false, source: "live", divergences: [],
};

test("untrained reps never expose fallback live scores as training results", () => {
  const untrained = { ...rep, source: "training" };
  assert.equal(hasScores(untrained), false);
  for (const key of Object.keys(scores)) assert.equal(metricValue(untrained, key), null);
  assert.equal(metricValue(untrained, "avgDealSizeUsd"), 50000);
  assert.deepEqual(scoreDeltas(untrained, scores), []);
});

test("live and trained reps expose the API-resolved score set", () => {
  assert.equal(metricValue(rep, "closeRate"), 50);
  const trained = { ...rep, source: "training", hasTraining: true, scores: { ...scores, closeRate: 90 } };
  assert.equal(metricValue(trained, "closeRate"), 90);
});

test("sorts every metric numerically without mutating input", () => {
  for (const key of ["biggestDealUsd", "avgDealSizeUsd", "monthlySalesVolume", ...Object.keys(scores)]) {
    const lower = { ...rep, id: "low", [key]: 1, scores: { ...scores, [key]: 1 } };
    const input = [rep, lower];
    assert.equal(sortReps(input, key, "asc")[0].id, "low");
    assert.equal(sortReps(input, key, "desc")[0].id, "test");
    assert.equal(input[0].id, "test");
  }
});

test("missing training scores sort last in either direction, including zero scores", () => {
  const untrained = { ...rep, source: "training" };
  const trained = { ...rep, id: "trained", source: "training", hasTraining: true, scores: { ...scores, closeRate: 0 } };
  for (const direction of ["asc", "desc"]) {
    assert.equal(sortReps([untrained, trained], "closeRate", direction)[1].id, "test");
  }
});

test("doing best and worst use the largest signed deltas, not raw scores", () => {
  const average = { closeRate: 20, objectionHandling: 70, scriptAdherence: 70, technicalAnswers: 99 };
  const deltas = scoreDeltas(rep, average);
  assert.equal(deltas[0].key, "closeRate");
  assert.equal(deltas[0].delta, 30);
  assert.equal(deltas.at(-1).key, "technicalAnswers");
  assert.equal(deltas.at(-1).delta, -19);
  assert.deepEqual(scoreDeltas(rep, null), []);
});

test("summaries accurately describe all-above, all-below, and tied scores", () => {
  assert.equal(deltaDescription("closeRate", 4), "4 percentage points above the team average");
  assert.equal(deltaDescription("technicalAnswers", -4), "4 points below the team average");
  assert.equal(deltaDescription("scriptAdherence", 0), "In line with the team average");
  assert.equal(formatMetric("biggestDealUsd", 150000), "$150,000");
  assert.equal(formatMetric("closeRate", 0), "0%");
  assert.equal(formatMetric("monthlySalesVolume", 9), "9");
});
