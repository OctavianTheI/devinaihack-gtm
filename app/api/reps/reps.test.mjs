import assert from "node:assert/strict";
import { test } from "node:test";

const baseUrl = process.env.REPS_TEST_BASE_URL;
const options = { skip: !baseUrl };

for (const source of ["live", "training"]) {
  test(`${source} list and detail return matching scores and team averages`, options, async () => {
    const response = await fetch(`${baseUrl}/api/reps?source=${source}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const data = await response.json();
    assert.equal(data.source, source);
    assert.ok(Array.isArray(data.reps));
    const scored = data.reps.filter((rep) => source === "live" || rep.hasTraining);
    if (scored.length === 0) {
      assert.equal(data.teamAverage, null);
    } else {
      for (const key of ["closeRate", "objectionHandling", "scriptAdherence", "technicalAnswers"]) {
        assert.equal(data.teamAverage[key], Math.round(scored.reduce((sum, rep) => sum + rep.scores[key], 0) / scored.length));
      }
    }
    for (const rep of data.reps) {
      assert.equal(rep.source, source);
      assert.equal(rep.hasTraining, rep.training !== null);
      assert.deepEqual(rep.scores, source === "live" ? rep.live : rep.training ?? rep.live);
      for (const key of ["biggestDealUsd", "avgDealSizeUsd", "monthlySalesVolume"]) {
        assert.equal(typeof rep[key], "number");
      }
    }
    if (data.reps.length) {
      const rep = data.reps[0];
      const detailResponse = await fetch(`${baseUrl}/api/reps/${encodeURIComponent(rep.id)}?source=${source}`);
      assert.equal(detailResponse.status, 200);
      assert.equal(detailResponse.headers.get("cache-control"), "no-store");
      const detail = await detailResponse.json();
      assert.deepEqual(detail.rep, rep);
      assert.deepEqual(detail.teamAverage, data.teamAverage);
    }
  });
}

test("omitted or unrecognized sources retain the existing live default", options, async () => {
  for (const query of ["", "?source=unknown"]) {
    const response = await fetch(`${baseUrl}/api/reps${query}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).source, "live");
  }
});

test("a missing rep returns a 404 JSON error", options, async () => {
  const response = await fetch(`${baseUrl}/api/reps/nonexistent-monitor-test-rep`);
  assert.equal(response.status, 404);
  assert.equal(typeof (await response.json()).error, "string");
});
