import numpy as np

from gomoku.game import BLACK, WHITE
from gomoku.gunuce import GunuceSearch, _fast_wins, encode_gunuce_state


def _dummy_infer(state):
    assert state.shape == (1, 4, 15, 15)
    logits = np.zeros(225, dtype=np.float32)
    logits[112] = 8.0
    return {"policy": logits, "value": 0.0}


def test_gunuce_encoding_matches_four_plane_contract():
    board = np.zeros(225, dtype=np.int8)
    board[112] = BLACK
    board[113] = WHITE

    encoded = encode_gunuce_state(board, WHITE, 112)

    assert encoded.shape == (1, 4, 15, 15)
    assert encoded.dtype == np.float32
    assert encoded[0, 0].reshape(-1)[113] == 1.0
    assert encoded[0, 1].reshape(-1)[112] == 1.0
    assert encoded[0, 2].reshape(-1)[112] == 1.0
    assert np.all(encoded[0, 3] == 0.0)


def test_gunuce_encoding_sets_black_color_plane():
    board = np.zeros(225, dtype=np.int8)
    encoded = encode_gunuce_state(board, BLACK, None)
    assert np.all(encoded[0, 3] == 1.0)
    assert np.count_nonzero(encoded[0, 2]) == 0


def test_fast_wins_detects_both_open_ends():
    board = np.zeros(225, dtype=np.int8)
    board[7 * 15 + 4:7 * 15 + 8] = BLACK
    assert _fast_wins(board, BLACK) == [7 * 15 + 3, 7 * 15 + 8]


def test_gunuce_search_takes_immediate_win():
    board = np.zeros(225, dtype=np.int8)
    board[7 * 15 + 4:7 * 15 + 8] = BLACK

    search = GunuceSearch(_dummy_infer, simulations=8)
    result = search.search(board, BLACK, last_move=7 * 15 + 7)

    assert result["index"] in (7 * 15 + 3, 7 * 15 + 8)


def test_gunuce_search_blocks_unique_immediate_loss():
    board = np.zeros(225, dtype=np.int8)
    board[7 * 15 + 4:7 * 15 + 8] = WHITE
    board[7 * 15 + 3] = BLACK

    search = GunuceSearch(_dummy_infer, simulations=8)
    result = search.search(board, BLACK, last_move=7 * 15 + 7)

    assert result["index"] == 7 * 15 + 8


def test_gunuce_search_uses_network_policy_on_empty_board():
    board = np.zeros(225, dtype=np.int8)
    search = GunuceSearch(_dummy_infer, simulations=16)
    result = search.search(board, BLACK)

    assert result["index"] == 112
    assert result["simulations"] == 16
    assert np.isclose(result["policy"].sum(), 1.0)



def test_gunuce_value_matches_browser_for_finite_values_outside_unit_interval():
    def infer(state):
        assert state.shape == (1, 4, 15, 15)
        return {
            "policy": np.zeros(225, dtype=np.float32),
            "value": 1.25,
        }

    search = GunuceSearch(infer, simulations=1)
    result = search.search(np.zeros(225, dtype=np.int8), BLACK)

    assert result["root_value"] == 1.25


def test_gunuce_search_rejects_non_finite_value_output():
    def infer(state):
        return {
            "policy": np.zeros(225, dtype=np.float32),
            "value": float("nan"),
        }

    search = GunuceSearch(infer, simulations=1)
    with np.testing.assert_raises_regex(ValueError, "must be finite"):
        search.search(np.zeros(225, dtype=np.int8), BLACK)
