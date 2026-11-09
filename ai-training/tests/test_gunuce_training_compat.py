import pytest

from gomoku.dual_train import _opponent_teacher_mask
from gomoku.game import GomokuGame


def test_full_board_opponent_move_outside_teba_candidates_is_kept():
    game = GomokuGame()
    game.play(112)  # One center stone; corner 0 is outside radius-2 candidates.

    mask = _opponent_teacher_mask(game, 0, "Gunuce")

    assert mask.shape == (225,)
    assert bool(mask[0])
    assert mask.dtype.name == "bool"


def test_opponent_teacher_mask_rejects_occupied_move():
    game = GomokuGame()
    game.play(112)

    with pytest.raises(RuntimeError, match="illegal move"):
        _opponent_teacher_mask(game, 112, "Gunuce")
