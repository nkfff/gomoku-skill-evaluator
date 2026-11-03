from __future__ import annotations

import numpy as np
import pytest

from gomoku.game import BLACK, WHITE, new_board, spot
from gomoku.tactical import (
    FORK,
    MUST_BLOCK,
    WIN_NOW,
    analyze_tactical_evidence,
    generate_tactical_targets,
)


def test_tactical_target_shape_and_dtype():
    evidence = analyze_tactical_evidence(new_board(), BLACK)

    assert evidence.targets.shape == (3, 15, 15)
    assert evidence.targets.dtype == np.float32
    assert np.count_nonzero(evidence.targets) == 0


def test_win_now_labels_both_ends_of_open_four():
    board = new_board()
    for col in range(5, 9):
        board[spot(7, col)] = BLACK

    evidence = analyze_tactical_evidence(board, BLACK)

    expected = {spot(7, 4), spot(7, 9)}
    observed = set(
        np.flatnonzero(evidence.targets[WIN_NOW].reshape(-1)).tolist()
    )

    assert observed == expected
    assert set(evidence.win_now_moves) == expected
    assert evidence.must_block_moves == ()
    assert evidence.fork_moves == ()
    assert not evidence.forced_loss


def test_immediate_win_has_priority_over_opponent_threat():
    board = new_board()

    for col in range(5, 9):
        board[spot(7, col)] = BLACK

    for col in range(5, 9):
        board[spot(3, col)] = WHITE

    evidence = analyze_tactical_evidence(board, BLACK)

    assert evidence.has_immediate_win
    assert evidence.targets[WIN_NOW].sum() == 2
    assert evidence.targets[MUST_BLOCK].sum() == 0
    assert evidence.opponent_winning_moves == ()


def test_must_block_labels_single_opponent_winning_cell():
    board = new_board()

    # White has four stones at the left edge, so only column 4 completes five.
    for col in range(4):
        board[spot(7, col)] = WHITE

    evidence = analyze_tactical_evidence(board, BLACK)

    expected = (spot(7, 4),)

    assert evidence.win_now_moves == ()
    assert evidence.must_block_moves == expected
    assert evidence.opponent_winning_moves == expected
    assert evidence.targets[MUST_BLOCK].sum() == 1
    assert evidence.targets[WIN_NOW].sum() == 0
    assert evidence.targets[FORK].sum() == 0
    assert evidence.has_forced_block
    assert not evidence.forced_loss


def test_multiple_opponent_wins_are_marked_as_forced_loss():
    board = new_board()

    for col in range(5, 9):
        board[spot(7, col)] = WHITE

    evidence = analyze_tactical_evidence(board, BLACK)

    expected = {spot(7, 4), spot(7, 9)}

    assert set(evidence.must_block_moves) == expected
    assert set(evidence.opponent_winning_moves) == expected
    assert evidence.targets[MUST_BLOCK].sum() == 2
    assert evidence.forced_loss
    assert not evidence.has_forced_block


def test_cross_double_threat_is_labeled_as_fork():
    board = new_board()

    # Playing the center fills both horizontal and vertical four-stone lines.
    for row, col in (
        (7, 5), (7, 6), (7, 8),
        (5, 7), (6, 7), (8, 7),
    ):
        board[spot(row, col)] = BLACK

    evidence = analyze_tactical_evidence(board, BLACK)

    fork_index = spot(7, 7)

    assert fork_index in evidence.fork_moves
    assert evidence.targets[FORK].reshape(-1)[fork_index] == 1.0
    assert evidence.targets[WIN_NOW].sum() == 0
    assert evidence.targets[MUST_BLOCK].sum() == 0


def test_no_fork_is_labeled_when_opponent_has_immediate_win():
    board = new_board()

    for col in range(4):
        board[spot(7, col)] = WHITE

    # Add a tempting black three-stone pattern elsewhere.
    for col in (5, 6, 8):
        board[spot(10, col)] = BLACK

    evidence = analyze_tactical_evidence(board, BLACK)

    assert evidence.must_block_moves == (spot(7, 4),)
    assert evidence.fork_moves == ()
    assert evidence.targets[FORK].sum() == 0


def test_tactical_analysis_does_not_mutate_board():
    board = new_board()
    for col in range(5, 9):
        board[spot(7, col)] = BLACK

    before = board.copy()
    analyze_tactical_evidence(board, BLACK)

    assert np.array_equal(board, before)


def test_target_only_api_matches_diagnostic_api():
    board = new_board()
    for col in range(4):
        board[spot(7, col)] = WHITE

    targets = generate_tactical_targets(board, BLACK)
    evidence = analyze_tactical_evidence(board, BLACK)

    assert np.array_equal(targets, evidence.targets)


@pytest.mark.parametrize("player", [0, 3, True])
def test_tactical_analysis_rejects_invalid_player(player):
    with pytest.raises(ValueError):
        analyze_tactical_evidence(new_board(), player)


def test_tactical_analysis_rejects_invalid_board():
    with pytest.raises(ValueError):
        analyze_tactical_evidence(np.zeros(100, dtype=np.int8), BLACK)
