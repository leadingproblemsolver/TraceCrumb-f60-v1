# TraceCrumb

**First Theory Check for software incidents.**

TraceCrumb preserves the team's first theory before review, surfaces the strongest contradiction, a credible alternative cause, the cheapest falsification check, and the decision boundary—then records the explicit next move and eventual outcome.

## Final active product boundary

- Anyone can enter one email and start a validation workspace.
- There is no password, magic link, OAuth provider, or Supabase Auth dependency.
- Each email/browser workspace receives **10 server-enforced live review runs**.
- A random browser token grants access to that workspace; it is not an identity system.
- Supabase Postgres is the durable database.
- The existing Supabase Edge Function is the thin trusted API boundary for database writes, run enforcement, and model calls.
- The browser cannot write directly to product tables and never receives the service-role or OpenAI key.
- The previous authenticated schema is not changed or dropped by the new migration; the active validation path uses only `validation_*` tables.

## Active runtime architecture

```text
React/Vite frontend on Cloudflare
        ↓
random browser access token + email-only validation signup
        ↓
Supabase Edge Function (JWT verification disabled; origin checked)
        ↓
Supabase Postgres validation_* tables
        ↓
OpenAI Responses API with strict structured output
```

Supabase Auth is not used.

## User flow

```text
landing
→ email-only validation signup
→ 10-run workspace bound to this browser
→ save incident theory before review
→ server atomically consumes one run
→ structured decision checkpoint
→ explicit next move (nothing preselected)
→ constrained usefulness feedback
→ outcome and TraceCrumb effect
→ export/copy evidence
```

The fixed worked example remains available at `/?demo=1` and consumes no run.

## Optional first-run evidence signal

Immediately after a browser's **first** successfully persisted live checkpoint (not the worked example, and never after a failed submission), a one-time optional modal asks three evidence-dense questions: what triggered the check today, what changed or sharpened in the next move and why, and what the team spends today instead plus the pilot threshold that would justify buying TraceCrumb. It never asks for a satisfaction score or a hypothetical willingness-to-pay rating.

- The modal is dismissible by Skip or by clicking the backdrop; either path reassures the user the checkpoint is already saved and never blocks the workflow.
- Submitting requires all three answers; a partial answer set can only be skipped, not submitted.
- Answers are written through the `save_signup_signal` Edge Function action into `public.validation_signup_signals`, bound to the current session and `decision_event_id`. The browser never writes this table directly.
- A browser-local marker (`tracecrumb-first-run-signal-v1`) and the table's one-row-per-session unique constraint together guarantee the popup and the row are created at most once per browser/workspace.
- `first_run_signal_saved` and `first_run_signal_skipped` are recorded through the existing `log_event` action for operator visibility.

## Mascot guide ("Crumbs")

A small fixed avatar (bottom-right, on the worked example and the real console) opens a dismissible speech-bubble panel — no new image assets or animation library.

- **Worked example (`/?demo=1`)**: a five-step scripted walkthrough of the theory → four-card checkpoint → next-move → outcome flow. It auto-opens once per browser (`tracecrumb-mascot-demo-seen-v1` in `localStorage`), can be skipped, and can be reopened any time by clicking the avatar.
- **Real console**: on every return to the app, it auto-opens with a plain-language recap built entirely from already-durable data — the most recent `history` record (incident title, next move, outcome) plus the current run count and total active time — so a returning user immediately sees *why* they were there, *what* they decided, and *what happened*, without re-reading anything. There is no separate memory store and no extra LLM call behind this: it reuses the same `validation_decisions` / `validation_actions` / `validation_outcomes` rows already shown in "Prior checkpoints," which is the existing durable, per-user continuity record.

## Time-spent tracking

- **Per session**: the browser accumulates active foreground seconds (Page Visibility API) and flushes them roughly every 30 seconds through the `record_active_time` Edge Function action, which calls `add_session_active_seconds()` (clamped to 600s per call) to atomically increment `validation_sessions.total_active_seconds`. The running total is shown in the app header and in the mascot recap.
- **Per incident**: the browser timestamps when the intake form starts being filled and sends the elapsed `time_to_commit_seconds` with the `review` action; it is stored on `validation_incidents` and shown as a "Committed in Xm Ys" pill on the saved record.

## What changed in this finalization

### Technical

- Removed every active frontend call to Supabase Auth.
- Removed direct browser table reads/writes.
- Added additive auth-free `validation_*` tables.
- Added atomic `reserve_validation_run()` enforcement.
- Added one email hash + one browser-token hash per workspace to prevent trivial run resets with the same email.
- Added a global daily provider budget.
- Added explicit `verify_jwt = false` function configuration and strict allowed-origin checks: a missing Origin header and an Origin outside `ALLOWED_ORIGINS` are both rejected with 403 unless `ALLOWED_ORIGINS` explicitly contains `*`. Any future server-to-server (originless) integration must use a separate authenticated path rather than relying on this browser-facing, origin-checked function.
- Made run consumption atomic: a run is retained only once the incident, decision, and review rows are all durably persisted and the checkpoint is retrievable. Any earlier failure releases the reserved run and deletes the incomplete incident/decision rows, so history never shows a partial checkpoint and a failed submission never costs a run.
- Made the active schema/migration fail explicitly, before any index/function/grant is created, if pre-existing `validation_*` tables are missing a required column — rather than silently leaving a partially initialized table in place.
- Added consequence type, decision deadline, known unknowns, action owner/due date, structured review feedback, and `tracecrumb_effect`.
- Kept deterministic fallback, immutable commit hash, history, export, copy, source attribution, and outcome capture.

### Human / sociotechnical

- The signup copy makes the browser-token recovery boundary explicit.
- The intake separates observation, assumption, mismatch, unknown, consequence, and switch condition.
- The review is reduced to four decision-changing cards rather than model-centric output.
- The next move has no default; the responder must choose and justify it.
- Outcome capture distinguishes “tool changed the decision/test/timing/participants” from “no effect.”
- The UI repeats that the responder remains accountable and that secrets/customer PII must be redacted.

## Requirements

- Node.js 20.19 or newer;
- one Supabase project;
- an OpenAI API key for incident-specific reviews;
- Cloudflare or another static frontend host.

No Supabase Auth provider needs to be enabled.

## 1. Install and verify

```bash
npm ci
npm run ship
```

## 2. Apply the database migration

Apply only the active auth-free migration:

```text
supabase/migrations/20260712090000_auth_free_validation.sql
```

Or paste the byte-identical canonical schema:

```text
supabase/schema.sql
```

The migration is additive. It does not drop legacy tables or existing records.

## 3. Configure and deploy the Edge Function

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set OPENAI_API_KEY=YOUR_KEY
npx supabase secrets set OPENAI_MODEL=gpt-5-mini
npx supabase secrets set ALLOWED_ORIGINS=https://YOUR_DOMAIN
npx supabase secrets set MAX_VALIDATION_RUNS=10
npx supabase secrets set DAILY_REVIEW_LIMIT=100
npx supabase secrets set DAILY_SIGNUP_LIMIT=100
npx supabase secrets set ABUSE_HASH_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET
npx supabase functions deploy ai-orchestrator --no-verify-jwt
```

`supabase/config.toml` also declares `verify_jwt = false` for this function.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied automatically in hosted Supabase Edge Functions. Never place the service-role key, OpenAI key, or abuse-hash secret in Vite variables.

Without `OPENAI_API_KEY`, a submitted run still produces and saves a clearly labelled deterministic record-quality fallback. The fallback consumes a run because the full durable checkpoint path was exercised.

## 4. Frontend environment

Copy `.env.example` to `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
VITE_AI_FUNCTION_NAME=ai-orchestrator
```

The publishable browser key can invoke the public function. It has no direct privileges on the `validation_*` tables.

## 5. Run locally

```bash
npm run dev
```

Test attribution with:

```text
?source_channel=local_test
```

## 6. Deploy the frontend

For Cloudflare Workers:

```text
Build command: npm run build:configured
Deploy command: npx wrangler deploy
Root directory: repository root
Environment variables: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
```

Or:

```bash
npm run deploy:cloudflare
```

## 7. Non-negotiable production smoke test

1. Open `/?source_channel=smoke_test` in a private browser.
2. Open the worked example; confirm no run is consumed, the optional evidence modal does not appear, and the mascot avatar opens the five-step walkthrough once.
3. Start a workspace with a real test email; confirm the signup CTA reads "Start your 10-run validation."
4. Confirm the header shows `10/10 runs left`.
5. Submit one redacted real incident decision.
6. Confirm the header changes to `9/10 runs left`.
7. Confirm four checkpoint cards render.
8. Confirm no next move is preselected.
9. Confirm the optional three-question evidence modal appears once; verify both the Skip path and the submit path work, and that it does not reappear after a page refresh.
10. Attempt `revise` or `escalate` without an owner/due date and confirm it is rejected in the UI and by the API; then submit with owner and due date and confirm it succeeds.
11. Save feedback and an outcome.
12. Refresh and confirm history reopens the record on the same browser, and the mascot recap on return shows the last incident, next move, and outcome.
13. Confirm the header's active-time pill increases after leaving the tab open and returning.
14. Confirm direct browser table access is denied and the function is the only write boundary.
15. Confirm a request with a wrong Origin and a request with no Origin header both receive 403.
16. Confirm rows exist in all relevant `validation_*` tables, including exactly one `validation_signup_signals` row for the session, and that `validation_incidents.time_to_commit_seconds` and `validation_sessions.total_active_seconds` are populated.

## 8. Distribution gate

Proceed to outreach only when the smoke test above passes. The first validation objective is not signup volume; it is repeated decision impact:

- qualified real check;
- completed checkpoint;
- explicit changed/strengthened next move;
- executable falsification check;
- outcome recorded;
- second run or share/export.

## Product claim boundary

Safe description:

> TraceCrumb preserves an incident team's first theory, surfaces a credible contradiction and falsification check, and records whether the checkpoint changed the next move and outcome.

Do not claim that TraceCrumb finds root cause, accesses live telemetry, autonomously remediates incidents, or has proven MTTR/revenue impact without observed evidence.
