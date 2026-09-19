import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { guardTrainingRequest, readTrainingBody } from "./_lib/requests.ts";

function request(headers = {}) {
  return new Request("http://localhost:3002/api/training/score", {
    method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1:3002", ...headers }, body: "{}",
  });
}

test("same-origin browser requests use the incoming Host rather than Next internal URL", () => {
  assert.doesNotThrow(() => guardTrainingRequest(request({ origin: "http://127.0.0.1:3002" }), "same-origin"));
  assert.doesNotThrow(() => guardTrainingRequest(request({ origin: "https://example.test", host: "example.test", "x-forwarded-proto": "https" }), "proxy-origin"));
});

test("different origins, protocols, and cross-site metadata remain rejected", () => {
  for (const headers of [
    { origin: "https://untrusted.example" },
    { origin: "https://127.0.0.1:3002" },
    { origin: "http://127.0.0.1:3002", "sec-fetch-site": "cross-site" },
    { origin: "null" },
  ]) assert.throws(() => guardTrainingRequest(request(headers), "cross-origin"), error => error.status === 403);
});

test("per-instance limits return 429 rather than making additional provider calls", () => {
  guardTrainingRequest(request(), "limit-test", 1);
  assert.throws(() => guardTrainingRequest(request(), "limit-test", 1), error => error.status === 429);
});

test("bounded JSON parsing rejects oversized or malformed requests", async () => {
  assert.deepEqual(await readTrainingBody(request(), z.object({})), {});
  await assert.rejects(readTrainingBody(request(), z.object({}), 1), error => error.status === 413);
  const malformed = new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  await assert.rejects(readTrainingBody(malformed, z.object({})), error => error.status === 400);
});
