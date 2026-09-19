import { guardTrainingRequest, trainingError, TrainingRequestError } from "../_lib/requests";

export const maxDuration = 30;
const MAX_AUDIO_BYTES = 4_000_000;

export async function POST(request: Request) {
  try {
    guardTrainingRequest(request, "transcribe", 90);
    const type = request.headers.get("content-type") ?? "";
    if (!/^(audio|video)\//.test(type)) throw new TrainingRequestError("Expected an audio recording", 415);
    const declared = Number(request.headers.get("content-length"));
    if (declared > MAX_AUDIO_BYTES) throw new TrainingRequestError("Recording is too large", 413);
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new TrainingRequestError("Server transcription is not configured.", 503);
    const audio = await request.arrayBuffer();
    if (audio.byteLength > MAX_AUDIO_BYTES) throw new TrainingRequestError("Recording is too large", 413);
    if (audio.byteLength < 1000) return Response.json({ text: "" }, { headers: { "Cache-Control": "no-store" } });

    const form = new FormData();
    form.set("model_id", process.env.ELEVENLABS_STT_MODEL_ID ?? "scribe_v2");
    form.set("language_code", "en");
    form.set("tag_audio_events", "false");
    form.set("file", new Blob([audio], { type: type.split(";")[0] }), `turn.${type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : "webm"}`);
    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new TrainingRequestError("Transcription is unavailable right now. Continue with typed input.", 503);
    }
    const data = (await response.json()) as { text?: string };
    return Response.json({ text: (data.text ?? "").trim() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return trainingError(error); }
}
