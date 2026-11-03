from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from gomoku.game import (
    BLACK,
    CELLS,
    CENTER,
    WHITE,
    GomokuGame,
    candidates,
    coord,
    immediate_wins,
    is_winning_move,
    new_board,
    spot,
    win_line,
)
from gomoku.encoding import encode_batch, encode_state


# ============================================================
# Board utilities
# ============================================================

def test_new_board_shape_and_dtype():
    board = new_board()
    assert board.shape == (CELLS,)
    assert board.dtype == np.int8
    assert np.all(board == 0)


def test_coordinates_match_v4_convention():
    assert coord(0) == "A1"
    assert coord(112) == "H8"
    assert coord(224) == "O15"


def test_spot_and_bounds():
    assert spot(7, 7) == 112

    with pytest.raises(ValueError):
        spot(-1, 0)

    with pytest.raises(ValueError):
        spot(0, 15)


def test_board_validation_rejects_wrong_size():
    with pytest.raises(ValueError):
        win_line(np.zeros(100, dtype=np.int8), 0, BLACK)


def test_board_validation_rejects_invalid_values():
    board = new_board()
    board[0] = 3

    with pytest.raises(ValueError):
        candidates(board)


def test_board_validation_rejects_float_and_bool_arrays():
    with pytest.raises(TypeError):
        candidates(np.zeros(CELLS, dtype=np.float32))

    with pytest.raises(TypeError):
        candidates(np.zeros(CELLS, dtype=bool))


# ============================================================
# Win detection
# ============================================================

@pytest.mark.parametrize(
    "positions",
    [
        [(7, 3), (7, 4), (7, 5), (7, 6), (7, 7)],
        [(3, 7), (4, 7), (5, 7), (6, 7), (7, 7)],
        [(3, 3), (4, 4), (5, 5), (6, 6), (7, 7)],
        [(3, 11), (4, 10), (5, 9), (6, 8), (7, 7)],
    ],
)
def test_five_in_all_four_directions(positions):
    board = new_board()
    indices = []

    for row, col in positions:
        index = spot(row, col)
        board[index] = BLACK
        indices.append(index)

    line = win_line(board, indices[2], BLACK)

    assert len(line) == 5
    assert set(line) == set(indices)


def test_six_in_a_row_is_a_win():
    board = new_board()
    indices = []

    for col in range(4, 10):
        index = spot(7, col)
        board[index] = BLACK
        indices.append(index)

    assert len(win_line(board, indices[2], BLACK)) == 6


def test_broken_line_does_not_win():
    board = new_board()

    for col in (2, 3, 5, 6, 7, 8):
        board[spot(7, col)] = BLACK

    assert win_line(board, spot(7, 7), BLACK) == []


def test_win_line_requires_stone_at_index():
    board = new_board()
    for col in range(5, 9):
        board[spot(7, col)] = BLACK

    assert win_line(board, spot(7, 7), BLACK) == []


def test_is_winning_move_does_not_mutate_input():
    board = new_board()
    for col in range(5, 9):
        board[spot(7, col)] = BLACK

    before = board.copy()

    assert is_winning_move(board, spot(7, 9), BLACK)
    assert np.array_equal(board, before)


def test_is_winning_move_rejects_occupied_point():
    board = new_board()
    board[spot(7, 7)] = BLACK

    assert not is_winning_move(board, spot(7, 7), BLACK)


# ============================================================
# Candidate generation and immediate tactics
# ============================================================

def test_empty_board_returns_center():
    assert candidates(new_board()) == [CENTER]


def test_center_radius_two_has_24_candidates_in_js_order():
    board = new_board()
    board[CENTER] = BLACK

    result = candidates(board, radius=2)

    assert len(result) == 24
    assert len(result) == len(set(result))
    assert result[0] == spot(5, 5)
    assert result == [
        spot(row, col)
        for row in range(5, 10)
        for col in range(5, 10)
        if (row, col) != (7, 7)
    ]


def test_corner_radius_two_has_eight_candidates():
    board = new_board()
    board[spot(0, 0)] = BLACK

    result = candidates(board, radius=2)

    assert len(result) == 8
    assert all(board[index] == 0 for index in result)


def test_candidate_order_is_stable_with_multiple_stones():
    board = new_board()
    board[spot(7, 7)] = BLACK
    board[spot(7, 8)] = WHITE

    first = candidates(board)
    second = candidates(board)

    assert first == second
    assert len(first) == len(set(first))


def test_immediate_wins_finds_both_ends_and_preserves_board():
    board = new_board()

    for col in range(5, 9):
        board[spot(7, col)] = BLACK

    before = board.copy()
    result = immediate_wins(board, BLACK)

    assert set(result) == {spot(7, 4), spot(7, 9)}
    assert np.array_equal(board, before)


def test_immediate_wins_returns_empty_when_no_threat():
    board = new_board()
    board[CENTER] = BLACK

    assert immediate_wins(board, BLACK) == []


def test_candidate_radius_validation():
    board = new_board()

    with pytest.raises(ValueError):
        candidates(board, radius=-1)

    with pytest.raises(TypeError):
        candidates(board, radius=1.5)


# ============================================================
# Game state transitions
# ============================================================

def test_game_turn_switches_after_legal_moves():
    game = GomokuGame()

    first = game.play(CENTER)
    assert first.player == BLACK
    assert game.current_player == WHITE

    second = game.play(spot(6, 7))
    assert second.player == WHITE
    assert game.current_player == BLACK


def test_game_rejects_occupied_position():
    game = GomokuGame()
    game.play(CENTER)

    with pytest.raises(ValueError):
        game.play(CENTER)


def test_game_rejects_out_of_range_position():
    game = GomokuGame()

    with pytest.raises(ValueError):
        game.play(CELLS)


def test_game_detects_winner_and_stops():
    game = GomokuGame()

    moves = [
        (7, 3), (0, 0),
        (7, 4), (0, 1),
        (7, 5), (0, 2),
        (7, 6), (1, 0),
        (7, 7),
    ]

    result = None
    for row, col in moves:
        result = game.play(spot(row, col))

    assert result is not None
    assert result.player == BLACK
    assert result.winner == BLACK
    assert result.done
    assert game.done
    assert game.winner == BLACK
    assert len(result.winning_line) == 5

    with pytest.raises(RuntimeError):
        game.play(spot(2, 2))


def test_game_clone_is_independent():
    game = GomokuGame()
    game.play(CENTER)

    copied = game.clone()
    copied.play(spot(6, 7))

    assert game.board[spot(6, 7)] == 0
    assert copied.board[spot(6, 7)] == WHITE
    assert copied.move_count == game.move_count + 1


def test_reset_restores_initial_state():
    game = GomokuGame()
    game.play(CENTER)

    board = game.reset()

    assert np.all(board == 0)
    assert game.current_player == BLACK
    assert game.last_move is None
    assert game.winner is None
    assert not game.done
    assert game.move_count == 0


# ============================================================
# State encoding
# ============================================================

def test_encode_state_shape_and_dtype():
    encoded = encode_state(new_board(), current_player=BLACK)

    assert encoded.shape == (3, 15, 15)
    assert encoded.dtype == np.float32


def test_encode_state_uses_current_player_perspective():
    board = new_board()
    board[spot(7, 7)] = BLACK
    board[spot(7, 8)] = WHITE

    encoded = encode_state(
        board,
        current_player=BLACK,
        last_move=spot(7, 8),
    )

    assert encoded[0, 7, 7] == 1.0
    assert encoded[1, 7, 8] == 1.0
    assert encoded[2, 7, 8] == 1.0


def test_encode_state_reverses_perspective_for_white():
    board = new_board()
    board[spot(7, 7)] = BLACK
    board[spot(7, 8)] = WHITE

    encoded = encode_state(board, current_player=WHITE)

    assert encoded[0, 7, 8] == 1.0
    assert encoded[1, 7, 7] == 1.0


def test_encode_state_without_last_move_has_empty_third_plane():
    encoded = encode_state(new_board(), current_player=BLACK)

    assert encoded[2].sum() == 0.0


def test_encode_state_rejects_empty_last_move():
    with pytest.raises(ValueError):
        encode_state(
            new_board(),
            current_player=BLACK,
            last_move=CENTER,
        )


def test_encode_batch_shape_and_dtype():
    board1 = new_board()
    board2 = new_board()
    board2[CENTER] = BLACK

    batch = encode_batch([
        (board1, BLACK, None),
        (board2, WHITE, CENTER),
    ])

    assert batch.shape == (2, 3, 15, 15)
    assert batch.dtype == np.float32


def test_encode_empty_batch():
    batch = encode_batch([])

    assert batch.shape == (0, 3, 15, 15)
    assert batch.dtype == np.float32


def test_encode_rejects_invalid_player():
    with pytest.raises(ValueError):
        encode_state(new_board(), current_player=3)


# ============================================================
# Differential test against the actual V4.0 JavaScript engine
# ============================================================

NODE_PARITY_SCRIPT = """
import fs from "node:fs";
import {
  candidates,
  immediateWins,
  winLine
} from "./v4.0/src/engine.js";

const cases = JSON.parse(fs.readFileSync(0, "utf8"));
const output = cases.map(({ board, radius, player, index }) => ({
  candidates: candidates(board, radius),
  immediateWins: immediateWins(board, player),
  winLine: winLine(board, index, player)
}));
process.stdout.write(JSON.stringify(output));
"""


@pytest.mark.skipif(
    shutil.which("node") is None,
    reason="Node.js is not installed; skipping JavaScript parity test",
)
def test_python_rules_match_actual_v40_javascript_engine():
    repo_root = Path(__file__).resolve().parents[2]

    board_four = new_board()
    for col in range(5, 9):
        board_four[spot(7, col)] = BLACK

    board_five = new_board()
    for col in range(5, 10):
        board_five[spot(7, col)] = WHITE

    cases = [
        {
            "board": new_board().tolist(),
            "radius": 2,
            "player": BLACK,
            "index": CENTER,
        },
        {
            "board": board_four.tolist(),
            "radius": 2,
            "player": BLACK,
            "index": spot(7, 7),
        },
        {
            "board": board_five.tolist(),
            "radius": 2,
            "player": WHITE,
            "index": spot(7, 7),
        },
    ]

    completed = subprocess.run(
        ["node", "--input-type=module", "-e", NODE_PARITY_SCRIPT],
        cwd=repo_root,
        input=json.dumps(cases),
        text=True,
        capture_output=True,
        check=True,
    )

    javascript_results = json.loads(completed.stdout)

    for case, js_result in zip(cases, javascript_results):
        board = np.asarray(case["board"], dtype=np.int8)

        assert candidates(board, case["radius"]) == js_result["candidates"]
        assert immediate_wins(board, case["player"]) == js_result["immediateWins"]
        assert win_line(board, case["index"], case["player"]) == js_result["winLine"]
