# TraceCrumb First-60 — Release Conversion Patch

## Added without changing the core incident flow

- Persistent public newsletter signup.
- Public contact page: `?contact=1`.
- Direct email: `leadingproblemsolver@gmail.com`.
- Structured contact fields for product feedback, incident testing, pilots, and bugs.
- Native share with copy-link fallback.
- Private JSON export for recommendation packets, incident history, worked demo, and intelligence graph.
- Animated arrival of every newly recorded graph node, with reduced-motion support.
- Static ship-test coverage for the new release surfaces.

## Privacy boundary

- Share actions send only the public TraceCrumb/demo URL and generic product text.
- Incident inputs are included only in explicit local JSON downloads.
- Contact/newsletter records are insert-only for anonymous users under RLS.

## Deployment

1. Run `supabase/migrations/20260706_contact_messages.sql` or rerun the idempotent `supabase/schema.sql`.
2. Run `npm install`.
3. Run `npm run test`.
4. Run `node scripts/test-graph.mjs`.
5. Run `npm run build`.
6. Deploy `dist/`.

A database webhook/automation is still required if Supabase contact submissions must trigger inbox notifications. The contact page always includes a direct prefilled email fallback.
