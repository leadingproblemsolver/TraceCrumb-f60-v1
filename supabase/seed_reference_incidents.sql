-- Reference incident corpus seed — TEMPLATE
-- Fill in your 26 hand-mined, labeled incidents here, one insert per row.
-- This is what makes "matched against prior incidents" a true claim.
-- Run this in the Supabase SQL editor AFTER schema.sql.
--
-- fingerprint: lowercase keyword tags describing the symptom shape.
--   These must overlap with what deriveFingerprint() in the edge function
--   extracts from live symptom text (lowercase tokens >3 chars), so pick
--   tags that are likely to appear in how an engineer would actually
--   describe the symptom, not abstract category labels.
--
-- failure_mode: must be exactly one of
--   'context_blindness' | 'anchoring' | 'false_pattern_match' | 'other'
--   per your original validation taxonomy (21% / 16% / 16% distribution).

insert into public.reference_incidents
  (title, symptom_text, fingerprint, failure_mode, correct_first_branch, wrong_first_branch_taken, loss_description, root_cause, source_note)
values
  (
    'REPLACE — incident title',
    'REPLACE — the actual symptom text as observed (e.g. "checkout latency spiked to 4s, 500s on payment-service")',
    array['REPLACE','keyword','tags','lowercase'],
    'context_blindness',  -- or anchoring / false_pattern_match / other
    'REPLACE — the first branch that WOULD have been correct to check',
    'REPLACE — what was actually checked first, that wasted time',
    'REPLACE — e.g. "18 minutes lost debugging the wrong service before checking the actual dependency"',
    'REPLACE — actual root cause once found',
    'REPLACE — e.g. "INC-07 from validation corpus"'
  );
  -- Repeat this insert block for all 26 incidents. Recommend batching as one
  -- multi-row VALUES list once you have the real data, rather than 26
  -- separate statements — same table, same columns, just more rows.

-- Sanity check after loading:
-- select count(*) from public.reference_incidents;   -- should be 26
-- select failure_mode, count(*) from public.reference_incidents group by failure_mode;
--   -- should roughly match 21% / 16% / 16% distribution from your validation work
