-- Backfill: legacy work_email rows have no source/confidence, so they don't
-- contribute to org pattern inference. Treat them as `team_page` (0.7) — a
-- moderate-trust default that lets them participate in the pattern but won't
-- override a real send_confirmed (0.95) or user_entered (1.0) once those land.
--
-- Idempotent: only writes rows where the source is still NULL.

UPDATE people
SET
  work_email_source = 'team_page',
  work_email_confidence = 0.7
WHERE
  work_email IS NOT NULL
  AND work_email_source IS NULL;
