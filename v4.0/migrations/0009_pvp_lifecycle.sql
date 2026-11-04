-- V4.0.11: retain a user-facing reason for inactivity forfeits and
-- unrated matches abandoned after both players disconnect.
-- end_reason remains within the existing CHECK constraint; this detail
-- column carries the more specific lifecycle outcome.
ALTER TABLE pvp_matches ADD COLUMN end_reason_detail TEXT;
