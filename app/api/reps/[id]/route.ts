import { NextRequest, NextResponse } from "next/server";
import { getRep, teamAverage } from "@/shared/store";
import type { DataSource } from "@/shared/types";

function parseSource(value: string | null): DataSource {
  return value === "training" ? "training" : "live";
}

// GET /api/reps/:id?source=live|training
// Returns one rep resolved for the requested source, plus the team average
// for the same source so the detail panel can show deltas.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const source = parseSource(req.nextUrl.searchParams.get("source"));
  const rep = await getRep(id, source);
  if (!rep) {
    return NextResponse.json({ error: `No rep with id "${id}"` }, { status: 404 });
  }
  const average = await teamAverage(source);
  return NextResponse.json(
    { rep, teamAverage: average },
    { headers: { "Cache-Control": "no-store" } }
  );
}
