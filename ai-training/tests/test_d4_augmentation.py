from __future__ import annotations

import numpy as np

from gomoku.dual_train import _apply_d4_transform, _augment_batch_d4


def test_d4_transform_preserves_shape_and_values():
    board = np.zeros((3, 15, 15), dtype=np.float32)
    board[0, 2, 5] = 1.0
    board[1, 9, 3] = 1.0

    for rotations in range(4):
        for reflect in (False, True):
            transformed = _apply_d4_transform(board, rotations, reflect)
            assert transformed.shape == board.shape
            assert transformed.sum() == board.sum()
            assert np.count_nonzero(transformed[0]) == 1
            assert np.count_nonzero(transformed[1]) == 1


def test_batch_augmentation_keeps_policy_and_board_coordinates_aligned():
    states = np.zeros((16, 3, 15, 15), dtype=np.float32)
    policies = np.zeros((16, 225), dtype=np.float32)
    tactical = np.zeros((16, 3, 15, 15), dtype=np.float32)
    legal_masks = np.zeros((16, 225), dtype=np.bool_)
    values = np.linspace(-1.0, 1.0, 16, dtype=np.float32)

    source_row, source_col = 2, 5
    source_index = source_row * 15 + source_col
    for index in range(16):
        states[index, 0, source_row, source_col] = 1.0
        policies[index, source_index] = 1.0
        tactical[index, 1, source_row, source_col] = 1.0
        legal_masks[index, source_index] = True

    batch = {
        "states": states,
        "policies": policies,
        "values": values,
        "tactical": tactical,
        "legal_masks": legal_masks,
    }
    augmented = _augment_batch_d4(batch, np.random.default_rng(2029))

    for index in range(len(states)):
        board_position = np.flatnonzero(augmented["states"][index, 0])
        policy_position = np.flatnonzero(augmented["policies"][index])
        tactical_position = np.flatnonzero(augmented["tactical"][index, 1])
        legal_position = np.flatnonzero(augmented["legal_masks"][index])
        assert len(board_position) == 1
        assert len(policy_position) == 1
        assert len(tactical_position) == 1
        assert len(legal_position) == 1
        assert board_position[0] == policy_position[0]
        assert board_position[0] == tactical_position[0]
        assert board_position[0] == legal_position[0]

    np.testing.assert_array_equal(augmented["values"], values)
    np.testing.assert_array_equal(batch["states"], states)
