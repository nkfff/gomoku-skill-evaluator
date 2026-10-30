-- V3.2: authenticated, one-time puzzle rewards. Additive; existing AI/PVP scores remain unchanged.
CREATE TABLE IF NOT EXISTS mode_challenges (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  mode TEXT NOT NULL CHECK(mode IN ('puzzle')),
  difficulty TEXT NOT NULL CHECK(difficulty IN ('easy','normal','hard')),
  size INTEGER NOT NULL CHECK(size >= 5 AND size <= 29),
  connect INTEGER NOT NULL CHECK(connect >= 3 AND connect <= 10),
  board TEXT NOT NULL,
  solution_index INTEGER NOT NULL,
  reward INTEGER NOT NULL CHECK(reward >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','claimed','expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  claimed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mode_challenges_player_created
  ON mode_challenges(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mode_challenges_player_claimed
  ON mode_challenges(player_id, status, claimed_at DESC);
