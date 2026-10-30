-- V3.3: persist the multi-step forced-line solution and server-authoritative progress.
ALTER TABLE mode_challenges ADD COLUMN solution_moves TEXT NOT NULL DEFAULT '[]';
ALTER TABLE mode_challenges ADD COLUMN solution_responses TEXT NOT NULL DEFAULT '[]';
ALTER TABLE mode_challenges ADD COLUMN solution_wins TEXT NOT NULL DEFAULT '[]';
ALTER TABLE mode_challenges ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;

-- Expire old one-move challenges; they cannot be continued under the new rules.
UPDATE mode_challenges SET status='expired' WHERE mode='puzzle' AND status='open';
