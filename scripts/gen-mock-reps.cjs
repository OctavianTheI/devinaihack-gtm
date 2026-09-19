// Generates shared/mock/reps.json — 26 dummy sales reps with deliberate
// variety (clear top performers with "good" divergences, clear weak
// performers with "bad" divergences, and a middle group), so the table and
// detail panel have something interesting to show without a real backend.
//
// Run: node scripts/gen-mock-reps.cjs

const fs = require("fs");
const path = require("path");

const FIRST_NAMES = [
  "Sarah", "Marcus", "Priya", "Jonas", "Elena", "Diego", "Aisha", "Tom",
  "Yuki", "Noah", "Fatima", "Liam", "Zara", "Kenji", "Olivia", "Bilal",
  "Grace", "Viktor", "Maya", "Sam", "Ines", "Rahul", "Chloe", "Andre",
  "Nina", "Peter",
];
const LAST_NAMES = [
  "Kim", "Reyes", "Nagy", "Horvath", "Silva", "Cohen", "Novak", "Baptiste",
  "Ito", "Fischer", "Haddad", "Moreau", "Petrov", "Adeyemi", "Larsen",
  "Costa", "Dubois", "Okafor", "Bianchi", "Sorensen", "Park", "Weber",
  "Adams", "Ferreira", "Lund", "Varga",
];

const SCRIPT_STEPS = ["Opening", "Discovery", "Pitch", "Objection handling", "Technical Q&A", "Close"];

const GOOD_DIVERGENCES = [
  { scriptStep: "Objection handling", whatTheyDid: "Reframes pricing objections around ROI and payback period instead of reciting the discount script.", aiReason: "Keeps the conversation on value rather than price, which correlates with a higher close rate in this cohort." },
  { scriptStep: "Discovery", whatTheyDid: "Asks two extra open-ended questions about the prospect's current workflow before pitching.", aiReason: "Surfaces objections earlier, so they get handled before the close instead of derailing it." },
  { scriptStep: "Close", whatTheyDid: "Proposes a specific next calendar date instead of the generic 'follow up soon' close.", aiReason: "Concrete next steps measurably increase follow-through to a signed deal." },
  { scriptStep: "Technical Q&A", whatTheyDid: "Brings in a short customer story instead of a spec sheet when asked about integrations.", aiReason: "Answers the underlying trust question, not just the technical one." },
];
const BAD_DIVERGENCES = [
  { scriptStep: "Discovery", whatTheyDid: "Skips discovery questions and jumps straight to the pitch.", aiReason: "Leads to generic pitches that don't address the prospect's actual concern, which shows up later as unresolved objections." },
  { scriptStep: "Objection handling", whatTheyDid: "Repeats the same rebuttal twice instead of addressing the follow-up question.", aiReason: "Reads as defensive and stalls the conversation instead of resolving the concern." },
  { scriptStep: "Pitch", whatTheyDid: "Over-promises a delivery timeline not confirmed with the delivery team.", aiReason: "Creates downstream churn risk and support escalations." },
  { scriptStep: "Close", whatTheyDid: "Never explicitly asks for the sale; lets the call end on 'let me know what you think'.", aiReason: "Passive closes correlate with deals stalling indefinitely." },
];

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function makeScores(rand, tier) {
  // tier: "top" | "mid" | "low"
  const base = tier === "top" ? 78 : tier === "mid" ? 58 : 38;
  const spread = 14;
  const jitter = () => Math.round(clamp(base + (rand() - 0.5) * 2 * spread, 5, 99));
  return {
    closeRate: jitter(),
    objectionHandling: jitter(),
    scriptAdherence: jitter(),
    technicalAnswers: jitter(),
  };
}

function makeReps() {
  const rand = seededRandom(42);
  const reps = [];
  const total = 26;
  for (let i = 0; i < total; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[i % LAST_NAMES.length];
    const tier = i < 5 ? "top" : i >= total - 5 ? "low" : "mid";

    const live = makeScores(rand, tier);
    const hasTraining = rand() < 0.4; // ~40% of reps already have a training session
    const training = hasTraining
      ? makeScores(rand, tier === "low" ? "mid" : tier) // training nudges low performers up slightly
      : null;

    const divergences = [];
    if (tier === "top") {
      const pick = GOOD_DIVERGENCES[i % GOOD_DIVERGENCES.length];
      divergences.push({ ...pick, verdict: "good" });
    } else if (tier === "low") {
      const pick = BAD_DIVERGENCES[i % BAD_DIVERGENCES.length];
      divergences.push({ ...pick, verdict: "bad" });
    } else if (rand() < 0.3) {
      const pool = rand() < 0.5 ? GOOD_DIVERGENCES : BAD_DIVERGENCES;
      const pick = pool[i % pool.length];
      divergences.push({ ...pick, verdict: pool === GOOD_DIVERGENCES ? "good" : "bad" });
    }

    const biggestDealUsd =
      tier === "top"
        ? Math.round((40000 + rand() * 160000) / 1000) * 1000
        : tier === "mid"
          ? Math.round((10000 + rand() * 50000) / 1000) * 1000
          : Math.round((2000 + rand() * 20000) / 1000) * 1000;

    // Average deal is a fraction of their biggest, so the two stay consistent
    // and tier differences carry through automatically.
    const avgDealSizeUsd = Math.max(
      1000,
      Math.round((biggestDealUsd * (0.25 + rand() * 0.3)) / 500) * 500
    );
    const monthlySalesVolume =
      tier === "top"
        ? 8 + Math.floor(rand() * 7) // 8-14 deals/month
        : tier === "mid"
          ? 4 + Math.floor(rand() * 6) // 4-9
          : 1 + Math.floor(rand() * 4); // 1-4

    reps.push({
      id: `rep-${String(i + 1).padStart(2, "0")}`,
      name: `${first} ${last}`,
      biggestDealUsd,
      avgDealSizeUsd,
      monthlySalesVolume,
      live,
      training,
      divergences,
    });
  }
  return reps;
}

const reps = makeReps();
const outPath = path.join(__dirname, "..", "shared", "mock", "reps.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(reps, null, 2) + "\n");
console.log(`Wrote ${reps.length} reps to ${outPath}`);
console.log(`  top performers: ${reps.slice(0, 5).map((r) => r.name).join(", ")}`);
console.log(`  low performers: ${reps.slice(-5).map((r) => r.name).join(", ")}`);
console.log(`  with training data: ${reps.filter((r) => r.training).length}`);
