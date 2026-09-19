# Sales Coach: Hackathon Plan

Assumed stack (change if needed): Next.js + TypeScript, API routes for the backend, a JSON/in-memory store (no real DB needed for a hackathon). Frontend deploys to Vercel.

## 1. What we're building

One app, two tabs.

**Tab 1: Monitor Team (manager view)**
- Table of sales reps with dummy data (lots of rows).
- Columns: name, biggest deal ever, **average deal size**, **sales volume/month**, close rate, AI objection-handling score, script adherence, technical-question score.
- Toggle: **Live data** vs **Training data**. *(Marked optional in the cut list below -- see the note there on what replaces it if cut.)*
- Click a rep -> detail panel (drawer or modal, whichever is easier):
  - Their metrics vs the team average.
  - Script divergences: where they deviate from the script, with an AI verdict (good / neutral / bad) and a one-line reason.
  - "Doing best" and "doing worst" summary.
  - For a top performer, a good divergence is a suggestion the manager can adopt into the script.

**Tab 2: Train (rep view)**
- Generic photo of "you and a client", plus a Play button.
- Voice AI plays a **cold-call prospect** -- the rep is calling them, not the other way around. This changes the opening: the rep must introduce who they are and their company, and state the offer, before the AI treats the pitch as started. The AI shouldn't volunteer information the rep hasn't earned by asking/pitching properly, the way a real cold-call prospect wouldn't.
- Flow (demo timings, make these constants):
  1. Rep opens the call: says who they are, who they represent, and what the offer is. If they skip this, the AI (as the prospect) should push back ("Sorry, who is this?") rather than proceed.
  2. Rep pitches for ~30 s. If they keep going past that, the AI interrupts.
  3. AI fires objections and technical questions from a fixed list for ~60 s and pushes back hard.
  4. **Success branch:** if the rep is handling things well (per the live scoring, not a fixed script), the AI should break character positively -- say it's ready to purchase, ask the rep to send a link to its email, and say to stay on the line, let's get this going now. This is the "won the deal" outcome, distinct from the normal end-of-session scoring flow, and should be a satisfying demo moment.
  5. Otherwise, session ends normally after the objection phase and the AI scores the rep on the same criteria as the dashboard.
  6. Result is saved and appears in Tab 1 under **Training data** (or wherever training results surface if that toggle is cut -- see cut list).

The loop that makes the demo: train -> score -> see it on the manager dashboard -> manager sees what good reps do differently.

## 2. Split of work

| | Owner A: Monitor | Owner B: Train |
|---|---|---|
| Folder | `/app/monitor`, `/api/reps` | `/app/train`, `/api/training` |
| Builds | Table, toggle, detail panel, seed data, divergence UI | Voice session, cold-call opening check, objection list, interruption logic, success-branch detection, scoring |
| Shared | `/shared` (types, mock data, rubric, scorer), agreed and frozen in the first 30 min |

Rules:
- Each person edits only their own folders. `/shared` changes only through tiny PRs that the other person approves.
- One feature = one Devin session = one branch = one PR. Merge to `main` often, and pull before each new task.
- Everything outside your folder is treated as read-only.

Suggested repo layout:
```
/shared
  types.ts          # data contract (below)
  rubric.ts         # scoring criteria + weights
  scorer.ts         # the actual scoring logic (prompt + call shape) -- see "Where scoring logic lives" below
  objections.ts     # objection/question list for the voice coach
  mock/reps.json    # seed data
/app/monitor        # A
/app/train          # B
/app/api/reps       # A
/app/api/training   # B (writes), A (reads)
```

## 3. Data contract (`/shared/types.ts`)

```ts
export type DataSource = "live" | "training";

export interface Scores {
  closeRate: number;            // 0-100
  objectionHandling: number;    // 0-100 (AI rated)
  scriptAdherence: number;      // 0-100
  technicalAnswers: number;     // 0-100
}

export interface Divergence {
  scriptStep: string;           // e.g. "Pricing objection"
  whatTheyDid: string;          // short description of the deviation
  verdict: "good" | "neutral" | "bad";
  aiReason: string;             // why the AI rated it that way
}

export interface Rep {
  id: string;
  name: string;
  biggestDealUsd: number;
  avgDealSizeUsd: number;       // NEW: average deal size across their sales
  monthlySalesVolume: number;   // NEW: number of deals closed per month
  live: Scores;                 // from real calls (dummy data)
  training: Scores | null;      // from voice-coach sessions, null until they train
  divergences: Divergence[];    // derived from live and/or training data
  source?: DataSource;          // set by the API when a view is requested
}

export interface TrainingSession {
  id: string;
  repId: string;
  startedAt: string;            // ISO
  durationSec: number;
  transcript: { speaker: "rep" | "customer"; text: string }[];
  outcome: "scored" | "won";    // NEW: "won" = the AI's success-branch fired mid-call
  scores: Scores;               // closeRate here = AI's estimate of close likelihood
  divergences: Divergence[];
  summary: string;
}
```

`avgDealSizeUsd` and `monthlySalesVolume` are plain business stats (not AI-rated), so they don't vary by `live`/`training` source the way `Scores` does -- they live at the top level of `Rep`.

## 4. API contract

- `GET /api/reps?source=live|training` -> `Rep[]` (A implements; returns the requested score set as the main scores)
- `GET /api/reps/:id` -> `Rep` with divergences (A)
- `POST /api/training/sessions` body: `TrainingSession` -> saves it and updates that rep's `training` scores and divergences (B calls, A's store handles persistence; simplest is one shared in-memory/JSON store module in `/shared/store.ts` owned by A)
- Team average = computed in the frontend or in `GET /api/reps` (A).

Until the real thing exists, both sides use `/shared/mock/reps.json`.

## 5. Where does the scoring logic live?

Put the actual scoring implementation -- the prompt/function that turns a transcript into `Scores` + `Divergence[]`, not just the rubric text -- in `/shared/scorer.ts`, not inside `/app/train`. Two reasons:

1. **Both sides need it.** The dashboard's pre-seeded "AI rates this divergence as good" data and the voice coach's live scoring are meant to be the same judgment applied twice -- seed generation and live training should call the same function so the demo's story ("the AI is consistently identifying what works") actually holds up.
2. **It's the one piece of logic most likely to need a shared API key / model call setup.** Keeping it in `/shared` means whichever of you sets up the model call (OpenAI, Anthropic, etc.) does it once, and it's a small reviewed PR to `/shared` rather than logic buried in Owner B's folder that Owner A can't see.

`/shared/rubric.ts` stays as the criteria definitions and prompt text (already shared). `/shared/scorer.ts` is the new addition: the function that actually calls a model with that rubric and returns parsed `Scores`/`Divergence[]`. Owner B is still the one who writes and owns it day-to-day (it's their tab that calls it live), but it lives in `/shared` so Owner A's seed-data generation script can call the same function instead of hand-writing plausible-looking scores.

## 6. Frontend & deployment (Vercel)

The frontend should be built and iterated on through a live Vercel deployment rather than only tested locally, using an MCP connection to Vercel (both of you, or whichever Devin session is doing frontend work, should have the Vercel MCP server connected so it can deploy, check build/deploy status, and read logs directly instead of you copy-pasting Vercel dashboard output back into the session).

Practical steps:
1. Create a Vercel project linked to the GitHub repo (Vercel's GitHub integration auto-deploys every push/PR -- do this once, early).
2. Connect the Vercel MCP server in your Devin session (or Claude session) so it can trigger deploys, inspect build failures, and check environment variables itself.
3. Every PR gets a Vercel preview deployment for free via the GitHub integration -- use the preview link to actually click through the UI when reviewing a teammate's PR, not just the diff.
4. Any secrets (voice provider API key, scoring model API key) go into Vercel's environment variables, not committed to the repo.

## 7. Scoring rubric (shared so both sides agree)

Each criterion is 0-100:
- **Objection handling:** acknowledges the concern, answers it, reframes to value, doesn't get defensive.
- **Script adherence:** hits the required script steps in order; deviations are recorded as `Divergence`s.
- **Technical answers:** accuracy and clarity on product questions.
- **Close likelihood:** did the rep ask for the sale and move it forward?

The AI scorer (`/shared/scorer.ts`) returns JSON matching `Scores` and `Divergence[]`.

## 8. Cut list (drop these first if time runs out)

1. Real-time interruption (keep the fixed timer instead).
2. "Adopt into script" button (just show the divergence).
3. Divergence analysis for training data (keep it only for the pre-seeded live data).
4. The cold-call "who is this" pushback if the rep skips the intro (just let the pitch proceed).
5. The mid-call success branch ("send a link to my email") -- nice demo moment, but a normal end-of-session score is an acceptable fallback.

**VERY optional (nice-to-have, cut these before anything above):**
- Filtering by each metric column to see top performers.
- Uploading a new sales script.
- **Live vs. Training toggle.** Note: this was originally "never cut" because it's how the dashboard shows training results at all. If you do cut it, replace it with something simpler that still closes the loop -- e.g. always show live data plus a small "Trained (check)" badge/column that links to their latest training result, instead of a full source switch.
- Two sliders to control training duration (one for the pitch/demo phase, one for the objection-handling phase).
- A full transcript of the voice call shown at the end in the same window, with a few (not many) points highlighted as strong or weak.

Never cut: the table, the detail panel, one working voice session, and the score showing up in the dashboard somewhere.

## 9. Build order

1. **Together (first 30 min):** confirm stack, create `/shared` (types, rubric, scorer stub, objections, mock data), set up repo + Devin access, branch protection on `main`, create the Vercel project and connect its MCP server.
2. **In parallel:**
   - A: seed data (20-30 reps, now including avg deal size and sales volume), table with toggle, detail panel with divergences.
   - B: voice agent talking (this is the riskiest piece, start with it) with the cold-call opening, then timing/interruption logic, then the success branch, then scoring via `/shared/scorer.ts`.
3. **Integrate:** B posts a real `TrainingSession`, A's table shows it under Training data (or the "Trained (check)" fallback).
4. **Polish + demo rehearsal.**

De-risk voice early: get a two-way voice conversation working before anything else in Tab 2. Have a fallback (browser speech recognition + text-to-speech) if the main voice provider gives trouble.

## 10. Demo script (2-3 min)

1. Open Monitor: "Here's the team, live data. Sarah has the best close rate; click her: she handles pricing objections differently from the script, and the AI rates that as good."
2. Switch to Train: run a session as a rep, doing the cold-call intro properly, pitching, handling a couple of objections well.
3. If timing allows, let the success branch fire: "and if you're doing well, the prospect will actually try to close right there -- send me a link, let's get this going now."
4. Back to Monitor, Training data (or "Trained (check)"): the new score is there.
5. Close: manager can now update the script using what top reps do best.
