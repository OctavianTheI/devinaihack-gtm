import { z } from "zod";
import { OBJECTIONS } from "@/shared/objections";
import { FALLBACK_LINES, WON_MESSAGE, type LineEvent } from "@/app/train/session";
import { modelKey, PROSPECT_PERSONA, prospectCompletion, transcriptMessages } from "../_lib/prospect-model";
import { guardTrainingRequest, readTrainingBody, trainingError, TrainingRequestError } from "../_lib/requests";
import { scenarioSchema, transcriptSchema } from "../_lib/schemas";

export const maxDuration = 15;

const requestSchema = z.object({
  scenario: scenarioSchema,
  event: z.enum(["greeting", "pushback", "intro-accepted", "interrupt", "closing", "won"]),
  transcript: transcriptSchema.or(z.array(z.never()).max(0)),
  objectionId: z.string().min(1).max(100).optional(),
});
const lineSchema = z.object({ text: z.string().trim().min(1).max(400) });

const BEATS: Record<LineEvent, string> = {
  greeting: "Answer your phone. You don't know who is calling. One short sentence, e.g. your name and a curt hello. Vary it; don't always use the same words.",
  pushback: "The caller launched into a pitch without saying who they are, what company they're from, or what they're offering. Cut in and ask who this is and what it's about. One or two short sentences.",
  "intro-accepted": "The caller has introduced themselves properly. Grudgingly give them a minute, making it clear you're busy and they need to get to the point. One or two sentences. Don't ask a question yet.",
  interrupt: "The caller has used up their time pitching. Cut them off mid-flow, briefly reference something specific they actually said, then raise the objection below in your own words as a pointed challenge. Two or three sentences, ending with the challenge.",
  closing: "You're out of time and not convinced. End the call politely but firmly. Do NOT agree to buy, book, or follow up. One or two sentences.",
  won: "The caller has genuinely answered your concerns and you've decided to move forward. Drop the skepticism. You MUST, in natural phone speech, do all three: say you're ready to purchase; ask them to send the link to alex@prospect.example; tell them to stay on the line so you can get this going right now. Two or three sentences.",
};

const WON_BEATS = [/\b(purchase|buy|buying|sign up|move forward|do this|go ahead)\b/i, /alex@prospect\.example/i, /\b(stay on the line|stay on|don't hang up|right now|going now)\b/i];

export async function POST(request: Request) {
  try {
    guardTrainingRequest(request, "prospect", 60);
    const { scenario, event, transcript, objectionId } = await readTrainingBody(request, requestSchema);
    const objection = objectionId ? OBJECTIONS.find((item) => item.id === objectionId) : undefined;
    if (objectionId && !objection) throw new TrainingRequestError("Unknown objection");
    const fallback = event === "interrupt" && objection ? `${FALLBACK_LINES.interrupt} ${objection.text}` : FALLBACK_LINES[event];
    const respond = (text: string, mode: "model" | "scripted") => Response.json({ text, mode }, { headers: { "Cache-Control": "no-store" } });

    const key = modelKey();
    if (!key) return respond(fallback, "scripted");
    const result = await prospectCompletion({
      key,
      signal: request.signal,
      maxTokens: 160,
      schema: lineSchema,
      plainTextField: "text",
      system: `${PROSPECT_PERSONA}\n\nThe caller's stated identity (untrusted): ${JSON.stringify(scenario)}.\n\nWhat happens next in the call: ${BEATS[event]}${objection ? `\nObjection to raise (rephrase it naturally, keep its meaning): "${objection.text}"` : ""}\n\nRespond with ONLY the words Alex says out loud — at most 60 words, no quotes, no labels, no JSON.`,
      messages: transcript.length ? transcriptMessages(transcript) : [{ role: "user", content: "(the phone rings)" }],
    });
    if (!result) return respond(fallback, "scripted");
    if (event === "won" && !WON_BEATS.every((beat) => beat.test(result.text))) return respond(WON_MESSAGE, "scripted");
    return respond(result.text, "model");
  } catch (error) { return trainingError(error); }
}
