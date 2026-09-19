import type { RepView, Scores } from "../../shared/types";

export const scoreMetrics = [
  { key: "closeRate", label: "Close rate" },
  { key: "objectionHandling", label: "Objection handling" },
  { key: "scriptAdherence", label: "Script adherence" },
  { key: "technicalAnswers", label: "Technical answers" },
] as const;

export const businessMetrics = [
  { key: "biggestDealUsd", label: "Biggest deal" },
  { key: "avgDealSizeUsd", label: "Avg deal size" },
  { key: "monthlySalesVolume", label: "Sales volume/mo" },
] as const;

export type MetricKey =
  | keyof Scores
  | (typeof businessMetrics)[number]["key"];
export type SortKey = "name" | MetricKey;

export function hasScores(rep: RepView): boolean {
  return rep.source === "live" || rep.hasTraining;
}

export function metricValue(rep: RepView, key: MetricKey): number | null {
  if (key === "biggestDealUsd" || key === "avgDealSizeUsd" || key === "monthlySalesVolume") {
    return rep[key];
  }
  return hasScores(rep) ? rep.scores[key] : null;
}

export function sortReps(reps: RepView[], key: SortKey, direction: "asc" | "desc"): RepView[] {
  return [...reps].sort((a, b) => {
    if (key === "name") {
      return a.name.localeCompare(b.name) * (direction === "asc" ? 1 : -1);
    }
    const first = metricValue(a, key);
    const second = metricValue(b, key);
    if (first === null || second === null) {
      return first === second ? a.name.localeCompare(b.name) : first === null ? 1 : -1;
    }
    return (first - second) * (direction === "asc" ? 1 : -1) || a.name.localeCompare(b.name);
  });
}

export function scoreDeltas(rep: RepView, average: Scores | null) {
  if (!hasScores(rep) || !average) return [];
  return scoreMetrics
    .map((metric) => ({ ...metric, value: rep.scores[metric.key], average: average[metric.key], delta: rep.scores[metric.key] - average[metric.key] }))
    .sort((a, b) => b.delta - a.delta);
}

export function formatMetric(key: MetricKey, value: number): string {
  if (key === "biggestDealUsd" || key === "avgDealSizeUsd") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  }
  return key === "closeRate" ? `${value}%` : value.toLocaleString("en-US");
}

export function deltaDescription(key: keyof Scores, delta: number): string {
  if (delta === 0) return "In line with the team average";
  const unit = key === "closeRate" ? "percentage points" : "points";
  return `${Math.abs(delta)} ${unit} ${delta > 0 ? "above" : "below"} the team average`;
}
