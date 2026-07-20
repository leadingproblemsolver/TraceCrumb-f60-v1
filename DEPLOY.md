# TraceCrumb deployment notes

## One database, four branches

All MVP branches use the same `supabase/schema.sql`. This keeps operational memory unified while allowing each branch to distribute against a different pain.

## API-key design

The browser app never receives OpenAI/Gemini secrets. The frontend calls the Supabase Edge Function `ai-orchestrator`; the Edge Function reads branch-specific secrets first and falls back to global secrets.

Fallback order:

1. Branch OpenAI key
2. Branch Gemini key
3. Global OpenAI key
4. Global Gemini key
5. Local heuristic fallback

## Branch secret names

- `TRACECRUMB_FIRST60_OPENAI_API_KEY`
- `TRACECRUMB_FIRST60_GEMINI_API_KEY`
- `TRACECRUMB_RESUME_OPENAI_API_KEY`
- `TRACECRUMB_RESUME_GEMINI_API_KEY`
- `TRACECRUMB_HANDOFF_OPENAI_API_KEY`
- `TRACECRUMB_HANDOFF_GEMINI_API_KEY`
- `TRACECRUMB_CONTINUITY_OPENAI_API_KEY`
- `TRACECRUMB_CONTINUITY_GEMINI_API_KEY`

## Deployment invariant

Supabase is the state boundary. LLMs generate structured operational artifacts, but Supabase stores the durable truth: raw evidence, canonical state, recommendations, outcomes, and metric deltas.
