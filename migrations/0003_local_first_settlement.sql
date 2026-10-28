-- V2.3: record successful score settlement to make client retries idempotent.
ALTER TABLE games ADD COLUMN settled_at TEXT;
CREATE INDEX IF NOT EXISTS idx_games_settled ON games(status, settled_at);
