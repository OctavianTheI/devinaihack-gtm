import { z } from "zod";
import { guardTrainingRequest, readTrainingBody, trainingError, TrainingRequestError } from "../_lib/requests";

export const maxDuration = 15;
const speechSchema = z.object({ text: z.string().trim().min(1).max(800) });

export async function POST(request: Request) {
  try {
    guardTrainingRequest(request, "speech");
    const { text } = await readTrainingBody(request, speechSchema, 4000);
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new TrainingRequestError("ElevenLabs is not configured. Use browser voice.", 503);
    const voice = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_22050_32`, {
      method: "POST",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
      headers: { "Content-Type": "application/json", "xi-api-key": key, Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5" }),
    });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) {
      await response.body?.cancel();
      throw new TrainingRequestError("ElevenLabs is unavailable. Use browser voice.", 503);
    }
    return new Response(await response.arrayBuffer(), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (error) { return trainingError(error); }
}
