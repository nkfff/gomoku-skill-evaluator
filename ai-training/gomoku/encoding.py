from __future__ import annotations

import numpy as np

from .game import (
    BLACK,
    CELLS,
    EMPTY,
    SIZE,
    WHITE,
    as_board,
    validate_index,
    validate_player,
)


def encode_state(
    board,
    current_player: int,
    last_move: int | None = None,
) -> np.ndarray:
    """
    Encode a Gomoku state as a float32 tensor with shape [3, 15, 15].

    Channel 0: stones belonging to the current player.
    Channel 1: stones belonging to the opponent.
    Channel 2: the most recent move (one-hot spatial plane).

    The encoding is always relative to the player whose turn it is, so the
    network does not need separate black-player and white-player policies.
    """
    array = as_board(board)
    current_player = validate_player(current_player)
    opponent = WHITE if current_player == BLACK else BLACK

    encoded = np.zeros((3, SIZE, SIZE), dtype=np.float32)
    board_2d = array.reshape(SIZE, SIZE)

    encoded[0] = board_2d == current_player
    encoded[1] = board_2d == opponent

    if last_move is not None:
        last_move = validate_index(last_move)

        if array[last_move] == EMPTY:
            raise ValueError("last_move must point to an occupied position")

        encoded[2].reshape(CELLS)[last_move] = 1.0

    return encoded


def encode_batch(states) -> np.ndarray:
    """
    Encode an iterable of (board, current_player, last_move) tuples.

    Returns a float32 array with shape [B, 3, 15, 15]. An empty iterable
    returns an array with shape [0, 3, 15, 15].
    """
    encoded_states = [
        encode_state(board, player, last_move)
        for board, player, last_move in states
    ]

    if not encoded_states:
        return np.empty((0, 3, SIZE, SIZE), dtype=np.float32)

    return np.stack(encoded_states, axis=0)
