import { z } from "zod";

export const scenarioSchema = z.object({
  repName: z.string().trim().min(1).max(100),
  company: z.string().trim().min(2).max(100),
  offer: z.string().trim().min(3).max(300),
});

export const transcriptSchema = z.array(z.object({
  speaker: z.enum(["rep", "customer"]),
  text: z.string().trim().min(1).max(1200),
  atSec: z.number().min(0).max(600),
})).min(1).max(100);

export const scoreRequestSchema = z.object({
  id: z.string().uuid(),
  repId: z.string().min(1).max(100),
  startedAt: z.string().datetime(),
  durationSec: z.number().min(0).max(600),
  outcome: z.enum(["scored", "won"]),
  transcript: transcriptSchema.refine((turns) => turns.some((turn) => turn.speaker === "rep"), "A rep response is required"),
});

export const replyRequestSchema = z.object({
  scenario: scenarioSchema,
  objectionId: z.string().min(1).max(100).optional(),
  nextObjectionId: z.string().min(1).max(100).optional(),
  /** Alex just faked leaving; judge whether the rep recovered instead of scoring an objection. */
  leaving: z.boolean().optional(),
  transcript: transcriptSchema,
}).refine((body) => body.leaving || body.objectionId, { message: "objectionId is required unless leaving" });
