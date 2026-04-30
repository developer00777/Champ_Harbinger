-- Email pattern detection + per-email source/confidence
-- 2026-04-26
--
-- Adds per-organization email-pattern cache so we can derive emails for new
-- contacts at a company once we've confirmed the pattern from a verified one.
-- Adds source + confidence columns on people.work_email so the agent (and UI)
-- knows how much to trust each address.

-- Organizations: per-company email pattern cache
ALTER TABLE organizations ADD COLUMN email_pattern TEXT;
ALTER TABLE organizations ADD COLUMN email_pattern_confidence REAL;
ALTER TABLE organizations ADD COLUMN email_pattern_evidence_count INT NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN email_pattern_bounce_count INT NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN email_pattern_updated_at TIMESTAMPTZ;

-- People: per-email source + confidence
-- (work_email_verified_at already exists from the initial schema.)
ALTER TABLE people ADD COLUMN work_email_source TEXT
  CHECK (work_email_source IN ('user_entered', 'send_confirmed', 'team_page', 'exa_search', 'pattern_derived'));
ALTER TABLE people ADD COLUMN work_email_confidence REAL;
