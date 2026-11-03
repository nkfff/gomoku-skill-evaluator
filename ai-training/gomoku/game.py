from __future__ import annotations

from dataclasses import dataclass

import numpy as np


SIZE = 15
CELLS = SIZE * SIZE
EMPTY = 0
BLACK = 1
WHITE = 2
CENTER = 112

DIRECTIONS = (
    (0, 1),   # Horizontal
    (1, 0),   # Vertical
    (1, 1),   # Main diagonal
    (1, -1),  # Anti diagonal
)

COLUMN_NAMES = "ABCDEFGHIJKLMNO"


def validate_player(player: int) -> int:
    """Validate and normalize a player identifier."""
    if (
        isinstance(player, (bool, np.bool_))
        or not isinstance(player, (int, np.integer))
        or int(player) not in (BLACK, WHITE)
    ):
        raise ValueError("player must be BLACK(1) or WHITE(2)")
    return int(player)


def validate_index(index: int) -> int:
    """Validate a flattened board index in [0, 224]."""
    if (
        isinstance(index, (bool, np.bool_))
        or not isinstance(index, (int, np.integer))
    ):
        raise TypeError("index must be an integer")

    index = int(index)
    if not 0 <= index < CELLS:
        raise ValueError(f"index must be between 0 and {CELLS - 1}")
    return index


def as_board(board) -> np.ndarray:
    """
    Validate a 225-cell integer board and return its flattened NumPy view.

    Integer arrays and integer sequences are accepted. Floating-point and
    boolean arrays are rejected to avoid silently changing game state types.
    """
    array = np.asarray(board)

    if array.size != CELLS:
        raise ValueError(f"board must contain exactly {CELLS} cells")

    if not np.issubdtype(array.dtype, np.integer) or np.issubdtype(
        array.dtype, np.bool_
    ):
        raise TypeError("board must contain integer values")

    array = array.reshape(CELLS)

    if not np.isin(array, (EMPTY, BLACK, WHITE)).all():
        raise ValueError("board contains invalid cell values")

    return array


def new_board() -> np.ndarray:
    """Create an empty 15x15 board as a flattened int8 array."""
    return np.zeros(CELLS, dtype=np.int8)


def inside(row: int, col: int) -> bool:
    return 0 <= row < SIZE and 0 <= col < SIZE


def spot(row: int, col: int) -> int:
    """Convert (row, column) to the V4.0-compatible flattened index."""
    if not inside(row, col):
        raise ValueError("position is outside the board")
    return row * SIZE + col


def coord(index: int) -> str:
    """Convert a flattened index to coordinates such as H8."""
    index = validate_index(index)
    row, col = divmod(index, SIZE)
    return f"{COLUMN_NAMES[col]}{row + 1}"


def board_2d(board) -> np.ndarray:
    """Return a 15x15 view of the flattened board."""
    return as_board(board).reshape(SIZE, SIZE)


def win_line(board, index: int, player: int) -> list[int]:
    """
    Return the contiguous winning line through index, or [] if there is none.

    The direction order and scan order match v4.0/src/engine.js.
    A line of five or more stones wins; overlines are allowed.
    """
    array = as_board(board)
    index = validate_index(index)
    player = validate_player(player)

    if array[index] != player:
        return []

    row, col = divmod(index, SIZE)

    for dr, dc in DIRECTIONS:
        cells = [index]

        for sign in (-1, 1):
            y = row + dr * sign
            x = col + dc * sign

            while inside(y, x):
                current = spot(y, x)
                if array[current] != player:
                    break

                cells.append(current)
                y += dr * sign
                x += dc * sign

        if len(cells) >= 5:
            return cells

    return []


def is_winning_move(board, index: int, player: int) -> bool:
    """Return whether an empty point is an immediate winning move."""
    array = as_board(board)
    index = validate_index(index)
    player = validate_player(player)

    if array[index] != EMPTY:
        return False

    trial = array.copy()
    trial[index] = player
    return bool(win_line(trial, index, player))


def candidates(board, radius: int = 2) -> list[int]:
    """
    Generate empty candidate points around existing stones.

    Iteration and insertion order match the JavaScript Set implementation
    in v4.0/src/engine.js. An empty board returns the center index (112).
    """
    array = as_board(board)

    if (
        isinstance(radius, (bool, np.bool_))
        or not isinstance(radius, (int, np.integer))
    ):
        raise TypeError("radius must be an integer")

    radius = int(radius)
    if radius < 0:
        raise ValueError("radius must be non-negative")

    seen: set[int] = set()
    result: list[int] = []

    for index in range(CELLS):
        if array[index] == EMPTY:
            continue

        row, col = divmod(index, SIZE)

        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                y = row + dy
                x = col + dx

                if not inside(y, x):
                    continue

                candidate = spot(y, x)
                if array[candidate] != EMPTY or candidate in seen:
                    continue

                seen.add(candidate)
                result.append(candidate)

    return result if result else [CENTER]


def immediate_wins(
    board,
    player: int,
    possible: list[int] | None = None,
) -> list[int]:
    """Find all immediate winning moves without mutating the input board."""
    array = as_board(board)
    player = validate_player(player)

    if possible is None:
        possible = candidates(array)

    trial = array.copy()
    result: list[int] = []

    for raw_index in possible:
        index = validate_index(raw_index)

        if trial[index] != EMPTY:
            continue

        trial[index] = player
        if win_line(trial, index, player):
            result.append(index)
        trial[index] = EMPTY

    return result


@dataclass(frozen=True)
class MoveResult:
    player: int
    index: int
    winning_line: tuple[int, ...]
    winner: int | None
    done: bool


class GomokuGame:
    """
    Standard 15x15 Gomoku environment.

    Board encoding:
        0 = empty
        1 = black
        2 = white

    Black moves first. Five or more contiguous stones win. There are no
    Renju forbidden-move rules.
    """

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> np.ndarray:
        self.board = new_board()
        self.current_player = BLACK
        self.last_move: int | None = None
        self.winner: int | None = None
        self.done = False
        self.move_count = 0
        return self.board.copy()

    def legal_moves(self) -> list[int]:
        """Return all currently empty board positions."""
        return np.flatnonzero(self.board == EMPTY).tolist()

    def get_candidates(self, radius: int = 2) -> list[int]:
        """Return local search candidates using the V4.0 radius convention."""
        return candidates(self.board, radius)

    @property
    def is_draw(self) -> bool:
        return self.done and self.winner is None

    def play(self, index: int) -> MoveResult:
        """Play one move for the current player and update game state."""
        if self.done:
            raise RuntimeError("game has already ended")

        index = validate_index(index)

        if self.board[index] != EMPTY:
            raise ValueError("position is already occupied")

        player = self.current_player
        self.board[index] = player
        self.last_move = index
        self.move_count += 1

        line = win_line(self.board, index, player)

        if line:
            self.winner = player
            self.done = True
        elif self.move_count == CELLS:
            self.done = True
        else:
            self.current_player = WHITE if player == BLACK else BLACK

        return MoveResult(
            player=player,
            index=index,
            winning_line=tuple(line),
            winner=self.winner,
            done=self.done,
        )

    def clone(self) -> GomokuGame:
        """Create an independent copy suitable for search-tree simulation."""
        other = object.__new__(GomokuGame)
        other.board = self.board.copy()
        other.current_player = self.current_player
        other.last_move = self.last_move
        other.winner = self.winner
        other.done = self.done
        other.move_count = self.move_count
        return other

    def __repr__(self) -> str:
        symbols = {
            EMPTY: ".",
            BLACK: "X",
            WHITE: "O",
        }
        rows = self.board.reshape(SIZE, SIZE)
        return "\n".join(
            " ".join(symbols[int(value)] for value in row)
            for row in rows
        )
