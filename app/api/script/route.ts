import { NextRequest, NextResponse } from "next/server";
import { getActiveScript, setActiveScript, StoreError } from "@/shared/store";
import { scriptTextSchema } from "@/shared/validation";

const noStore = { headers: { "Cache-Control": "no-store" } };

// GET /api/script -> { script: Script | null }
// The team's currently active sales script, or null if none has been uploaded.
export async function GET() {
  try {
    return NextResponse.json({ script: await getActiveScript() }, noStore);
  } catch (err) {
    return storeFailure(err);
  }
}

// POST /api/script  body: { text: string }  (or raw text/plain)
// Uploads/replaces the active script. Plain text only — a textarea paste.
// Every training session scored from now on is graded against this text.
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expectedOrigin(req))) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403, ...noStore });
  }
  if (Number(req.headers.get("content-length")) > 64_000) {
    return NextResponse.json({ error: "Script is too large" }, { status: 413, ...noStore });
  }

  let text: unknown;
  try {
    const type = req.headers.get("content-type") ?? "";
    text = type.includes("application/json") ? (await req.json())?.text : await req.text();
  } catch {
    return NextResponse.json({ error: "Body must be JSON { text } or plain text" }, { status: 400, ...noStore });
  }
  const parsed = scriptTextSchema.safeParse(text);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid script" }, { status: 400, ...noStore });
  }

  try {
    const script = await setActiveScript(parsed.data);
    return NextResponse.json({ script }, { status: 201, ...noStore });
  } catch (err) {
    return storeFailure(err);
  }
}

function expectedOrigin(req: NextRequest): string {
  const url = new URL(req.url);
  const host = req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return new URL(`${proto === "https" || proto === "http" ? proto : url.protocol.replace(":", "")}://${host}`).origin;
}

function storeFailure(err: unknown) {
  if (err instanceof StoreError) return NextResponse.json({ error: err.message }, { status: err.status, ...noStore });
  throw err;
}
