from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .game import (
    BLACK,
    CELLS,
    SIZE,
    WHITE,
    as_board,
    candidates,
    immediate_wins,
    validate_player,
)


TACTICAL_CHANNELS = 3
WIN_NOW = 0
MUST_BLOCK = 1
FORK = 2
TACTICAL_SEARCH_RADIUS = 2


@dataclass(frozen=True)
class TacticalEvidence:
    """
    Exact one-ply tactical evidence for the side to move.

    targets has shape [3, 15, 15] and follows the tactical-head channel order:
      0: WIN_NOW — current player's immediate winning moves.
      1: MUST_BLOCK — cells that stop the opponent's immediate win.
      2: FORK — moves creating at least two distinct immediate wins next turn.

    Priority is deliberate:
      1. If the current player can win now, only WIN_NOW is labeled.
      2. Otherwise, if the opponent can win on its next move, MUST_BLOCK is
         labeled and fork search is skipped.
      3. Otherwise, fork moves are labeled.

    If the opponent has two or more distinct immediate winning cells, the
    position is marked forced_loss: a single move cannot block all threats.
    In that case every opponent winning cell is still marked in MUST_BLOCK
    as a threat-location target; none is claimed to be a sufficient defense.
    """

    targets: np.ndarray
    win_now_moves: tuple[int, ...]
    must_block_moves: tuple[int, ...]
    fork_moves: tuple[int, ...]
    opponent_winning_moves: tuple[int, ...]
    forced_loss: bool

    @property
    def has_immediate_win(self) -> bool:
        return bool(self.win_now_moves)

    @property
    def has_forced_block(self) -> bool:
        return bool(self.must_block_moves) and not self.forced_loss


def _mark_positions(
    targets: np.ndarray,
    channel: int,
    positions: tuple[int, ...] | list[int],
) -> None:
    plane = targets[channel].reshape(CELLS)
    if positions:
        plane[np.asarray(positions, dtype=np.int64)] = 1.0


def analyze_tactical_evidence(
    board,
    current_player: int,
    include_forks: bool = True,
) -> TacticalEvidence:
    """
    Generate deterministic tactical labels from a 15x15 Gomoku position.

    This is a one-ply, rule-derived labeler, not a heuristic score and not an
    MCTS policy. It provides exact immediate-win / immediate-block evidence
    and, optionally, a defined two-threat fork target. Set include_forks=False
    in latency-sensitive search expansion when only exact immediate wins and
    blocks are needed; the neural tactical head can still guide fork priors.

    Candidate radius 2 is sufficient for these labels: an immediate winning
    point must be adjacent to an existing stone in its four-stone run, and a
    move that creates a fork must participate in at least one such run.
    The radius/order are inherited from the V4.0-compatible candidate engine.

    The input board is never mutated.
    """
    array = as_board(board)
    player = validate_player(current_player)
    opponent = WHITE if player == BLACK else BLACK

    targets = np.zeros(
        (TACTICAL_CHANNELS, SIZE, SIZE),
        dtype=np.float32,
    )

    legal_candidates = candidates(array, radius=TACTICAL_SEARCH_RADIUS)

    # Priority 1: a winning move ends the game, so blocking is not required.
    own_wins = tuple(
        immediate_wins(array, player, possible=legal_candidates)
    )
    if own_wins:
        _mark_positions(targets, WIN_NOW, own_wins)
        return TacticalEvidence(
            targets=targets,
            win_now_moves=own_wins,
            must_block_moves=(),
            fork_moves=(),
            opponent_winning_moves=(),
            forced_loss=False,
        )

    # Priority 2: identify all cells where the opponent would win next move.
    opponent_wins = tuple(
        immediate_wins(array, opponent, possible=legal_candidates)
    )
    if opponent_wins:
        _mark_positions(targets, MUST_BLOCK, opponent_wins)
        return TacticalEvidence(
            targets=targets,
            win_now_moves=(),
            must_block_moves=opponent_wins,
            fork_moves=(),
            opponent_winning_moves=opponent_wins,
            forced_loss=len(opponent_wins) > 1,
        )

    # The search engine only needs exact immediate wins/blocks. Fork
    # enumeration is substantially more expensive and is reserved for
    # supervised target generation and explicit tactical analysis.
    if not include_forks:
        return TacticalEvidence(
            targets=targets,
            win_now_moves=(),
            must_block_moves=(),
            fork_moves=(),
            opponent_winning_moves=(),
            forced_loss=False,
        )

    # Priority 3: find moves that create at least two distinct immediate
    # winning continuations. This is a concrete double-threat definition.
    fork_moves: list[int] = []

    for move in legal_candidates:
        if array[move] != 0:
            continue

        trial = array.copy()
        trial[move] = player

        reply_candidates = candidates(
            trial,
            radius=TACTICAL_SEARCH_RADIUS,
        )
        winning_replies = immediate_wins(
            trial,
            player,
            possible=reply_candidates,
        )

        if len(set(winning_replies)) >= 2:
            fork_moves.append(move)

    fork_tuple = tuple(fork_moves)
    _mark_positions(targets, FORK, fork_tuple)

    return TacticalEvidence(
        targets=targets,
        win_now_moves=(),
        must_block_moves=(),
        fork_moves=fork_tuple,
        opponent_winning_moves=(),
        forced_loss=False,
    )


def generate_tactical_targets(
    board,
    current_player: int,
) -> np.ndarray:
    """
    Return only the float32 [3, 15, 15] tactical target tensor.

    Use analyze_tactical_evidence when diagnostics such as exact threat
    locations, fork moves, or forced-loss status are also required.
    """
    return analyze_tactical_evidence(board, current_player).targets
