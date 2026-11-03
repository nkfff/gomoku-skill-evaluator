from __future__ import annotations

import json

import torch

from gomoku.game import BLACK, GomokuGame, spot
from gomoku.league import TacticalRuleOpponent, load_opponent_league, register_snapshot
from gomoku.tactical import analyze_tactical_evidence
from gomoku.mcts import PUCTConfig
from gomoku.network import build_model


def _checkpoint(path, round_index):
    model = build_model()
    torch.save(
        {
            "round_index": round_index,
            "model_state_dict": model.state_dict(),
        },
        path,
    )


def test_register_snapshot_keeps_baseline_and_recent_opponents(tmp_path):
    source = tmp_path / "source.pt"
    _checkpoint(source, 10)
    league_dir = tmp_path / "league"

    for round_index in (10, 20, 30, 40, 50):
        _checkpoint(source, round_index)
        register_snapshot(source, league_dir, round_index, max_opponents=3)

    manifest = json.loads((league_dir / "manifest.json").read_text())
    assert [item["round_index"] for item in manifest["opponents"]] == [10, 40, 50]
    assert all((league_dir / item["path"]).is_file() for item in manifest["opponents"])


def test_frozen_league_opponent_returns_a_legal_move(tmp_path):
    source = tmp_path / "source.pt"
    _checkpoint(source, 60)
    league_dir = tmp_path / "league"
    register_snapshot(source, league_dir, 60, max_opponents=4)

    opponents = load_opponent_league(
        league_dir,
        torch.device("cpu"),
        PUCTConfig(simulations=2, root_noise_fraction=0.0),
        max_opponents=4,
    )
    assert len(opponents) == 1
    assert opponents[0].name == "TEBA_LEAGUE_R00060"

    game = GomokuGame()
    move, diagnostics = opponents[0].choose_game_move(game)
    assert move in game.get_candidates(radius=2)
    assert diagnostics["round_index"] == 60



def test_tactical_specialist_prioritizes_an_immediate_win():
    game = GomokuGame()
    winning_stones = [spot(7, col) for col in (3, 4, 5, 6)]
    game.board[winning_stones] = BLACK
    game.current_player = BLACK

    evidence = analyze_tactical_evidence(game.board, game.current_player)
    move, diagnostics = TacticalRuleOpponent().choose_game_move(game)

    assert move in evidence.win_now_moves
    assert diagnostics["priority"] == "WIN_NOW"
    assert move in game.get_candidates(radius=2)
