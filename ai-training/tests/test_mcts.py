from __future__ import annotations

import numpy as np
import pytest

from gomoku.game import BLACK, WHITE, GomokuGame, new_board, spot
from gomoku.mcts import PUCTConfig, PUCTSearch, TorchEvaluator
from gomoku.network import build_model


def constant_evaluator(game):
    return {
        "policy_logits": np.zeros(225, dtype=np.float32),
        "value": 0.0,
        "tactical_logits": np.zeros((3, 15, 15), dtype=np.float32),
    }


def make_game_with_stones(stones, current_player):
    game = GomokuGame()
    for row, col, player in stones:
        game.board[spot(row, col)] = player
    game.current_player = current_player
    game.move_count = len(stones)
    return game


def test_empty_board_search_returns_center():
    game = GomokuGame()
    search = PUCTSearch(
        constant_evaluator,
        PUCTConfig(simulations=12),
    )

    result = search.search(game)

    assert result.best_move == spot(7, 7)
    assert result.visit_counts == {spot(7, 7): 12}
    assert result.visit_policy[spot(7, 7)] == pytest.approx(1.0)
    assert sum(result.visit_counts.values()) == 12
    assert result.root_value == pytest.approx(0.0)


def test_search_returns_only_empty_local_candidates():
    game = GomokuGame()
    game.play(spot(7, 7))

    search = PUCTSearch(
        constant_evaluator,
        PUCTConfig(simulations=24),
    )
    result = search.search(game)

    assert result.best_move in game.get_candidates()
    assert game.board[result.best_move] == 0
    assert sum(result.visit_counts.values()) == 24
    assert result.visit_policy.sum() == pytest.approx(1.0)


def test_immediate_win_overrides_network_policy():
    stones = [
        (7, 5, BLACK),
        (7, 6, BLACK),
        (7, 7, BLACK),
        (7, 8, BLACK),
    ]
    game = make_game_with_stones(stones, BLACK)

    def evaluator(_game):
        logits = np.zeros(225, dtype=np.float32)
        logits[spot(0, 0)] = 100.0
        return {
            "policy_logits": logits,
            "value": -0.8,
            "tactical_logits": np.zeros((3, 15, 15), dtype=np.float32),
        }

    result = PUCTSearch(
        evaluator,
        PUCTConfig(simulations=16),
    ).search(game)

    assert set(result.visit_counts) == {spot(7, 4), spot(7, 9)}
    assert result.best_move in {spot(7, 4), spot(7, 9)}
    assert result.root_value == pytest.approx(1.0)


def test_unique_opponent_threat_forces_must_block():
    stones = [(7, col, WHITE) for col in range(4)]
    game = make_game_with_stones(stones, BLACK)

    result = PUCTSearch(
        constant_evaluator,
        PUCTConfig(simulations=8),
    ).search(game)

    assert result.best_move == spot(7, 4)
    assert set(result.visit_counts) == {spot(7, 4)}


def test_multiple_opponent_wins_are_reported_as_forced_loss():
    stones = [(7, col, WHITE) for col in range(5, 9)]
    game = make_game_with_stones(stones, BLACK)

    result = PUCTSearch(
        constant_evaluator,
        PUCTConfig(simulations=8),
    ).search(game)

    assert result.forced_loss
    assert result.best_move is not None
    assert game.board[result.best_move] == 0
    assert result.root_value == pytest.approx(-1.0)


def test_tactical_logits_adjust_candidate_priors():
    game = GomokuGame()
    game.play(spot(7, 7))
    preferred = spot(5, 5)
    alternative = spot(5, 6)

    def evaluator(_game):
        tactical = np.zeros((3, 15, 15), dtype=np.float32)
        tactical[2].reshape(-1)[preferred] = 4.0
        return {
            "policy_logits": np.zeros(225, dtype=np.float32),
            "value": 0.0,
            "tactical_logits": tactical,
        }

    result = PUCTSearch(
        evaluator,
        PUCTConfig(
            simulations=8,
            tactical_prior_weights=(0.0, 0.0, 1.0),
        ),
    ).search(game)

    assert result.root_priors[preferred] > result.root_priors[alternative]


def test_root_dirichlet_noise_is_reproducible_with_seed():
    game = GomokuGame()
    game.play(spot(7, 7))
    game.play(spot(7, 8))

    search = PUCTSearch(
        constant_evaluator,
        PUCTConfig(simulations=10),
    )

    first = search.search(game, add_root_noise=True, seed=123)
    second = search.search(game, add_root_noise=True, seed=123)

    assert first.root_priors == pytest.approx(second.root_priors)


def test_search_does_not_mutate_input_game():
    game = GomokuGame()
    game.play(spot(7, 7))
    before_board = game.board.copy()
    before_player = game.current_player
    before_last_move = game.last_move

    PUCTSearch(
        constant_evaluator,
        PUCTConfig(simulations=10),
    ).search(game)

    assert np.array_equal(game.board, before_board)
    assert game.current_player == before_player
    assert game.last_move == before_last_move


def test_terminal_win_is_backed_up_with_correct_sign():
    stones = [(7, col, BLACK) for col in range(5, 9)]
    game = make_game_with_stones(stones, BLACK)

    result = PUCTSearch(
        constant_evaluator,
        PUCTConfig(simulations=12),
    ).search(game)

    assert result.best_move in {spot(7, 4), spot(7, 9)}
    assert result.root_value == pytest.approx(1.0)


def test_terminal_game_has_no_search_move():
    game = GomokuGame()
    moves = [
        (7, 3), (0, 0),
        (7, 4), (0, 1),
        (7, 5), (0, 2),
        (7, 6), (1, 0),
        (7, 7),
    ]
    for row, col in moves:
        game.play(spot(row, col))

    result = PUCTSearch(constant_evaluator).search(game)

    assert result.best_move is None
    assert result.visit_counts == {}
    assert result.simulations == 0


def test_temperature_zero_uses_most_visited_action():
    game = GomokuGame()
    result = PUCTSearch(
        constant_evaluator,
        PUCTConfig(simulations=8),
    ).search(game)

    assert PUCTSearch.select_move(result, temperature=0) == result.best_move


def test_positive_temperature_sampling_is_reproducible():
    game = GomokuGame()
    game.play(spot(7, 7))
    result = PUCTSearch(
        constant_evaluator,
        PUCTConfig(simulations=20),
    ).search(game)

    first = PUCTSearch.select_move(result, temperature=1.0, seed=99)
    second = PUCTSearch.select_move(result, temperature=1.0, seed=99)

    assert first == second
    assert first in result.visit_counts


def test_torch_evaluator_connects_teba_network():
    model = build_model()
    evaluator = TorchEvaluator(model, device="cpu")
    output = evaluator(GomokuGame())

    assert output["policy_logits"].shape == (225,)
    assert output["tactical_logits"].shape == (3, 15, 15)
    assert -1.0 <= output["value"] <= 1.0


def test_puct_config_rejects_invalid_values():
    with pytest.raises(ValueError):
        PUCTConfig(simulations=0)

    with pytest.raises(ValueError):
        PUCTConfig(c_puct=0)

    with pytest.raises(ValueError):
        PUCTConfig(candidate_radius=-1)

    with pytest.raises(ValueError):
        PUCTConfig(tactical_prior_weights=(1.0, 1.0))

    with pytest.raises(ValueError):
        PUCTConfig(root_noise_fraction=1.5)


def test_search_rejects_invalid_evaluator_output():
    def invalid_evaluator(_game):
        return {
            "policy_logits": np.zeros(224),
            "value": 0.0,
            "tactical_logits": np.zeros((3, 15, 15)),
        }

    with pytest.raises(ValueError):
        PUCTSearch(invalid_evaluator).search(GomokuGame())


def test_select_move_rejects_invalid_temperature():
    game = GomokuGame()
    result = PUCTSearch(
        constant_evaluator,
        PUCTConfig(simulations=4),
    ).search(game)

    with pytest.raises(ValueError):
        PUCTSearch.select_move(result, temperature=-0.1)
