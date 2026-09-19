import { scoreTranscript } from "@/shared/scorer";
import { getRep } from "@/shared/store";
import type { TrainingSession } from "@/shared/types";
import { guardTrainingRequest, readTrainingBody, trainingError, TrainingRequestError } from "../_lib/requests";
import { scoreRequestSchema } from "../_lib/schemas";

export const maxDuration = 60;

export async function POST(request: Request) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    guardTrainingRequest(request, "score", 6);
    const input = await readTrainingBody(request, scoreRequestSchema);
    if (!getRep(input.repId, "live")) throw new TrainingRequestError("Unknown repId", 404);
    if (input.transcript.some((turn) => turn.atSec > input.durationSec + 1)) throw new TrainingRequestError("Transcript timestamps exceed the session duration");
    const result = await Promise.race([
      scoreTranscript(input.transcript),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new TrainingRequestError("Scoring timed out. Your transcript is retained; please retry.", 504)), 45_000); }),
    ]);
    const session: TrainingSession = { ...input, ...result };
    return Response.json({ session, grading: result.summary.startsWith("Placeholder score") ? "placeholder" : "model" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return trainingError(error); }
  finally { clearTimeout(timeout); }
}
