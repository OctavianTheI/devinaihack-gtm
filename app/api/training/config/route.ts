import { pickObjections } from "@/shared/objections";

export const dynamic = "force-dynamic";

export async function GET() {
  const picked = pickObjections(5);
  const technical = picked.find((item) => item.category === "technical");
  const objections = technical ? [picked[0], technical, ...picked.slice(1).filter((item) => item !== technical)] : picked;
  return Response.json({
    objections,
    voice: process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "browser",
    replies: process.env.SCORER_API_KEY || process.env.OPENAI_API_KEY ? "model" : "scripted",
  }, { headers: { "Cache-Control": "no-store" } });
}
