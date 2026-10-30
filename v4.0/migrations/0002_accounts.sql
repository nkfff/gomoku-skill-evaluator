-- V2.2 authenticated profiles and economy.
ALTER TABLE players ADD COLUMN earned_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN selected_board TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE players ADD COLUMN selected_piece TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE players ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN email TEXT;
ALTER TABLE games ADD COLUMN undo_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN events TEXT NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS point_ledger (
 id TEXT PRIMARY KEY,
 player_id TEXT NOT NULL,
 delta INTEGER NOT NULL,
 reason TEXT NOT NULL,
 actor_id TEXT,
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_points_player ON point_ledger(player_id,created_at);
CREATE TABLE IF NOT EXISTS admin_audit (
 id TEXT PRIMARY KEY,
 admin_id TEXT NOT NULL,
 target_id TEXT NOT NULL,
 action TEXT NOT NULL,
 detail TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_earned ON players(earned_points DESC,wins DESC);
