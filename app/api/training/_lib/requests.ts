import type { ZodType } from "zod";

export class TrainingRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

const requests = new Map<string, { count: number; until: number }>();

export function guardTrainingRequest(request: Request, bucket: string, limit = 40) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" || forwardedProtocol === "http" ? `${forwardedProtocol}:` : url.protocol;
  const expectedOrigin = new URL(`${protocol}//${host}`).origin;
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expectedOrigin)) {
    throw new TrainingRequestError("Cross-origin requests are not allowed", 403);
  }
  const now = Date.now();
  for (const [key, value] of requests) if (value.until <= now) requests.delete(key);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${bucket}:${ip}`;
  const current = requests.get(key) ?? { count: 0, until: now + 60_000 };
  if (current.count >= limit) throw new TrainingRequestError("Too many requests. Please wait a minute and retry.", 429);
  if (requests.size >= 1000 && !requests.has(key)) throw new TrainingRequestError("Training is busy. Please try again shortly.", 503);
  requests.set(key, { ...current, count: current.count + 1 });
}

export async function readTrainingBody<T>(request: Request, schema: ZodType<T>, maxBytes = 48_000): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new TrainingRequestError("Expected application/json", 415);
  if (!request.body) throw new TrainingRequestError("Body must be JSON");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new TrainingRequestError("Request is too large", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new TrainingRequestError("Body must be JSON"); }
  const result = schema.safeParse(body);
  if (!result.success) throw new TrainingRequestError("Invalid training request");
  return result.data;
}

export function trainingError(error: unknown): Response {
  return Response.json(
    { error: error instanceof TrainingRequestError ? error.message : "Training service is temporarily unavailable. Please retry." },
    { status: error instanceof TrainingRequestError ? error.status : 503, headers: { "Cache-Control": "no-store" } }
  );
}
