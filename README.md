# Sales Coach

Next.js + TypeScript sales coaching demo with a manager Monitor view, a Train workstream, and reps/training API routes. The demo uses seeded reps and an in-memory store, not a production database.

## Run locally

Use Node.js 22.13+ or 24.x and npm. Vercel currently uses Node.js 24.x.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Once the Monitor workstream is merged, open http://localhost:3000/monitor directly. For a production-mode local run:

```sh
npm run build
npm start
```

The seeded reps API and training-session storage do not require provider credentials. Real AI grading requires the scoring configuration below; voice functionality requires the separate Train integration.

## Environment variables

For local provider integration, create an untracked `.env.local` yourself, or supply variables through your own shell/secret manager. Never commit real values or prefix provider secrets with `NEXT_PUBLIC_`. The deployment setup did not write keys to any local file or GitHub.

| Variable | Purpose | Production / Preview configuration |
| --- | --- | --- |
| `SCORER_API_KEY` | Server-side API key used by `shared/scorer.ts`; required for real model grading. | Sensitive OpenRouter credential stored in Vercel. |
| `SCORER_BASE_URL` | OpenAI-compatible API root, without `/chat/completions`. | `https://openrouter.ai/api/v1` |
| `SCORER_MODEL` | Model identifier for lightweight transcript analysis. | `inclusionai/ling-3.0-flash-vl:free` |
| `OPENAI_API_KEY` | Legacy fallback if `SCORER_API_KEY` is absent. | Not needed for the chosen OpenRouter setup; leave unset. |
| `ELEVENLABS_API_KEY` | Server-side ElevenLabs credential, reserved for the Train integration. | Sensitive credential stored in Vercel; not yet consumed by application code. |
| `ELEVENLABS_MODEL_ID` | Speech-synthesis model preference, reserved for the Train integration. | `eleven_flash_v2_5` |

Nonsecret model/endpoint settings are configured for Development, Preview, and Production. Sensitive keys are configured only for Preview and Production, without branch-specific overrides. Local developers must supply their own credentials; pulling Development variables will not download the production keys. After changing a Vercel variable, deploy again: existing deployments retain their original environment.

The scorer defaults to OpenAI's endpoint and `gpt-4o-mini` when no endpoint/model variables are set. Use all three `SCORER_*` variables together for OpenRouter. It falls back to deterministic placeholder scores when a key is missing or a model call/JSON validation fails; a successful session-save request does **not** prove that real AI grading occurred.

The selected OpenRouter model is free and intended only for lightweight analysis. Its current endpoint catalog does not advertise `response_format` support, while the existing scorer requests JSON mode. Validate real grading during scorer integration and check for placeholder output; free-model availability and limits can change. Do not silently substitute a paid model.

ElevenLabs Flash v2.5 is the low-cost, low-latency speech-synthesis choice (50% lower API price per character than the standard models). This setting does not configure a conversational agent, speech recognition, or a particular voice. Any voice/agent ID and additional provider settings must be agreed and wired by the Train workstream; no guessed IDs are stored here.

## Continuous deployment on Vercel

- Production: https://devinaihack-gtm.vercel.app
- GitHub repository: https://github.com/OctavianTheI/devinaihack-gtm
- Vercel project: `devinaihack-gtm` (`prj_ZD23h1e9nLpVgE7kprSPuuSsuUrl`)
- Team: `sergey-aimlapis-projects` (`team_mxQ0Hnc5cEOmNTbBtCJXpOPP`)
- Framework: Next.js, repository root, automatically detected install/build commands.
- Production branch: `main`. Pushes/merges to `main` deploy production.
- Other branches and pull requests get preview deployments and URLs through the Vercel GitHub App. Check the PR's Vercel status/comment for its preview URL.

The Vercel GitHub App must retain access to this repository. Fork PRs and unrecognized commit authors may require approval under Vercel's existing security/team policies; these protections are not disabled. No duplicate GitHub Actions deployment workflow is needed.

### Manage deployments from the agent

The agent's `vercel` MCP connection manages the project directly; it is not a runtime dependency and needs no checked-in authentication token. Available operations include:

- `get_git_deployment_context`: discover and verify the GitHub project link.
- `list_deployments` / `get_deployment`: inspect branch, commit, deployment target, and build status.
- `list_deployment_events`: inspect build output.
- `get_runtime_logs`: inspect route failures for this project/deployment.
- `filter_project_envs` with `decrypt: "false"`: inspect variable names, scopes, and types without exposing secret values.
- `create_project_env` / `edit_project_env`: configure variables; use `sensitive` for provider keys in Production/Preview.
- `create_deployment`: rebuild from a Git ref after environment changes when there is no new Git push.

If MCP is disconnected in a new agent session, reconnect it with the intended Vercel account/team. Do not commit MCP credentials, provider keys, or protection-bypass tokens. Preview deployments may require Vercel authentication; use authorized MCP access rather than weakening deployment protection.

## Verify a deployed build

Check Vercel reports `READY`, that the deployment references the intended Git commit and target, and then test the actual production or preview URL:

```sh
BASE_URL=https://devinaihack-gtm.vercel.app
curl --fail-with-body "$BASE_URL/api/reps?source=live"
curl --fail-with-body "$BASE_URL/api/reps?source=training"
curl --fail-with-body "$BASE_URL/api/reps/rep-01?source=live"
curl -i -X POST "$BASE_URL/api/training/sessions" \
  -H 'Content-Type: application/json' --data '{}'
```

Expected: reps list/detail routes return 200 JSON with source-resolved scores and `teamAverage`; the intentionally invalid session returns 400 JSON. A missing rep returns 404. GET on the POST-only session endpoint returns 405.

To test a successful save, POST a valid `TrainingSessionInput` from `shared/types.ts` for an existing demo rep and expect 201 with `session` and `rep`. Use only synthetic data and obtain approval before mutating a shared deployment. Redeploy afterward to clear in-memory smoke-test data. Follow the type contract from the deployed branch: the shared-contract workstream adds the required `outcome` field.

Local checks:

```sh
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

## Current integration limits

At deployment setup, the shared scorer is in PR #1 and the Monitor UI is in PR #2; they are not yet on `main`. Production serves the contents of `main`, so those features appear in production only after their PRs merge. This setup does not merge feature PRs or change application logic.

The three API routes can run on Vercel, but the shared in-memory store is **not durable or shared across serverless instances**. A POST can succeed while a later GET on another instance still returns seeded data. Redeploys/cold starts discard training results. A persistent datastore is required for a reliable cross-route training-to-monitor loop; adding it is outside deployment configuration.

The session API saves supplied scores; it does not invoke the scorer. Voice and live AI-scoring end-to-end behavior must be verified when the Train integration is implemented. The demo APIs have no application authentication and are not suitable for real customer data as-is.
