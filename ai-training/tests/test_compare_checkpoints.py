from __future__ import annotations

import numpy as np
import pytest

from gomoku.compare_checkpoints import (
    attach_pair_outcomes,
    build_parser,
    play_comparison_game,
)
from gomoku.game import BLACK, WHITE, spot
from gomoku.mcts import PUCTConfig, PUCTSearch


def constant_evaluator(_game):
    return {
        "policy_logits": np.zeros(225, dtype=np.float32),
        "value": 0.0,
        "tactical_logits": np.zeros((3, 15, 15), dtype=np.float32),
    }


def _forced_black_win_opening():
    opening = []
    black_moves = [spot(7, col) for col in range(5, 9)]
    white_moves = [spot(0, col) for col in range(4)]
    for black_move, white_move in zip(black_moves, white_moves):
        opening.append({"player": BLACK, "move": black_move})
        opening.append({"player": WHITE, "move": white_move})
    return opening


def _search():
    return PUCTSearch(
        constant_evaluator,
        PUCTConfig(simulations=4, root_noise_fraction=0.0),
    )


def test_comparison_game_swaps_model_colors_on_the_same_opening():
    opening = _forced_black_win_opening()
    search_a = _search()
    search_b = _search()

    a_as_black = play_comparison_game(
        search_a,
        search_b,
        BLACK,
        opening,
        game_index=1,
        pair_index=1,
    )
    a_as_white = play_comparison_game(
        search_a,
        search_b,
        WHITE,
        opening,
        game_index=2,
        pair_index=1,
    )

    assert a_as_black["opening_moves"] == a_as_white["opening_moves"] == opening
    assert a_as_black["outcome"] == 1
    assert a_as_black["winner_model"] == "MODEL_A"
    assert a_as_white["outcome"] == -1
    assert a_as_white["winner_model"] == "MODEL_B"
    assert a_as_black["plies"] == a_as_white["plies"] == 9
    assert a_as_black["model_a_missed_immediate_wins"] == 0
    assert a_as_white["model_b_missed_immediate_wins"] == 0


def test_pair_summary_counts_one_win_each_as_a_paired_draw():
    results = [
        {
            "opening_pair": 1,
            "model_a_color": "BLACK",
            "outcome": 1,
        },
        {
            "opening_pair": 1,
            "model_a_color": "WHITE",
            "outcome": -1,
        },
    ]

    summary = attach_pair_outcomes(results)

    assert summary == {
        "model_a_pair_wins": 0,
        "pair_draws": 1,
        "model_b_pair_wins": 0,
    }
    assert [item["pair_outcome"] for item in results] == ["DRAW", "DRAW"]


def test_pair_summary_detects_model_a_pair_win():
    results = [
        {"opening_pair": 1, "model_a_color": "BLACK", "outcome": 1},
        {"opening_pair": 1, "model_a_color": "WHITE", "outcome": 1},
    ]

    summary = attach_pair_outcomes(results)

    assert summary["model_a_pair_wins"] == 1
    assert summary["pair_draws"] == 0
    assert summary["model_b_pair_wins"] == 0


def test_pair_summary_rejects_missing_color_swap():
    results = [
        {"opening_pair": 1, "model_a_color": "BLACK", "outcome": 1},
        {"opening_pair": 1, "model_a_color": "BLACK", "outcome": 1},
    ]

    with pytest.raises(ValueError, match="swap MODEL_A"):
        attach_pair_outcomes(results)


def test_compare_parser_defaults_to_twenty_color_swapped_pairs():
    args = build_parser().parse_args([
        "--checkpoint-a", "round_0005_model.pt",
        "--checkpoint-b", "round_0030_model.pt",
    ])

    assert args.games == 40
    assert args.simulations == 64
    assert args.opening_plies == 6
    assert args.seed == 2028


def test_comparison_rejects_invalid_model_color():
    with pytest.raises(ValueError, match="model_a_player"):
        play_comparison_game(
            _search(),
            _search(),
            0,
            _forced_black_win_opening(),
        )
