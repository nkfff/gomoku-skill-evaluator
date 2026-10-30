-- V4.0: player-selected AI color and auditable server-generated PVP dice.
ALTER TABLE games ADD COLUMN player_color INTEGER NOT NULL DEFAULT 1 CHECK(player_color IN (1,2));
ALTER TABLE pvp_matches ADD COLUMN dice_rolls TEXT NOT NULL DEFAULT '[]';
ALTER TABLE pvp_matches ADD COLUMN dice_winner_player_id TEXT;
