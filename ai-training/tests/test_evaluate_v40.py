from gomoku.evaluate_v40 import _bootstrap_pair_interval, _game_score


def test_v40_game_score_uses_win_draw_loss_points():
    assert _game_score(1) == 1.0
    assert _game_score(0) == 0.5
    assert _game_score(-1) == 0.0


def test_v40_bootstrap_interval_is_bounded_and_ordered():
    low, high = _bootstrap_pair_interval([1.0, 0.5, 0.0, 1.0], seed=17)
    assert 0.0 <= low <= high <= 1.0
