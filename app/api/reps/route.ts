import { NextRequest, NextResponse } from "next/server";
import { listReps, teamAverage } from "@/shared/store";
import type { DataSource } from "@/shared/types";

function parseSource(value: string | null): DataSource {
  return value === "training" ? "training" : "live";
}

// GET /api/reps?source=live|training
// Returns every rep resolved for the requested source, plus the team
// average for that same source (so the frontend doesn't recompute it).
export async function GET(req: NextRequest) {
  const source = parseSource(req.nextUrl.searchParams.get("source"));
  const [reps, average] = await Promise.all([listReps(source), teamAverage(source)]);
  return NextResponse.json(
    { source, reps, teamAverage: average },
    { headers: { "Cache-Control": "no-store" } }
  );
}
