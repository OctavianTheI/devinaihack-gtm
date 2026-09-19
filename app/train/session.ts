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
export interface CallState extends CallSettings {
  phase: Phase;
  startedMs: number;
  now: number;
  deadline: number | null;
  transcript: TrainingTranscriptTurn[];
  pending: { id: number; kind: "speak" | "reply"; text: string } | null;
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
  | { type: "spoken"; callId: string; pendingId: number; now: number }
  | { type: "reply"; callId: string; pendingId: number; reply: string; handled: boolean; mode: "model" | "scripted"; now: number };

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

export function fallbackReply(category: ObjectionPrompt["category"], answer: string) {
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
    mode: "scripted" as const,
  };
}

function append(state: CallState, speaker: TrainingTranscriptTurn["speaker"], text: string): CallState {
  return { ...state, transcript: [...state.transcript, { speaker, text, atSec: Math.max(0, Math.round((state.now - state.startedMs) / 1000)) }] };
}

function say(state: CallState, text: string): CallState {
  return { ...append(state, "customer", text), sequence: state.sequence + 1, pending: { id: state.sequence + 1, kind: "speak", text } };
}

export function createCall(settings: CallSettings, now: number): CallState {
  if (!settings.objections.length) throw new Error("At least one objection is required");
  return say({
    ...settings, phase: "intro", startedMs: now, now, deadline: now + INTRO_DURATION_SEC * 1000,
    transcript: [], pending: null, sequence: 0, pushedBack: false, introductionComplete: false,
    objectionIndex: 0, handledIds: [], answers: [], outcome: "scored", scripted: false,
  }, "Hello? Alex speaking.");
}

export function reduceCall(state: CallState | null, action: CallAction): CallState | null {
  if (action.type === "begin") return action.state;
  if (action.type === "reset") return null;
  if (!state || state.phase === "complete") return state;
  if ("callId" in action && action.callId !== state.id) return state;
  if (action.type === "finish") return { ...state, now: action.now, phase: "complete", deadline: null, pending: null };
  if (action.type === "tick") {
    const next = { ...state, now: action.now };
    if (state.deadline === null || action.now < state.deadline) return next;
    if (state.phase === "pitch") {
      return say({ ...next, phase: "challenge", deadline: action.now + state.objectionSec * 1000 }, `Let me stop you there. ${state.objections[0].text}`);
    }
    if (state.phase === "intro" || state.phase === "challenge") {
      return say({ ...next, phase: "closing", deadline: null }, "I've got to get back to work. Thanks for the call. Let's leave it there for today.");
    }
    return next;
  }
  if (action.type === "spoken") {
    if (state.pending?.kind !== "speak" || state.pending.id !== action.pendingId) return state;
    return {
      ...state, now: action.now, pending: null,
      phase: state.phase === "closing" ? "complete" : state.phase,
      deadline: state.phase === "pitch" && state.deadline === null ? action.now + state.pitchSec * 1000 : state.deadline,
    };
  }
  if (action.type === "rep") {
    if (state.pending || action.phase !== state.phase || state.phase === "closing") return state;
    const text = action.text.trim().slice(0, 1200);
    if (!text) return state;
    if (state.transcript.length >= MAX_TRANSCRIPT_TURNS - 3) return { ...state, phase: "complete", pending: null, deadline: null, now: action.now };
    const next = append({ ...state, now: action.now }, "rep", text);
    if (state.phase === "intro") {
      const introductionComplete = hasIntroduction(next.transcript.filter((turn) => turn.speaker === "rep").map((turn) => turn.text).join(" "), state.scenario);
      if (!introductionComplete && !state.pushedBack) {
        return say({ ...next, pushedBack: true }, "Sorry, who is this? What's your company, and what are you offering?");
      }
      return say({ ...next, phase: "pitch", deadline: null, introductionComplete }, "I'm between meetings, but go ahead. Tell me why this is worth my time.");
    }
    if (state.phase === "challenge") {
      return { ...next, sequence: state.sequence + 1, pending: { id: state.sequence + 1, kind: "reply", text } };
    }
    return next;
  }
  if (state.pending?.kind !== "reply" || state.pending.id !== action.pendingId || state.phase !== "challenge") return state;
  if (state.deadline !== null && action.now >= state.deadline) return reduceCall(state, { type: "tick", now: action.now });
  const answer = state.pending.text;
  const objection = state.objections[state.objectionIndex];
  const handled = action.handled && isFreshAnswer(answer, state.answers);
  const handledIds = handled ? [...new Set([...state.handledIds, objection.id])] : state.handledIds;
  const next = { ...state, now: action.now, answers: [...state.answers, answer], handledIds, scripted: state.scripted || action.mode === "scripted" };
  if (handledIds.length >= 2) return say({ ...next, phase: "closing", deadline: null, outcome: "won" }, WON_MESSAGE);
  const objectionIndex = (state.objectionIndex + 1) % state.objections.length;
  return say({ ...next, objectionIndex }, `${action.reply} ${state.objections[objectionIndex].text}`);
}
