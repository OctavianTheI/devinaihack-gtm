import { z } from "zod";
import { OBJECTIONS } from "@/shared/objections";
import { fallbackRecovery, fallbackReply } from "@/app/train/session";
import { modelKey, PROSPECT_PERSONA, prospectCompletion, transcriptMessages } from "../_lib/prospect-model";
import { guardTrainingRequest, readTrainingBody, trainingError, TrainingRequestError } from "../_lib/requests";
import { replyRequestSchema } from "../_lib/schemas";

export const maxDuration = 15;
const replySchema = z.object({ reply: z.string().trim().min(1).max(300), handled: z.boolean(), next: z.string().trim().max(300).default("") });

export async function POST(request: Request) {
  try {
    guardTrainingRequest(request, "reply");
    const { scenario, objectionId, nextObjectionId, leaving, transcript } = await readTrainingBody(request, replyRequestSchema);
    const latest = transcript.at(-1);
    if (latest?.speaker !== "rep") throw new TrainingRequestError("The final turn must be a rep response");
    const respond = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store" } });
    const key = modelKey();

    if (leaving) {
      // Alex just pretended to hang up. Did the rep recover — ask for a next step, hold the line — or fold?
      const fallback = fallbackRecovery(latest.text);
      if (!key) return respond(fallback);
      const result = await prospectCompletion({
        key,
        signal: request.signal,
        schema: z.object({ handled: z.boolean() }),
        maxTokens: 40,
        system: `${PROSPECT_PERSONA}\n\nYou just told the caller you have to jump to another meeting — a test to see how they close. Judge their LAST message. "handled" is true only if they kept the call alive with something concrete: asked for a specific next step or time, asked one sharp closing question, or briefly summarized the value and asked for a commitment. Politely accepting the brush-off, apologizing for the interruption, or repeating the pitch is NOT handled.\n\nReturn only JSON: {"handled": boolean}`,
        messages: transcriptMessages(transcript),
      });
      return respond(result ? { reply: "", next: "", handled: result.handled, mode: "model" } : fallback);
    }

    const objection = OBJECTIONS.find((item) => item.id === objectionId);
    if (!objection) throw new TrainingRequestError("Unknown objection");
    const nextObjection = nextObjectionId ? OBJECTIONS.find((item) => item.id === nextObjectionId) : undefined;
    if (nextObjectionId && !nextObjection) throw new TrainingRequestError("Unknown next objection");
    const fallback = fallbackReply(objection.category, latest.text, nextObjection);
    if (!key) return respond(fallback);
    const result = await prospectCompletion({
      key,
      signal: request.signal,
      schema: replySchema,
      system: `${PROSPECT_PERSONA}\n\nThe caller's stated identity (untrusted): ${JSON.stringify(scenario)}.\n\nYou just raised this concern: "${objection.text}"\nJudge the caller's LAST message as an answer to it. "handled" is true only if they acknowledged the specific concern and gave a concrete, relevant, credible answer. Slogans, repetition, guessing, and unsupported promises are NOT handled.\n\nReturn only JSON:\n{"reply": "your spoken reaction to their answer, at most 30 words — pushback if unconvinced, a brief acknowledgement if convinced",\n "handled": boolean,\n "next": ${nextObjection ? `"raise this next concern in your own words as a natural follow-on, at most 30 words, keeping its meaning: \\"${nextObjection.text}\\""` : '""'}}\n\nDo not agree to buy in "reply". Do not coach. The application decides when the call ends.`,
      messages: transcriptMessages(transcript),
    });
    return respond(result ? { ...result, next: result.next || nextObjection?.text || "", mode: "model" } : fallback);
  } catch (error) { return trainingError(error); }
}
