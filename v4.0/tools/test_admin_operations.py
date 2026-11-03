import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for name in ("0001_init.sql", "0002_accounts.sql", "0003_pvp.sql"):
    db.executescript((root / "migrations" / name).read_text())

admin_id = "9e0c6fa4-0000-4000-8000-000000000001"
target_id = "2f907fca-0000-4000-8000-000000000002"
for values in (
    (admin_id, "Admin", 1200, 370, 8, 13, 0, '["classic","board:gold","piece:cat"]', "admin@example.com"),
    (target_id, "Target", 500, 270, 4, 31, 0, '["classic","board:jade","piece:crystal"]', "target@example.com"),
):
    db.execute(
        """INSERT INTO players
           (id,name,points,earned_points,wins,losses,draws,inventory,created_at,email)
           VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (*values[:8], "2026-11-04", values[8])
    )
db.execute(
    """INSERT INTO games(id,player_id,level,moves,turn,status,revision,started_at)
       VALUES(?,?,?,?,?,?,?,?)""",
    ("game-admin-1", admin_id, "normal", "[]", 1, "active", 0, "2026-11-04")
)
db.execute(
    """INSERT INTO games(id,player_id,level,moves,turn,status,revision,started_at)
       VALUES(?,?,?,?,?,?,?,?)""",
    ("game-target-1", target_id, "hard", "[]", 1, "active", 0, "2026-11-04")
)
db.execute(
    """INSERT INTO pvp_rooms(id,host_player_id,invite_code_hash,status,expires_at)
       VALUES(?,?,?,?,?)""",
    ("room-target-1", target_id, "hash-target-1", "finished", "2026-11-05")
)
db.execute(
    """INSERT INTO pvp_matches(id,room_id,black_player_id,white_player_id,status,result)
       VALUES(?,?,?,?,?,?)""",
    ("match-target-1", "room-target-1", target_id, admin_id, "finished", "black_win")
)
db.execute(
    """INSERT INTO pvp_ratings(player_id,rating,rated_games,wins,losses,draws)
       VALUES(?,?,?,?,?,?)""",
    (target_id, 1120, 8, 5, 3, 0)
)

# The same D1 statements used by /api/admin/adjust-stats.
games_played, wins, draws, earned_points = 20, 12, 2, 400
losses = games_played - wins - draws
with db:
    db.execute(
        "UPDATE players SET wins=?,losses=?,draws=?,earned_points=? WHERE id=?",
        (wins, losses, draws, earned_points, target_id)
    )
    db.execute(
        """INSERT INTO admin_audit(id,admin_id,target_id,action,detail)
           VALUES(?,?,?,?,?)""",
        ("audit-stats", admin_id, target_id, "adjust_stats",
         '{"gamesPlayed":20,"wins":12,"losses":6,"draws":2,"earnedPoints":400}')
    )
row = db.execute(
    """SELECT wins,losses,draws,earned_points,
              ROUND(100.0*wins/(wins+losses+draws),1),
              MAX(0,ROUND(earned_points+
                (100.0*(wins+2.5)/(wins+losses+draws+5)-50)*
                MIN(wins+losses+draws,20)/10.0))
       FROM players WHERE id=?""",
    (target_id,)
).fetchone()
assert row == (12, 6, 2, 400, 60.0, 416.0), row

# The same D1 statements used by /api/admin/reset.
with db:
    db.execute("DELETE FROM games WHERE player_id=?", (target_id,))
    db.execute(
        "UPDATE players SET points=0,earned_points=0,wins=0,losses=0,draws=0 WHERE id=?",
        (target_id,)
    )
    db.execute(
        """INSERT INTO admin_audit(id,admin_id,target_id,action,detail)
           VALUES(?,?,?,?,?)""",
        ("audit-reset", admin_id, target_id, "reset_ai_data",
         '{"reason":"test","scope":"ai_games_and_competitive_stats"}')
    )
after = db.execute(
    "SELECT points,earned_points,wins,losses,draws,inventory FROM players WHERE id=?",
    (target_id,)
).fetchone()
assert after == (0, 0, 0, 0, 0, '["classic","board:jade","piece:crystal"]'), after
assert db.execute("SELECT COUNT(*) FROM games WHERE player_id=?", (target_id,)).fetchone()[0] == 0
assert db.execute("SELECT COUNT(*) FROM pvp_matches WHERE id='match-target-1'").fetchone()[0] == 1
assert db.execute("SELECT rating,rated_games FROM pvp_ratings WHERE player_id=?", (target_id,)).fetchone() == (1120, 8)
assert db.execute("SELECT COUNT(*) FROM admin_audit WHERE target_id=?", (target_id,)).fetchone()[0] == 2
print("Admin stats update, leaderboard formula, AI reset, cosmetics/PVP preservation and audit writes passed.")
