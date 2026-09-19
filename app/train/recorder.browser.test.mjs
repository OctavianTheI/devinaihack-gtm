import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(process.env.PLAYWRIGHT_CLI ?? import.meta.url)("playwright");
const base = process.env.TRAINING_TEST_BASE_URL ?? "http://127.0.0.1:3002";
const browser = await chromium.launch({ headless: true });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.rec = { loud: false, uploads: 0, trackStops: 0, recorders: 0 };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => window.rec.trackStops++ }] }),
    } });
    window.AudioContext = class {
      createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData(buffer) { buffer.fill(window.rec.loud ? 0.2 : 0.001); } }; }
      createMediaStreamSource() { return { connect() {} }; }
      async close() {}
    };
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor() { this.state = "inactive"; this.mimeType = "audio/webm;codecs=opus"; window.rec.recorders++; }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([new Uint8Array(3000)], { type: "audio/webm" }) });
        setTimeout(() => this.onstop?.(), 0);
      }
    };
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    window.speechSynthesis = { cancel() {}, speak(u) { setTimeout(() => u.onend?.(), 10); } };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  });
  await page.route("**/api/training/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), voice: "browser", stt: "elevenlabs" } });
  });
  await page.route("**/api/training/transcribe", async (route) => {
    await page.evaluate(() => window.rec.uploads++);
    assert.match(route.request().headers()["content-type"], /^audio\//);
    await route.fulfill({ json: { text: "Hi, I'm Sarah from Northstar. We offer CRM automation to reduce admin work." } });
  });
  await page.goto(`${base}/train`);
  await page.getByRole("option", { name: "Sarah Kim" }).waitFor({ state: "attached" });
  await page.getByLabel(/fictional details/).check();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByText("Speak, then pause", { exact: false }).waitFor();
  await page.evaluate(() => { window.rec.loud = true; });
  await page.getByText("Listening… keep going", { exact: false }).waitFor();
  await page.evaluate(() => { window.rec.loud = false; });
  await page.getByText("Make your pitch", { exact: true }).waitFor({ timeout: 10_000 });
  assert.match(await page.locator("details ol li").nth(1).textContent(), /Sarah from Northstar/);
  await page.getByRole("button", { name: "Cancel call", exact: true }).click();
  const state = await page.evaluate(() => window.rec);
  assert.equal(state.uploads, 1);
  assert.ok(state.trackStops >= 1, "microphone tracks released on cancel");
  assert.deepEqual(errors, []);
  console.log("PASS recorder path: no SpeechRecognition needed, volume-based pause detection, one upload per utterance, Scribe text accepted as intro, mic released on cancel");
} finally { await browser.close(); }
