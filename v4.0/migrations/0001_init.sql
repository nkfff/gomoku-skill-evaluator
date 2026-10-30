CREATE TABLE IF NOT EXISTS players (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL DEFAULT '匿名棋手',
 points INTEGER NOT NULL DEFAULT 0 CHECK(points>=0),
 wins INTEGER NOT NULL DEFAULT 0,
 losses INTEGER NOT NULL DEFAULT 0,
 draws INTEGER NOT NULL DEFAULT 0,
 inventory TEXT NOT NULL DEFAULT '["classic"]',
 selected_skin TEXT NOT NULL DEFAULT 'classic',
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
 id TEXT PRIMARY KEY,
 player_id TEXT NOT NULL REFERENCES players(id),
 level TEXT NOT NULL,
 moves TEXT NOT NULL DEFAULT '[]',
 turn INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'active',
 revision INTEGER NOT NULL DEFAULT 0,
 started_at TEXT NOT NULL,
 ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leaderboard ON players(points DESC,wins DESC);
CREATE INDEX IF NOT EXISTS idx_games_player ON games(player_id);
