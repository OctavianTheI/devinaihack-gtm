import { scoreTranscript } from "@/shared/scorer";
import { getRep } from "@/shared/store";
import type { TrainingSession } from "@/shared/types";
import { guardTrainingRequest, readTrainingBody, trainingError, TrainingRequestError } from "../_lib/requests";
import { scoreRequestSchema } from "../_lib/schemas";
import { PLAIN_JSON_MODEL, scoreWithRubric } from "../_lib/rubric-scorer";

export const maxDuration = 60;

export async function POST(request: Request) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    guardTrainingRequest(request, "score", Number(process.env.TRAINING_SCORE_RATE_LIMIT) || 6);
    const input = await readTrainingBody(request, scoreRequestSchema);
    if (!(await getRep(input.repId, "live"))) throw new TrainingRequestError("Unknown repId", 404);
    if (input.transcript.some((turn) => turn.atSec > input.durationSec + 1)) throw new TrainingRequestError("Transcript timestamps exceed the session duration");
    const key = process.env.SCORER_API_KEY ?? process.env.OPENAI_API_KEY;
    const useRubricAdapter = Boolean(key && process.env.SCORER_MODEL === PLAIN_JSON_MODEL);
    const result = await Promise.race([
      useRubricAdapter ? scoreWithRubric(input.transcript, key!, request.signal) : scoreTranscript(input.transcript),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new TrainingRequestError("Scoring timed out. Your transcript is retained; please retry.", 504)), 45_000); }),
    ]);
    const session: TrainingSession = { ...input, ...result };
    return Response.json({ session, grading: result.summary.startsWith("Placeholder score") ? "placeholder" : "model", scorer: useRubricAdapter ? "rubric-adapter" : "shared" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return trainingError(error); }
  finally { clearTimeout(timeout); }
}
