import type { ObjectionPrompt } from "../../shared/objections";
import type { TrainingTranscriptTurn } from "../../shared/types";

export const PITCH_DURATION_SEC = 30;
export const OBJECTION_DURATION_SEC = 60;
export const INTRO_DURATION_SEC = 45;
export const MAX_TRANSCRIPT_TURNS = 100;
export const WON_MESSAGE = "I'm ready to purchase. Send the link to alex@prospect.example and stay on the line. Let's get this going now.";

export interface Scenario { repName: string; company: string; offer: string }
export type Phase = "intro" | "pitch" | "challenge" | "closing" | "complete";
export interface CallSettings {
  id: string;
  repId: string;
  scenario: Scenario;
  objections: ObjectionPrompt[];
  pitchSec: number;
  objectionSec: number;
}
/** A beat the state machine has decided on; the model phrases it, the fallback is used if it can't. */
export type LineEvent = "greeting" | "pushback" | "intro-accepted" | "interrupt" | "closing" | "won";
export type Pending =
  | { id: number; kind: "line"; event: LineEvent; fallback: string; objectionId?: string }
  | { id: number; kind: "speak"; text: string }
  | { id: number; kind: "reply"; text: string };

export interface CallState extends CallSettings {
  phase: Phase;
  startedMs: number;
  now: number;
  /** Wall-clock deadline for the current phase, or null while the clock is parked. */
  deadline: number | null;
  /** Time left on the parked clock while the prospect is thinking/speaking. */
  frozenMs: number | null;
  transcript: TrainingTranscriptTurn[];
  pending: Pending | null;
  sequence: number;
  pushedBack: boolean;
  introductionComplete: boolean;
  objectionIndex: number;
  handledIds: string[];
  answers: string[];
  outcome: "scored" | "won";
  scripted: boolean;
}
export type CallAction =
  | { type: "begin"; state: CallState }
  | { type: "reset" }
  | { type: "tick"; now: number }
  | { type: "finish"; now: number }
  | { type: "rep"; callId: string; phase: Phase; text: string; now: number }
  | { type: "line"; callId: string; pendingId: number; text: string; now: number }
  | { type: "spoken"; callId: string; pendingId: number; now: number }
  | { type: "reply"; callId: string; pendingId: number; reply: string; handled: boolean; next?: string; mode: "model" | "scripted"; now: number };

export const FALLBACK_LINES: Record<LineEvent, string> = {
  greeting: "Hello? Alex speaking.",
  pushback: "Sorry, who is this? What's your company, and what are you offering?",
  "intro-accepted": "I'm between meetings, but go ahead. Tell me why this is worth my time.",
  interrupt: "Let me stop you there.",
  closing: "I've got to get back to work. Thanks for the call. Let's leave it there for today.",
  won: WON_MESSAGE,
};

const words = (text: string) => text.toLowerCase().replace(/[’]/g, "'").match(/[a-z0-9']+/g) ?? [];

export function hasIntroduction(text: string, scenario: Scenario): boolean {
  const normalized = words(text).join(" ");
  const name = words(scenario.repName)[0] ?? "";
  const company = words(scenario.company).join(" ");
  const offer = words(scenario.offer).filter((word) => word.length > 2);
  return /\b(i'm|i am|my name is|this is)\b/.test(normalized) &&
    normalized.split(" ").includes(name) && normalized.includes(company) &&
    offer.some((word) => normalized.split(" ").includes(word));
}

export function isFreshAnswer(text: string, previous: string[]): boolean {
  const tokens = words(text);
  if (tokens.length < 12) return false;
  const meaningful = new Set(tokens.filter((word) => word.length > 3));
  if (meaningful.size < 6) return false;
  return previous.every((answer) => {
    const other = new Set(words(answer).filter((word) => word.length > 3));
    const shared = [...meaningful].filter((word) => other.has(word)).length;
    return shared / Math.max(1, Math.min(meaningful.size, other.size)) < 0.8;
  });
}

export function fallbackReply(category: ObjectionPrompt["category"], answer: string, nextObjection?: ObjectionPrompt) {
  const evidence = {
    price: /\b(roi|return|payback|save|saved|savings|pilot|budget|cost)\b/i,
    trust: /\b(pilot|trial|reference|customer|case study|proof|measure)\b/i,
    timing: /\b(pilot|schedule|week|timeline|small|start|phase)\b/i,
    competitor: /\b(integration|workflow|different|compare|value|support)\b/i,
    technical: /\b(api|integration|integrate|crm|export|webhook|documentation|engineer)\b/i,
  };
  const handled = isFreshAnswer(answer, []) && evidence[category].test(answer) &&
    /\b(understand|fair|concern|agree|absolutely|makes sense|good question)\b/i.test(answer) &&
    !/\b(don't know|not sure|no idea|guarantee everything)\b/i.test(answer);
  return {
    reply: handled ? "That gives me something concrete to work with." : "I'm not convinced yet. I need a specific, credible answer, not a general promise.",
    handled,
    next: nextObjection?.text ?? "",
    mode: "scripted" as const,
  };
}

function append(state: CallState, speaker: TrainingTranscriptTurn["speaker"], text: string): CallState {
  return { ...state, transcript: [...state.transcript, { speaker, text, atSec: Math.max(0, Math.round((state.now - state.startedMs) / 1000)) }] };
}

/** Park the phase clock while the prospect thinks or talks; `spoken` resumes it. */
function freeze(state: CallState): CallState {
  return state.deadline === null ? state : { ...state, frozenMs: Math.max(0, state.deadline - state.now), deadline: null };
}

/** Queue a beat for the model to phrase. `fallback` is spoken verbatim if generation fails. */
function say(state: CallState, event: LineEvent, fallback: string, objectionId?: string): CallState {
  return { ...freeze(state), sequence: state.sequence + 1, pending: { id: state.sequence + 1, kind: "line", event, fallback, objectionId } };
}

/** Speak already-final text (used when the reply route generated the whole turn). */
function speak(state: CallState, text: string): CallState {
  return { ...freeze(append(state, "customer", text)), sequence: state.sequence + 1, pending: { id: state.sequence + 1, kind: "speak", text } };
}

export function createCall(settings: CallSettings, now: number): CallState {
  if (!settings.objections.length) throw new Error("At least one objection is required");
  return say({
    ...settings, phase: "intro", startedMs: now, now, deadline: null, frozenMs: INTRO_DURATION_SEC * 1000,
    transcript: [], pending: null, sequence: 0, pushedBack: false, introductionComplete: false,
    objectionIndex: 0, handledIds: [], answers: [], outcome: "scored", scripted: false,
  }, "greeting", FALLBACK_LINES.greeting);
}

export function reduceCall(state: CallState | null, action: CallAction): CallState | null {
  if (action.type === "begin") return action.state;
  if (action.type === "reset") return null;
  if (!state || state.phase === "complete") return state;
  if ("callId" in action && action.callId !== state.id) return state;
  if (action.type === "finish") return { ...state, now: action.now, phase: "complete", deadline: null, frozenMs: null, pending: null };
  if (action.type === "tick") {
    const next = { ...state, now: action.now };
    if (state.deadline === null || action.now < state.deadline) return next;
    if (state.phase === "pitch") {
      const objection = state.objections[0];
      return say({ ...next, phase: "challenge", deadline: null, frozenMs: state.objectionSec * 1000 }, "interrupt", `${FALLBACK_LINES.interrupt} ${objection.text}`, objection.id);
    }
    if (state.phase === "intro" || state.phase === "challenge") {
      return say({ ...next, phase: "closing", deadline: null, frozenMs: null }, "closing", FALLBACK_LINES.closing);
    }
    return next;
  }
  if (action.type === "line") {
    if (state.pending?.kind !== "line" || state.pending.id !== action.pendingId) return state;
    const text = action.text.trim().slice(0, 600) || state.pending.fallback;
    return { ...append({ ...state, now: action.now }, "customer", text), pending: { id: state.pending.id, kind: "speak", text } };
  }
  if (action.type === "spoken") {
    if (state.pending?.kind !== "speak" || state.pending.id !== action.pendingId) return state;
    return {
      ...state, now: action.now, pending: null,
      phase: state.phase === "closing" ? "complete" : state.phase,
      deadline: state.frozenMs === null ? state.deadline : action.now + state.frozenMs,
      frozenMs: null,
    };
  }
  if (action.type === "rep") {
    if (state.pending || action.phase !== state.phase || state.phase === "closing") return state;
    const text = action.text.trim().slice(0, 1200);
    if (!text) return state;
    if (state.transcript.length >= MAX_TRANSCRIPT_TURNS - 3) return { ...state, phase: "complete", pending: null, deadline: null, frozenMs: null, now: action.now };
    const next = append({ ...state, now: action.now }, "rep", text);
    if (state.phase === "intro") {
      const introductionComplete = hasIntroduction(next.transcript.filter((turn) => turn.speaker === "rep").map((turn) => turn.text).join(" "), state.scenario);
      if (!introductionComplete && !state.pushedBack) {
        return say({ ...next, pushedBack: true }, "pushback", FALLBACK_LINES.pushback);
      }
      return say({ ...next, phase: "pitch", deadline: null, frozenMs: state.pitchSec * 1000, introductionComplete }, "intro-accepted", FALLBACK_LINES["intro-accepted"]);
    }
    if (state.phase === "challenge") {
      return { ...freeze(next), sequence: state.sequence + 1, pending: { id: state.sequence + 1, kind: "reply", text } };
    }
    return next;
  }
  if (state.pending?.kind !== "reply" || state.pending.id !== action.pendingId || state.phase !== "challenge") return state;
  const answer = state.pending.text;
  const objection = state.objections[state.objectionIndex];
  const handled = action.handled && isFreshAnswer(answer, state.answers);
  const handledIds = handled ? [...new Set([...state.handledIds, objection.id])] : state.handledIds;
  const next = { ...state, now: action.now, answers: [...state.answers, answer], handledIds, scripted: state.scripted || action.mode === "scripted" };
  if (handledIds.length >= 2) return say({ ...next, phase: "closing", frozenMs: null, outcome: "won" }, "won", WON_MESSAGE);
  const objectionIndex = (state.objectionIndex + 1) % state.objections.length;
  return speak({ ...next, objectionIndex }, `${action.reply} ${action.next?.trim() || state.objections[objectionIndex].text}`);
}
