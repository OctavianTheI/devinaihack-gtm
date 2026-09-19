// Shared data contract between the Monitor tab (Owner A) and the Train tab (Owner B).
// Change this file only through a small PR both owners agree on — every API
// route and UI component on both sides is built against these shapes.

export type DataSource = "live" | "training";

export interface Scores {
  closeRate: number; // 0-100
  objectionHandling: number; // 0-100 (AI rated)
  scriptAdherence: number; // 0-100
  technicalAnswers: number; // 0-100
}

export type Verdict = "good" | "neutral" | "bad";

export interface Divergence {
  scriptStep: string; // e.g. "Pricing objection"
  whatTheyDid: string; // short description of the deviation
  verdict: Verdict;
  aiReason: string; // why the AI rated it that way
}

export interface Rep {
  id: string;
  name: string;
  biggestDealUsd: number;
  live: Scores; // from real calls (dummy data)
  training: Scores | null; // from voice-coach sessions, null until they train
  divergences: Divergence[]; // derived from live and/or training data
}

// What GET /api/reps and GET /api/reps/:id return: a Rep plus the
// scores/divergences resolved for the requested source, so the UI never has
// to branch on `source` itself.
export interface RepView extends Rep {
  source: DataSource;
  scores: Scores; // = live or training scores depending on `source`
  hasTraining: boolean;
}

export interface TrainingTranscriptTurn {
  speaker: "rep" | "customer";
  text: string;
  atSec: number; // seconds since session start
}

export interface TrainingSession {
  id: string;
  repId: string;
  startedAt: string; // ISO timestamp
  durationSec: number;
  transcript: TrainingTranscriptTurn[];
  scores: Scores; // closeRate here = AI's estimate of close likelihood
  divergences: Divergence[];
  summary: string;
}

// Body B's Train tab POSTs to /api/training/sessions. `id` and `startedAt`
// are optional because the server can generate them if the client omits them.
export type TrainingSessionInput = Omit<TrainingSession, "id" | "startedAt"> & {
  id?: string;
  startedAt?: string;
};
