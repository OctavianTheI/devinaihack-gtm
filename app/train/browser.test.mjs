import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(process.env.PLAYWRIGHT_CLI ?? import.meta.url)("playwright");
const base = process.env.TRAINING_TEST_BASE_URL ?? "http://127.0.0.1:3002";
const browser = await chromium.launch({ headless: true });
const errors = [];
const intro = "Hi, I'm Sarah from Northstar. We offer CRM automation to reduce repetitive admin work.";

async function pageForCall({ voice = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  if (voice) {
    await page.addInitScript(() => {
      window.voiceEvents = { spoken: [], stops: 0, trackStops: 0, echo: false };
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => window.voiceEvents.trackStops++ }] }),
      } });
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
        cancel() {},
        speak(utterance) {
          if (window.activeRecognition) window.voiceEvents.echo = true;
          window.voiceEvents.spoken.push(utterance.text);
          setTimeout(() => utterance.onend?.(), 20);
        },
      } });
      window.SpeechRecognition = window.webkitSpeechRecognition = class {
        start() { window.activeRecognition = this; }
        abort() { window.voiceEvents.stops++; if (window.activeRecognition === this) window.activeRecognition = null; }
      };
    });
    await page.route("**/api/training/config", async route => {
      const response = await route.fetch();
      await route.fulfill({ json: { ...await response.json(), voice: "browser", stt: "browser" } });
    });
  }
  await page.goto(`${base}/train`);
  await page.getByRole("option", { name: "Sarah Kim" }).waitFor({ state: "attached" });
  assert.equal(await page.getByRole("button", { name: "Play", exact: true }).isDisabled(), true);
  if (!voice) {
    await page.getByRole("button", { name: "Typed practice", exact: true }).click();
    await page.getByLabel("Speak prospect replies").uncheck();
  }
  await page.getByText("Adjust practice length", { exact: true }).click();
  await page.locator("#pitch-duration").focus();
  await page.keyboard.press("Home");
  await page.locator("#objection-duration").focus();
  await page.keyboard.press("Home");
  await page.getByLabel(/fictional details/).check();
  await page.clock.install();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  return page;
}

async function typeTurn(page, text) {
  await page.waitForFunction(() => !document.querySelector("#rep-response")?.disabled && document.querySelector("#rep-response"));
  await page.getByLabel("Your response", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send response", exact: true }).click();
}

try {
  const normal = await pageForCall();
  let scored;
  normal.on("response", async response => {
    if (new URL(response.url()).pathname === "/api/training/score" && response.ok()) scored = await response.json();
  });
  await typeTurn(normal, "This tool saves you time.");
  await normal.locator("blockquote").filter({ hasText: "Sorry, who is this?" }).waitFor();
  await typeTurn(normal, intro);
  await normal.getByText("Make your pitch", { exact: true }).waitFor();
  await normal.waitForFunction(() => !document.querySelector("#rep-response").disabled);
  await normal.clock.fastForward(11_000);
  await normal.locator("blockquote").filter({ hasText: "Let me stop you there" }).waitFor();
  await normal.clock.fastForward(21_000);
  await normal.locator("blockquote").filter({ hasText: "I need to jump" }).waitFor();
  await normal.getByText("keep him on the line", { exact: false }).waitFor();
  await normal.clock.fastForward(21_000);
  await normal.locator("blockquote").filter({ hasText: "This isn't for us" }).waitFor();
  await normal.getByText("Results saved to the demo training store.", { exact: true }).waitFor({ timeout: 60_000 });
  await normal.getByText("Alex walked away", { exact: true }).waitFor();
  assert.equal(scored.session.outcome, "scored");
  assert.equal(scored.session.transcript.filter(turn => turn.text.includes("Sorry, who is this?")).length, 1);
  if (process.env.TRAINING_TEST_PLACEHOLDER === "1") {
    assert.equal(scored.grading, "placeholder");
    await normal.getByText(/NOT AI-rated results/).waitFor();
  }
  assert.equal(await normal.locator("details[open] ol li").count(), scored.session.transcript.length);
  await normal.getByRole("link", { name: /View team performance/ }).click();
  await normal.getByRole("button", { name: "Training data", exact: true }).click();
  await normal.getByRole("row", { name: /Sarah Kim/ }).waitFor();
  assert.match(await normal.getByRole("row", { name: /Sarah Kim/ }).innerText(), new RegExp(`${scored.session.scores.closeRate}%`));
  await normal.close();
  console.log("PASS normal flow: intro pushback once, 10s/20s sliders, interruption, fake leave ignored -> walkaway, shared scoring, save, transcript, Monitor loop");

  const callback = await pageForCall();
  let callbackOutcome;
  callback.on("request", request => { if (new URL(request.url()).pathname === "/api/training/sessions") callbackOutcome = request.postDataJSON().outcome; });
  await typeTurn(callback, intro);
  await callback.getByText("Make your pitch", { exact: true }).waitFor();
  await callback.waitForFunction(() => !document.querySelector("#rep-response").disabled);
  await callback.clock.fastForward(11_000);
  await callback.locator("blockquote").filter({ hasText: "Let me stop you there" }).waitFor();
  await callback.waitForFunction(() => !document.querySelector("#rep-response").disabled);
  await callback.clock.fastForward(21_000);
  await callback.locator("blockquote").filter({ hasText: "I need to jump" }).waitFor();
  await typeTurn(callback, "Before you go — can I grab fifteen minutes on your calendar Thursday to walk your ops lead through the pilot numbers?");
  await callback.locator("blockquote").filter({ hasText: "Call me back in ten, fifteen minutes" }).waitFor();
  await callback.getByText("Results saved to the demo training store.", { exact: true }).waitFor({ timeout: 60_000 });
  await callback.getByText("Callback earned", { exact: true }).waitFor();
  assert.equal(callbackOutcome, "scored", "callback is not representable in the shared outcome type");
  await callback.close();
  console.log("PASS callback flow: no objections handled, fake leave recovered with a concrete ask -> 'call me back in 10-15'");

  const won = await pageForCall();
  let savedOutcome;
  won.on("request", request => { if (new URL(request.url()).pathname === "/api/training/sessions") savedOutcome = request.postDataJSON().outcome; });
  await typeTurn(won, intro);
  await won.getByText("Make your pitch", { exact: true }).waitFor();
  await won.waitForFunction(() => !document.querySelector("#rep-response").disabled);
  await won.clock.fastForward(11_000);
  await typeTurn(won, "I understand the budget concern. A small pilot lets you measure the hours saved and demonstrate payback before committing.");
  await won.locator("blockquote").filter({ hasText: "existing CRM" }).waitFor();
  await typeTurn(won, "Your integration question is fair. The CRM connects through its documented API, and we can validate the export workflow with your engineer.");
  await won.locator("blockquote").filter({ hasText: "push my next meeting" }).waitFor();
  await won.getByText("Results saved to the demo training store.", { exact: true }).waitFor({ timeout: 60_000 });
  await won.getByText("Practice deal won", { exact: true }).waitFor();
  assert.equal(savedOutcome, "won");
  await won.setViewportSize({ width: 390, height: 844 });
  assert.equal(await won.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await won.close();
  console.log("PASS win flow: two distinct objections -> Alex pushes his meeting and brings in contract owners, outcome won, mobile layout");

  const retry = await pageForCall();
  let scoreCalls = 0;
  let saveCalls = 0;
  await retry.route("**/api/training/score", async route => {
    scoreCalls++;
    const data = route.request().postDataJSON();
    await route.fulfill({ json: { session: { ...data, scores: { closeRate: 65, objectionHandling: 66, scriptAdherence: 67, technicalAnswers: 68 }, divergences: [], summary: "Synthetic browser-test grading." }, grading: "model" } });
  });
  await retry.route("**/api/training/sessions", async route => {
    saveCalls++;
    if (saveCalls === 1) await route.fulfill({ status: 503, json: { error: "Synthetic save failure" } });
    else await route.fulfill({ json: { saved: true } });
  });
  await typeTurn(retry, intro);
  await retry.getByRole("button", { name: "End & score" }).click();
  await retry.getByRole("button", { name: "Retry saving" }).waitFor();
  await retry.getByRole("button", { name: "Retry saving" }).click();
  await retry.getByText("Results saved to the demo training store.", { exact: true }).waitFor();
  assert.equal(scoreCalls, 1);
  assert.equal(saveCalls, 2);
  await retry.close();
  console.log("PASS save recovery: score retained and save retried without a second scoring call");

  const voice = await pageForCall({ voice: true });
  const emit = async text => {
    await voice.waitForFunction(() => Boolean(window.activeRecognition?.onresult));
    await voice.evaluate(value => window.activeRecognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: value } }] }), text);
    await voice.clock.fastForward(1500);
  };
  await emit(intro);
  await voice.getByText("Make your pitch", { exact: true }).waitFor();
  await voice.waitForFunction(() => Boolean(window.activeRecognition?.onresult));
  await voice.clock.fastForward(11_000);
  await voice.locator("blockquote").filter({ hasText: "Let me stop you there" }).waitFor();
  await voice.getByRole("button", { name: "Cancel call", exact: true }).click();
  const events = await voice.evaluate(() => ({ ...window.voiceEvents, active: Boolean(window.activeRecognition) }));
  assert.equal(events.active, false);
  assert.equal(events.echo, false);
  assert.equal(events.trackStops, 1);
  assert.ok(events.stops >= 2);
  assert.ok(events.spoken.some(text => text.includes("stop you there")));
  await voice.close();
  console.log("PASS mocked voice devices: spoken prospect, recognized rep intro, timed interruption, no mic echo, cleanup on cancel");
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
