# Implementation Plan

## TODO List
- [x] Review existing files (landing page, App.jsx, styles.css)
- [x] Integrate landing page into React app as initial view
- [x] Add routing flow: landing → auth → app
- [x] Update color scheme to match landing page
- [x] Add dark/light mode toggle
- [x] Test the implementation (static ship-tests + build verified)
- [x] Ship P0 blockers: recommendation provenance, fallback labeling, cold-start demo
- [x] Add per-user/per-company intelligence graph (JSON-backed, SVG view, rule engine, decision packets)
- [x] Add reference incident corpus schema + matcher for cold-start orgs with zero incident memory
- [ ] Wire real retrieval: load the 26 mined incidents via supabase/seed_reference_incidents.sql
- [ ] Deploy: create Supabase project, run schema.sql + seed file, set API key secrets
- [ ] Deploy Edge Function (ai-orchestrator) and confirm live end-to-end (not just local build)
- [ ] Wire payment link (Gumroad/Stripe) for founder-assisted tier
