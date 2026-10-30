-- V3.0 PVP: additive schema only. V2.2 AI tables and scoring remain unchanged.
CREATE TABLE IF NOT EXISTS pvp_rooms (
  id TEXT PRIMARY KEY,
  host_player_id TEXT NOT NULL REFERENCES players(id),
  guest_player_id TEXT REFERENCES players(id),
  invite_code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK(status IN ('waiting','ready','active','finished','cancelled','expired')),
  time_control_ms INTEGER NOT NULL DEFAULT 600000 CHECK(time_control_ms > 0),
  rated INTEGER NOT NULL DEFAULT 1 CHECK(rated IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pvp_rooms_status_expiry ON pvp_rooms(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_pvp_rooms_host ON pvp_rooms(host_player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pvp_rooms_guest ON pvp_rooms(guest_player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pvp_matches (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE REFERENCES pvp_rooms(id),
  black_player_id TEXT NOT NULL REFERENCES players(id),
  white_player_id TEXT NOT NULL REFERENCES players(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','finished')),
  result TEXT CHECK(result IN ('black_win','white_win','draw')),
  end_reason TEXT CHECK(end_reason IN ('five_in_row','resign','timeout','draw_agreement','board_full','disconnect_timeout')),
  rated INTEGER NOT NULL DEFAULT 1 CHECK(rated IN (0,1)),
  initial_black_rating INTEGER NOT NULL DEFAULT 1000,
  initial_white_rating INTEGER NOT NULL DEFAULT 1000,
  final_black_rating INTEGER,
  final_white_rating INTEGER,
  move_count INTEGER NOT NULL DEFAULT 0 CHECK(move_count >= 0),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_black ON pvp_matches(black_player_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_white ON pvp_matches(white_player_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_status ON pvp_matches(status, started_at);

CREATE TABLE IF NOT EXISTS pvp_moves (
  match_id TEXT NOT NULL REFERENCES pvp_matches(id),
  ply INTEGER NOT NULL CHECK(ply > 0),
  player_id TEXT NOT NULL REFERENCES players(id),
  color INTEGER NOT NULL CHECK(color IN (1,2)),
  cell_index INTEGER NOT NULL CHECK(cell_index BETWEEN 0 AND 224),
  played_at TEXT NOT NULL,
  think_ms INTEGER NOT NULL CHECK(think_ms >= 0),
  revision INTEGER NOT NULL CHECK(revision > 0),
  client_action_id TEXT NOT NULL,
  PRIMARY KEY(match_id, ply),
  UNIQUE(match_id, cell_index),
  UNIQUE(match_id, player_id, client_action_id)
);
CREATE INDEX IF NOT EXISTS idx_pvp_moves_match ON pvp_moves(match_id, ply);

CREATE TABLE IF NOT EXISTS pvp_ratings (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  rating INTEGER NOT NULL DEFAULT 1000,
  rated_games INTEGER NOT NULL DEFAULT 0 CHECK(rated_games >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK(wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK(losses >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK(draws >= 0),
  peak_rating INTEGER NOT NULL DEFAULT 1000,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pvp_ratings_leaderboard ON pvp_ratings(rating DESC, rated_games DESC);

CREATE TABLE IF NOT EXISTS pvp_rating_events (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES pvp_matches(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('win','loss','draw')),
  rating_before INTEGER NOT NULL,
  rating_after INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_pvp_rating_events_player ON pvp_rating_events(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pvp_active_players (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  room_id TEXT NOT NULL REFERENCES pvp_rooms(id),
  match_id TEXT NOT NULL REFERENCES pvp_matches(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_pvp_active_room ON pvp_active_players(room_id);

CREATE TABLE IF NOT EXISTS pvp_connection_tickets (
  token_hash TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES pvp_rooms(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pvp_ticket_expiry ON pvp_connection_tickets(expires_at, consumed_at);
