// Runtime validation for the one payload that crosses the A/B boundary live:
// the TrainingSession the Train tab POSTs to the Monitor tab's API. Keep
// this in sync with shared/types.ts — it's the actual enforcement of that
// contract, not just documentation of it.

import { z } from "zod";

export const scoresSchema = z.object({
  closeRate: z.number().min(0).max(100),
  objectionHandling: z.number().min(0).max(100),
  scriptAdherence: z.number().min(0).max(100),
  technicalAnswers: z.number().min(0).max(100),
});

// Uploaded script text. Bounded so a paste can't blow the model's context;
// ~20k chars is a very long call script already.
export const scriptTextSchema = z.string().trim().min(20, "Script is too short to grade against").max(20_000, "Script must be under 20,000 characters");

export const divergenceSchema = z.object({
  scriptStep: z.string().min(1),
  whatTheyDid: z.string().min(1),
  verdict: z.enum(["good", "neutral", "bad"]),
  aiReason: z.string().min(1),
});

const transcriptTurnSchema = z.object({
  speaker: z.enum(["rep", "customer"]),
  text: z.string(),
  atSec: z.number().min(0),
});

export const trainingSessionInputSchema = z.object({
  id: z.string().optional(),
  repId: z.string().min(1),
  startedAt: z.string().datetime().optional(),
  durationSec: z.number().min(0),
  transcript: z.array(transcriptTurnSchema),
  outcome: z.enum(["scored", "won"]),
  scores: scoresSchema,
  divergences: z.array(divergenceSchema),
  summary: z.string(),
  scriptSimilarity: z.number().min(0).max(100).optional(),
});

export type TrainingSessionInputParsed = z.infer<typeof trainingSessionInputSchema>;
