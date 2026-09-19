import assert from "node:assert/strict";
import { test } from "node:test";
import { createCall, reduceCall, hasIntroduction, isFreshAnswer, fallbackReply, PITCH_DURATION_SEC, OBJECTION_DURATION_SEC } from "./session.ts";

const scenario = { repName: "Sarah Kim", company: "Northstar", offer: "CRM automation" };
const objections = [
  { id: "price", category: "price", text: "Why does it cost so much?" },
  { id: "technical", category: "technical", text: "How does it integrate?" },
];
const begin = () => createCall({ id: "call-1", repId: "rep-01", scenario, objections, pitchSec: PITCH_DURATION_SEC, objectionSec: OBJECTION_DURATION_SEC }, 0);
const spoken = (state, now = 0) => reduceCall(state, { type: "spoken", callId: state.id, pendingId: state.pending.id, now });
const rep = (state, text, now = 1000) => reduceCall(state, { type: "rep", callId: state.id, phase: state.phase, text, now });
const readyPitch = () => spoken(rep(spoken(begin()), "Hi, I'm Sarah from Northstar. We offer CRM automation."), 2000);
const readyChallenge = () => spoken(reduceCall(readyPitch(), { type: "tick", now: 32000 }), 33000);
const reply = (state, handled, now) => reduceCall(state, { type: "reply", callId: state.id, pendingId: state.pending.id, reply: "That addresses my concern.", handled, mode: "model", now });

test("requires identity, company, and offer before accepting the introduction", () => {
  assert.equal(hasIntroduction("We offer CRM automation that saves you hours.", scenario), false);
  assert.equal(hasIntroduction("I'm Sarah with Northstar and we offer CRM automation.", scenario), true);
  assert.equal(hasIntroduction("Sarah Northstar CRM", scenario), false);
});

test("asks who is calling once, then proceeds after another response", () => {
  let state = rep(spoken(begin()), "Our software saves you time.");
  assert.equal(state.phase, "intro");
  assert.match(state.pending.text, /Sorry, who is this/);
  state = rep(spoken(state), "We can automate work for your team.", 2000);
  assert.equal(state.phase, "pitch");
  assert.equal(state.transcript.filter(turn => /Sorry, who is this/.test(turn.text)).length, 1);
});

test("pitch gets 30 seconds after the prospect finishes speaking", () => {
  const state = readyPitch();
  assert.equal(state.deadline, 32000);
  assert.equal(reduceCall(state, { type: "tick", now: 31999 }).phase, "pitch");
  const interrupted = reduceCall(state, { type: "tick", now: 32000 });
  assert.equal(interrupted.phase, "challenge");
  assert.match(interrupted.pending.text, /stop you there/i);
  assert.equal(interrupted.deadline, 92000);
});

test("challenge deadline cancels pending model work and rejects late replies", () => {
  let state = rep(readyChallenge(), "Here is my answer to your concern.", 35000);
  const pendingId = state.pending.id;
  state = reduceCall(state, { type: "tick", now: 92000 });
  assert.equal(state.phase, "closing");
  assert.equal(state.outcome, "scored");
  const late = reduceCall(state, { type: "reply", callId: state.id, pendingId, reply: "Late response", handled: true, mode: "model", now: 93000 });
  assert.equal(late, state);
  assert.equal(spoken(state, 94000).phase, "complete");
});

test("wins only after two distinct handled objections with non-repeated answers", () => {
  let state = rep(readyChallenge(), "I understand the budget concern. A small pilot lets you measure the hours saved and demonstrate payback before committing.", 35000);
  state = spoken(reply(state, true, 36000), 37000);
  assert.equal(state.handledIds.length, 1);
  state = rep(state, "Your integration question is fair. The CRM connects through its documented API, and we can validate the export workflow with your engineer.", 40000);
  state = reply(state, true, 41000);
  assert.equal(state.outcome, "won");
  assert.equal(state.phase, "closing");
  assert.match(state.pending.text, /ready to purchase/i);
  assert.match(state.pending.text, /alex@prospect\.example/);
  assert.match(state.pending.text, /stay on the line/i);
});

test("repetition and short answers do not earn a win even when the model says handled", () => {
  const text = "I understand your concern and we can run a pilot to show measurable value for your team before making any commitment.";
  let state = spoken(reply(rep(readyChallenge(), text, 35000), true, 36000));
  state = reply(rep(state, text, 40000), true, 41000);
  assert.equal(state.handledIds.length, 1);
  assert.equal(state.outcome, "scored");
  assert.equal(isFreshAnswer("yes absolutely", []), false);
  assert.equal(isFreshAnswer(text + " Thanks!", [text]), false);
});

test("scripted fallback distinguishes relevant explanations from evasive answers", () => {
  assert.equal(fallbackReply("price", "I understand your budget concern. A short pilot lets you measure the hours saved and compare the return on investment before you commit.").handled, true);
  assert.equal(fallbackReply("price", "I don't know. It is just better and better and better.").handled, false);
});

test("silence times out and stale events from a previous call cannot mutate a new call", () => {
  const state = spoken(begin());
  assert.equal(reduceCall(state, { type: "tick", now: 45000 }).phase, "closing");
  assert.equal(reduceCall(state, { type: "rep", callId: "old-call", phase: "intro", text: "Hello", now: 1000 }), state);
  assert.equal(reduceCall(state, { type: "rep", callId: state.id, phase: "pitch", text: "Wrong phase", now: 1000 }), state);
});

test("an answer arriving after the deadline cannot win before the next timer tick", () => {
  const state = rep(readyChallenge(), "I understand your concern and can show measurable value with a small pilot for your team.", 35000);
  const late = reply(state, true, 92001);
  assert.equal(late.phase, "closing");
  assert.equal(late.outcome, "scored");
});

test("manual finish preserves transcript and normal outcome without waiting for timers", () => {
  const state = rep(readyPitch(), "Our CRM removes duplicate admin work for your team.", 5000);
  const done = reduceCall(state, { type: "finish", now: 6000 });
  assert.equal(done.phase, "complete");
  assert.equal(done.outcome, "scored");
  assert.equal(done.transcript.at(-1).text, "Our CRM removes duplicate admin work for your team.");
  assert.equal(done.pending, null);
});
