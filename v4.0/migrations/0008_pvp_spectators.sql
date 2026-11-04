-- V4.0.7 PVP spectators use short-lived, single-use connection tickets.
-- Existing player tickets retain the default role and continue to work unchanged.
ALTER TABLE pvp_connection_tickets
  ADD COLUMN role TEXT NOT NULL DEFAULT 'player'
  CHECK (role IN ('player','spectator'));

CREATE INDEX IF NOT EXISTS idx_pvp_ticket_room_role
  ON pvp_connection_tickets(room_id, role, expires_at, consumed_at);
