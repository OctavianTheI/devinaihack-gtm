// Scoring rubric both the pre-seeded dummy data and the voice-coach's AI
// scorer are meant to follow, so a "closeRate: 80" means the same thing on
// either tab. Owner B's scorer should return JSON matching Scores/Divergence
// using these definitions as the grading instructions to the model.

export const RUBRIC = {
  closeRate: {
    label: "Close likelihood",
    description:
      "Did the rep ask for the sale and move the deal forward? Score higher for a clear, well-timed ask; lower for stalling or never asking.",
  },
  objectionHandling: {
    label: "Objection handling",
    description:
      "Acknowledges the concern, answers it directly, reframes to value, and doesn't get defensive or repeat the same rebuttal.",
  },
  scriptAdherence: {
    label: "Script adherence",
    description:
      "Hits the required script steps (opening, discovery, pitch, objection handling, close) in a sensible order. Deviations are fine when they work — record them as Divergences rather than only penalizing them.",
  },
  technicalAnswers: {
    label: "Technical answers",
    description:
      "Accuracy and clarity when answering product/technical questions. Score lower for guessing or dodging.",
  },
} as const;

/** The four criteria every session is graded on (= the keys of RUBRIC).
 * Kept separate from `keyof Scores`, which also includes the optional
 * scriptSimilarity. */
export const CORE_CRITERIA = ["closeRate", "objectionHandling", "scriptAdherence", "technicalAnswers"] as const;
export type CoreCriterion = (typeof CORE_CRITERIA)[number];

// Extra criterion graded only when a manager has uploaded the team's actual
// script (Script in types.ts). Deliberately NOT part of RUBRIC so consumers
// that iterate RUBRIC's keys keep rendering exactly the four core scores.
export const SCRIPT_SIMILARITY_CRITERION = {
  label: "Script similarity",
  description:
    "How closely the call followed the team's uploaded script specifically — its talking points, key phrases, and ordering — not just the generic step list. 100 = the script was followed faithfully; a low score means large sections were skipped or replaced.",
} as const;

export const SCRIPT_STEPS = [
  "Opening",
  "Discovery",
  "Pitch",
  "Objection handling",
  "Technical Q&A",
  "Close",
] as const;

// Prompt fragment for the AI scorer (Owner B wires this into whatever model
// call grades a transcript). Keep it in sync with the Scores/Divergence types.
export const SCORER_INSTRUCTIONS = `
You are grading a sales training call transcript. Score each criterion 0-100:
${Object.entries(RUBRIC)
  .map(([key, r]) => `- ${key} (${r.label}): ${r.description}`)
  .join("\n")}

Also list any Divergences: points where the rep departed from the standard
script steps (${SCRIPT_STEPS.join(", ")}). For each, note what they did, and
rate it "good" (should be adopted into the script), "neutral", or "bad".

Return strict JSON: { "scores": Scores, "divergences": Divergence[], "summary": string }
`.trim();
