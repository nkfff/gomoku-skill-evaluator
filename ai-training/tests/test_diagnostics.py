from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from gomoku.diagnostics import (
    board_signature,
    tactical_move_flags,
    top_search_moves,
)
from gomoku.evaluate import generate_opening_moves
from gomoku.game import BLACK, WHITE, GomokuGame, coord, spot
from gomoku.mcts import SearchResult
from gomoku.tactical import analyze_tactical_evidence


def test_board_signature_is_lossless_and_compact():
    game = GomokuGame()
    game.play(spot(7, 7))
    signature = board_signature(game.board)

    assert len(signature) == 225
    assert signature[spot(7, 7)] == str(BLACK)
    assert set(signature) <= {"0", "1", "2"}


def test_tactical_diagnostics_detect_missed_immediate_win():
    game = GomokuGame()
    for col in range(5, 9):
        game.board[spot(7, col)] = BLACK
    evidence = analyze_tactical_evidence(game.board, BLACK, include_forks=False)

    flags = tactical_move_flags(evidence, spot(0, 0))

    assert flags["missed_immediate_win"] is True
    assert flags["missed_forced_block"] is False
    assert set(flags["win_now_moves"]) == {spot(7, 4), spot(7, 9)}


def test_tactical_diagnostics_detect_missed_forced_block():
    game = GomokuGame()
    for col in range(4):
        game.board[spot(7, col)] = WHITE
    evidence = analyze_tactical_evidence(game.board, BLACK, include_forks=False)

    flags = tactical_move_flags(evidence, spot(0, 0))

    assert flags["missed_immediate_win"] is False
    assert flags["missed_forced_block"] is True
    assert flags["forced_loss"] is False
    assert flags["must_block_moves"] == [spot(7, 4)]


def test_tactical_diagnostics_do_not_call_impossible_multi_block_a_missed_forced_block():
    game = GomokuGame()
    for col in range(5, 9):
        game.board[spot(7, col)] = WHITE
    evidence = analyze_tactical_evidence(game.board, BLACK, include_forks=False)

    flags = tactical_move_flags(evidence, spot(0, 0))

    assert flags["forced_loss"] is True
    assert flags["missed_forced_block"] is False


def test_top_search_moves_are_ranked_by_visits_then_prior():
    result = SearchResult(
        best_move=spot(7, 7),
        visit_counts={spot(7, 7): 8, spot(7, 8): 4, spot(6, 7): 4},
        visit_policy=np.zeros(225, dtype=np.float32),
        root_priors={spot(7, 7): 0.5, spot(7, 8): 0.2, spot(6, 7): 0.3},
        root_value=0.1,
        simulations=16,
        forced_loss=False,
    )

    top = top_search_moves(result, limit=3)

    assert top[0]["coord"] == coord(spot(7, 7))
    assert top[1]["coord"] == coord(spot(6, 7))
    assert top[2]["coord"] == coord(spot(7, 8))


def test_opening_generator_is_reproducible_and_legal():
    first = generate_opening_moves(6, np.random.default_rng(123))
    second = generate_opening_moves(6, np.random.default_rng(123))

    assert first == second
    assert len(first) == 6

    game = GomokuGame()
    for item in first:
        assert item["player"] == game.current_player
        assert game.board[item["move"]] == 0
        game.play(item["move"])
        assert not game.done


def test_opening_generator_rejects_excessive_length():
    with pytest.raises(ValueError):
        generate_opening_moves(21, np.random.default_rng(1))
