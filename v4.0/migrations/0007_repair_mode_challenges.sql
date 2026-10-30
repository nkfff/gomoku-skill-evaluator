-- V4.0 maintenance: repair D1 instances where 0005 was recorded but the table still has the V3.2 schema.
-- Rebuild instead of ALTER ADD COLUMN because deployed D1 migration history may incorrectly report 0005 as applied.
-- Preserve every legacy challenge field and reward; open challenges are expired because their old solution state is incomplete.
CREATE TABLE mode_challenges_v4_repair (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  mode TEXT NOT NULL CHECK(mode IN ('puzzle')),
  difficulty TEXT NOT NULL CHECK(difficulty IN ('easy','normal','hard')),
  size INTEGER NOT NULL CHECK(size >= 5 AND size <= 29),
  connect INTEGER NOT NULL CHECK(connect >= 3 AND connect <= 10),
  board TEXT NOT NULL,
  solution_index INTEGER NOT NULL,
  solution_moves TEXT NOT NULL DEFAULT '[]',
  solution_responses TEXT NOT NULL DEFAULT '[]',
  solution_wins TEXT NOT NULL DEFAULT '[]',
  progress INTEGER NOT NULL DEFAULT 0,
  reward INTEGER NOT NULL CHECK(reward >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','claimed','expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  claimed_at TEXT
);

INSERT INTO mode_challenges_v4_repair (
  id,player_id,mode,difficulty,size,connect,board,solution_index,
  reward,status,created_at,expires_at,claimed_at
)
SELECT
  id,player_id,mode,difficulty,size,connect,board,solution_index,
  reward,status,created_at,expires_at,claimed_at
FROM mode_challenges;

UPDATE mode_challenges_v4_repair
SET status='expired'
WHERE mode='puzzle' AND status='open';

DROP TABLE mode_challenges;
ALTER TABLE mode_challenges_v4_repair RENAME TO mode_challenges;

CREATE INDEX IF NOT EXISTS idx_mode_challenges_player_created
  ON mode_challenges(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mode_challenges_player_claimed
  ON mode_challenges(player_id, status, claimed_at DESC);
