import assert from "node:assert/strict";
import { test } from "node:test";
import { createCall, reduceCall, hasIntroduction, isFreshAnswer, fallbackReply, fallbackRecovery, decideEnding, FALLBACK_LINES, PITCH_DURATION_SEC, OBJECTION_DURATION_SEC, FAKE_LEAVE_WINDOW_SEC } from "./session.ts";

const scenario = { repName: "Sarah Kim", company: "Northstar", offer: "CRM automation" };
const objections = [
  { id: "price", category: "price", text: "Why does it cost so much?" },
  { id: "technical", category: "technical", text: "How does it integrate?" },
];
const begin = () => createCall({ id: "call-1", repId: "rep-01", scenario, objections, pitchSec: PITCH_DURATION_SEC, objectionSec: OBJECTION_DURATION_SEC }, 0);
// The model phrases each beat; tests voice it with the fallback text (or a custom line) then mark it spoken.
const line = (state, now = 0, text = state.pending.fallback) => reduceCall(state, { type: "line", callId: state.id, pendingId: state.pending.id, text, now });
const spoken = (state, now = 0) => reduceCall(state, { type: "spoken", callId: state.id, pendingId: state.pending.id, now });
const voiced = (state, now = 0, text) => spoken(state.pending.kind === "line" ? line(state, now, text) : state, now);
const rep = (state, text, now = 1000) => reduceCall(state, { type: "rep", callId: state.id, phase: state.phase, text, now });
const readyPitch = () => voiced(rep(voiced(begin()), "Hi, I'm Sarah from Northstar. We offer CRM automation."), 2000);
const readyChallenge = () => voiced(reduceCall(readyPitch(), { type: "tick", now: 32000 }), 33000);
const reply = (state, handled, now, extra = {}) => reduceCall(state, { type: "reply", callId: state.id, pendingId: state.pending.id, reply: "That addresses my concern.", handled, mode: "model", now, ...extra });

test("requires identity, company, and offer before accepting the introduction", () => {
  assert.equal(hasIntroduction("We offer CRM automation that saves you hours.", scenario), false);
  assert.equal(hasIntroduction("I'm Sarah with Northstar and we offer CRM automation.", scenario), true);
  assert.equal(hasIntroduction("Sarah Northstar CRM", scenario), false);
});

test("every prospect beat is a model-phrased line with a scripted fallback, committed to the transcript only once voiced", () => {
  let state = begin();
  assert.deepEqual([state.pending.kind, state.pending.event], ["line", "greeting"]);
  assert.equal(state.transcript.length, 0, "nothing in the transcript until the line is generated");
  state = line(state, 0, "Yeah, Alex here.");
  assert.deepEqual([state.pending.kind, state.pending.text, state.transcript.at(-1).text], ["speak", "Yeah, Alex here.", "Yeah, Alex here."]);
  const blank = line(begin(), 0, "   ");
  assert.equal(blank.pending.text, FALLBACK_LINES.greeting, "empty generation falls back to the scripted line");
});

test("asks who is calling once, then proceeds after another response", () => {
  let state = rep(voiced(begin()), "Our software saves you time.");
  assert.equal(state.phase, "intro");
  assert.equal(state.pending.event, "pushback");
  state = rep(voiced(state), "We can automate work for your team.", 2000);
  assert.equal(state.phase, "pitch");
  assert.equal(state.pending.event, "intro-accepted");
});

test("pitch gets 30 seconds after the prospect finishes speaking; the interruption carries the first objection", () => {
  const state = readyPitch();
  assert.equal(state.deadline, 32000);
  assert.equal(reduceCall(state, { type: "tick", now: 31999 }).phase, "pitch");
  const interrupted = reduceCall(state, { type: "tick", now: 32000 });
  assert.equal(interrupted.phase, "challenge");
  assert.deepEqual([interrupted.pending.event, interrupted.pending.objectionId], ["interrupt", "price"]);
  assert.match(interrupted.pending.fallback, /stop you there.*cost so much/i);
  assert.equal(interrupted.deadline, null, "clock is parked while Alex interrupts");
  assert.equal(interrupted.frozenMs, OBJECTION_DURATION_SEC * 1000);
});

test("the objection clock only runs while it is the rep's turn", () => {
  let state = readyChallenge();
  assert.equal(state.deadline, 33000 + 60000);
  state = rep(state, "Here is my answer to your concern.", 40000);
  assert.equal(state.deadline, null);
  assert.equal(state.frozenMs, 53000, "53s left when the rep finished talking");
  assert.equal(reduceCall(state, { type: "tick", now: 200000 }).phase, "challenge", "a slow model does not burn the rep's time");
  state = spoken(reply(state, false, 48000, { next: "And how does it plug into our CRM?" }), 50000);
  assert.equal(state.deadline, 50000 + 53000, "clock resumes with the same time left");
  assert.match(state.transcript.at(-1).text, /That addresses my concern\. And how does it plug into our CRM\?/);
});

test("when the objection clock runs out Alex fakes leaving and gives the rep a 20s window", () => {
  let state = readyChallenge();
  state = reduceCall(state, { type: "tick", now: 93000 });
  assert.equal(state.phase, "leaving");
  assert.equal(state.pending.event, "fake-leave");
  assert.equal(state.frozenMs, FAKE_LEAVE_WINDOW_SEC * 1000);
  state = voiced(state, 95000);
  assert.equal(state.deadline, 95000 + FAKE_LEAVE_WINDOW_SEC * 1000);
  const stale = reduceCall(state, { type: "reply", callId: state.id, pendingId: 999, reply: "Late", handled: true, mode: "model", now: 96000 });
  assert.equal(stale, state);
});

test("silence after the fake leave means he really goes: walkaway, saved as scored", () => {
  let state = voiced(reduceCall(readyChallenge(), { type: "tick", now: 93000 }), 95000);
  state = reduceCall(state, { type: "tick", now: 95000 + FAKE_LEAVE_WINDOW_SEC * 1000 });
  assert.deepEqual([state.phase, state.ending, state.outcome, state.pending.event], ["closing", "walkaway", "scored", "walkaway"]);
  assert.equal(voiced(state, 120000).phase, "complete");
});

test("the ending is decided from handled objections plus recovering the fake leave", () => {
  assert.equal(decideEnding(0, false), "walkaway");
  assert.equal(decideEnding(1, false), "callback");
  assert.equal(decideEnding(0, true), "callback");
  assert.equal(decideEnding(1, true), "won");
  assert.equal(decideEnding(2, false), "won");
});

test("recovering the fake leave with one objection handled wins; without any it earns a callback", () => {
  const leaving = () => voiced(reduceCall(readyChallenge(), { type: "tick", now: 93000 }), 95000);
  const recover = (state) => rep(state, "Before you go — can I grab fifteen minutes on your calendar Thursday to walk your ops lead through the pilot numbers?", 100000);
  let state = recover(leaving());
  assert.equal(state.pending.kind, "reply");
  assert.equal(state.deadline, null, "clock parks while Alex judges the recovery");
  state = reduceCall(state, { type: "reply", callId: state.id, pendingId: state.pending.id, reply: "", handled: true, mode: "model", now: 101000 });
  assert.deepEqual([state.phase, state.ending, state.outcome, state.pending.event], ["closing", "callback", "scored", "callback"]);

  let won = rep(readyChallenge(), "I understand the budget concern. A small pilot lets you measure the hours saved and demonstrate payback before committing.", 35000);
  won = spoken(reply(won, true, 36000), 37000);
  won = voiced(reduceCall(won, { type: "tick", now: won.deadline }), won.deadline + 2000);
  assert.equal(won.phase, "leaving");
  won = recover(won);
  won = reduceCall(won, { type: "reply", callId: won.id, pendingId: won.pending.id, reply: "", handled: true, mode: "model", now: 101000 });
  assert.deepEqual([won.ending, won.outcome, won.pending.event], ["won", "won", "won"]);
  assert.match(won.pending.fallback, /push my next meeting/i);
  assert.match(won.pending.fallback, /contract/i);
  assert.match(won.pending.fallback, /email.*channel/i);

  let lost = recover(leaving());
  lost = reduceCall(lost, { type: "reply", callId: lost.id, pendingId: lost.pending.id, reply: "", handled: false, mode: "model", now: 101000 });
  assert.deepEqual([lost.ending, lost.pending.event], ["walkaway", "walkaway"]);
});

test("scripted recovery judgement wants a concrete ask, not an apology", () => {
  assert.equal(fallbackRecovery("Before you go, could we book fifteen minutes on Thursday to walk through the pilot numbers?").handled, true);
  assert.equal(fallbackRecovery("Okay, no problem, sorry to bother you, bye.").handled, false);
  assert.equal(fallbackRecovery("Sure.").handled, false);
});

test("wins only after two distinct handled objections with non-repeated answers", () => {
  let state = rep(readyChallenge(), "I understand the budget concern. A small pilot lets you measure the hours saved and demonstrate payback before committing.", 35000);
  state = spoken(reply(state, true, 36000), 37000);
  assert.equal(state.handledIds.length, 1);
  state = rep(state, "Your integration question is fair. The CRM connects through its documented API, and we can validate the export workflow with your engineer.", 40000);
  state = reply(state, true, 41000);
  assert.equal(state.outcome, "won");
  assert.equal(state.phase, "closing");
  assert.equal(state.pending.event, "won");
  assert.equal(state.ending, "won");
  assert.match(state.pending.fallback, /push my next meeting/i);
  assert.match(state.pending.fallback, /procurement|contract/i);
  assert.match(state.pending.fallback, /email|channel/i);
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

test("scripted fallback distinguishes relevant explanations from evasive answers and carries the next objection", () => {
  const good = fallbackReply("price", "I understand your budget concern. A short pilot lets you measure the hours saved and compare the return on investment before you commit.", objections[1]);
  assert.equal(good.handled, true);
  assert.equal(good.next, "How does it integrate?");
  assert.equal(fallbackReply("price", "I don't know. It is just better and better and better.").handled, false);
});

test("silence times out and stale events from a previous call cannot mutate a new call", () => {
  const state = voiced(begin());
  assert.equal(reduceCall(state, { type: "tick", now: 45000 }).phase, "closing");
  assert.equal(reduceCall(state, { type: "rep", callId: "old-call", phase: "intro", text: "Hello", now: 1000 }), state);
  assert.equal(reduceCall(state, { type: "rep", callId: state.id, phase: "pitch", text: "Wrong phase", now: 1000 }), state);
});

test("manual finish preserves transcript and normal outcome without waiting for timers", () => {
  const state = rep(readyPitch(), "Our CRM removes duplicate admin work for your team.", 5000);
  const done = reduceCall(state, { type: "finish", now: 6000 });
  assert.equal(done.phase, "complete");
  assert.equal(done.outcome, "scored");
  assert.equal(done.transcript.at(-1).text, "Our CRM removes duplicate admin work for your team.");
  assert.equal(done.pending, null);
});
