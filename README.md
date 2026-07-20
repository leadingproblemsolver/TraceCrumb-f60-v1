# TraceCrumb First-60

TraceCrumb First-60 protects the most expensive minute in incident response: the first diagnostic branch.

It turns live symptoms plus prior incident memory into a compressed first move, so SRE/DevOps teams stop repeating old mistakes under P1 pressure.

## Product flow

```text
Landing page → intentional signup/sign-in → auth-gated app
```

Everyone lands on the public landing page first. Users only move to auth when they choose to continue. Authenticated users can then enter the protected app. The no-signup demo remains available through:

```text
?demo=1&source_channel=landing
```

## One-sentence benefit + loss-aversion hook

Know where to look first in a P1 — or keep burning the first 60 seconds on repeated guesses your team has already paid for.

## Surgical pain destruction framing

When a P1 starts, responders improvise from memory, scan scattered Slack threads, and repeat old diagnostic branches while the clock compounds against them. TraceCrumb captures the live symptom, compares it against team incident memory, and returns the safest first branch plus priority checks. The gain is not another dashboard; it is a compressed, decision-ready starting point when the team has the least time to think.

## Landing / Product Hunt core copy

### Tagline

Incident memory for the first 60 seconds.

### Headline

Stop losing the incident in the first minute.

### Subheadline

TraceCrumb turns live symptoms plus prior incident memory into the safest first diagnostic branch, so responders stop paying the tax of wrong-first-call debugging.

### Problem

The painful part is not the alert. It is the first wrong move. The first minute of incident response is usually spent reconstructing context from memory, Slack, dashboards, and half-remembered postmortems.

### Solution + immense benefit

Paste the live symptom. TraceCrumb fingerprints it, checks prior incident memory, and produces the safest first branch plus priority checks before your team burns time on a familiar dead end. Do not let the same incident teach the same lesson twice.

### Proof / rapid iteration angle

The proof metric is first-action success rate plus time-to-resolution minutes. Demo drops capture source channel and outcome feedback so distribution can iterate on real pain, not vague interest.

### CTA

Continue to protected app. Or open the 60-second no-signup demo.

## Platform-specific drops

### Reddit comment

This is exactly the first-60-seconds problem: the team loses time choosing the first diagnostic branch, not because nobody is smart, but because incident memory is scattered. I made a no-signup demo that turns symptoms + prior memory into the first branch to check: `?demo=1&source_channel=reddit`. Try it on one incident shape and reply with whether the first suggested branch would have saved time.

### X reply

Most P1s lose minutes before the real debugging even starts: wrong first branch, repeated checks, forgotten prior incident. TraceCrumb First-60 compresses symptom → prior memory → first diagnostic branch: `?demo=1&source_channel=x`. Run the demo and tell me whether the first branch is useful, partial, or wrong.

### LinkedIn message

Teams do not just lose time during incidents; they lose the first minute reconstructing context they already had. TraceCrumb First-60 turns live symptoms and prior incident memory into the safest first diagnostic branch: `?demo=1&source_channel=linkedin`. Please test the demo against one recurring incident pattern and mark the output as useful, partial, or missed.

## Light DRE checklist

### T-3

- Confirm landing page explains the pain in one screen without requiring feature literacy.
- Confirm `?demo=1&source_channel=...` works for all planned drops.
- Confirm demo outcome buttons write or gracefully fail without blocking the demo.
- Confirm protected app starts only after intentional auth.

### T-2

- Prepare 10 high-pain SRE/DevOps threads where people describe MTTR drag, repeated incidents, debugging loops, or first-branch confusion.
- Prepare one tailored reply per thread.
- Keep the ask behavioral: “Would this first branch have saved time?”

### T-1

- Run `npm run ship:test`.
- Deploy the Vite `dist/` output, not the source directory.
- Verify landing → auth → app on the live URL.
- Verify demo telemetry source params on the live URL.

### T-0

- Drop into the highest-pain threads first.
- Record channel, comment angle, user response, outcome tag, and conversion intent.
- Iterate copy only from real objections or confirmed resonance.

## Non-negotiables

- Landing page first for everyone.
- Signup only after user intent.
- Time-to-value under five minutes.
- Demo must be understandable without onboarding.
- Distribution copy must sell the root pain, not the feature list.
- Do not scale unless users confirm the first-branch loss is real.

## Top risks + anticompounders

| Risk | Anticompounder |
|---|---|
| Sounds like another incident dashboard | Lead with wrong-first-branch loss, not storage or AI |
| Too much cognitive load | Keep one demo scenario, one output artifact, one feedback ask |
| Weak proof | Track first-action usefulness and time-to-resolution claims |
| Signup friction | Keep no-signup demo public and route signup only after intent |
| Cold-channel mismatch | Use Reddit/SRE pain threads before broad Product Hunt-style launch |

## PSC quick score

**Score:** 8.2/10

**Rationale:** Exceptional root solve for a painful, time-sensitive workflow; sub-five-minute demo value; embeddable in SRE/DevOps threads; scalable if teams confirm first-action improvement. The main risk is that it becomes obviously superior only after enough incident memory exists.

**Recommended primary channel:** Reddit SRE/DevOps incident-response threads and comment replies where engineers describe debugging loops, MTTR drag, or repeated incidents.

## Included

- Vite + React deployable MVP.
- Distribution-aligned landing page with hero, problem, solution, proof loop, and CTA.
- Landing → auth → app flow.
- Persistent dark/light mode toggle.
- Supabase Auth integration.
- Supabase Postgres/RLS schema: `supabase/schema.sql`.
- Shared Edge Function: `supabase/functions/ai-orchestrator/index.ts`.
- Branch-specific OpenAI and Gemini API fallback env vars.
- Heuristic fallback when neither provider is configured or available.
- Static ship tests: `scripts/static-ship-tests.mjs`.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with browser-safe Supabase values:

```bash
VITE_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
VITE_AI_FUNCTION_NAME="ai-orchestrator"
```

Do **not** put OpenAI or Gemini API keys in frontend env vars.

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Enable Email/Password auth in Supabase Auth settings.
4. Deploy the Edge Function:

```bash
supabase functions deploy ai-orchestrator
```

5. Set server-side secrets:

```bash
supabase secrets set TRACECRUMB_FIRST60_OPENAI_API_KEY="sk-..."
supabase secrets set TRACECRUMB_FIRST60_GEMINI_API_KEY="..."
```

Optional global fallback secrets:

```bash
supabase secrets set OPENAI_API_KEY="sk-..."
supabase secrets set GEMINI_API_KEY="..."
```

## Validation commands

```bash
npm run test
npm run build
```

Or run the full ship gate:

```bash
npm run ship:test
```

`npm run test` verifies branch consistency, required files, demo telemetry hooks, Supabase safety fallback, and absence of server-side AI secrets in the client app.

## Deployment note

For Netlify/Vercel/static hosting, publish the Vite build output:

```text
dist/
```

Do not publish the repo root or source app directory.

## Release contact, signup, sharing, and export surfaces

This release adds bounded conversion and collaboration surfaces without changing the incident-reasoning workflow:

- Persistent newsletter signup on the public landing page, backed by `newsletter_signups`.
- Public contact page at `?contact=1` with structured fields for role, company, reason, and incident/workflow context.
- Direct contact path: `leadingproblemsolver@gmail.com`.
- Native share where supported, with copy-link fallback. Sharing uses the public app/demo URL and never includes private incident input.
- Private JSON export for the current incident packet, incident history, worked demo, and intelligence graph.
- Animated graph arrival for each newly persisted incident, decision, and outcome node.

Run the latest `supabase/schema.sql` before deploying so `contact_messages` exists. The contact form writes to Supabase; the page also provides a prefilled direct-email fallback. Configure a Supabase database webhook or automation separately if inbox notifications are required for table submissions.
