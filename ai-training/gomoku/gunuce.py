from __future__ import annotations

import hashlib
import math
import platform
import urllib.request
from pathlib import Path
from typing import Callable

import numpy as np

from .game import BLACK, EMPTY, SIZE, WHITE


GUNUCE_MODEL_SHA256 = "23d38cef34cb63ebd537a3b34be3f5042f05a24688c98a840b55c4e1a9ee0602"
GUNUCE_SOURCE_CHECKPOINT_SHA256 = "bd009681037c481e80e3302e36ac43f3513b4ad72247f706eeae71d3c8b4f08b"
GUNUCE_MODEL_ID = "white-rl-pilot-001-fit7-update4000"
GUNUCE_MODEL_BYTES = 4_494_348
GUNUCE_MODEL_URL = (
    "https://raw.githubusercontent.com/nkfff/gomoku-skill-evaluator/"
    "3afe1a7278c832754b2f48a2f7c915b7e1154337/v4.0/models/gunuce.onnx"
)

_WINDOWS = np.asarray(
    [
        [(r + k * dr) * SIZE + (c + k * dc) for k in range(5)]
        for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1))
        for r in range(SIZE)
        for c in range(SIZE)
        if 0 <= r + 4 * dr < SIZE and 0 <= c + 4 * dc < SIZE
    ],
    dtype=np.int16,
)


def default_gunuce_model_path() -> Path:
    """Use a user cache so the public ONNX artifact is not added to the repo."""
    cache_root = Path.home() / ".cache" / "gomokulab"
    if platform.system() == "Darwin":
        cache_root = Path.home() / "Library" / "Caches" / "GomokuLab"
    return cache_root / "gunuce.onnx"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_gunuce_model(model_path: str | Path | None = None) -> Path:
    """
    Resolve the pinned production Gunuce ONNX model.

    If no custom path is supplied, download the exact public production
    artifact once into the user's cache and verify its published SHA-256.
    """
    if model_path is not None:
        path = Path(model_path).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Gunuce ONNX model not found: {path}")
        actual = _sha256(path)
        if actual != GUNUCE_MODEL_SHA256:
            raise ValueError(
                "Gunuce model SHA-256 mismatch: "
                f"expected {GUNUCE_MODEL_SHA256}, got {actual}"
            )
        return path

    path = default_gunuce_model_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.stat().st_size == GUNUCE_MODEL_BYTES:
        if _sha256(path) == GUNUCE_MODEL_SHA256:
            return path
        path.unlink()

    temporary = path.with_suffix(path.suffix + ".download")
    request = urllib.request.Request(
        GUNUCE_MODEL_URL,
        headers={"User-Agent": "GomokuLab-TEBA-training/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            with temporary.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
        if temporary.stat().st_size != GUNUCE_MODEL_BYTES:
            raise RuntimeError(
                f"unexpected Gunuce model size: {temporary.stat().st_size}"
            )
        actual = _sha256(temporary)
        if actual != GUNUCE_MODEL_SHA256:
            raise RuntimeError(
                "downloaded Gunuce model failed SHA-256 verification: "
                f"{actual}"
            )
        temporary.replace(path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return path


def encode_gunuce_state(
    board: np.ndarray,
    current_player: int,
    last_move: int | None,
) -> np.ndarray:
    """
    Match v4.0/src/gunuce-search.js encode() exactly.

    Channels: current-player stones, opponent stones, last move, and a
    constant color plane (1 for BLACK to move, otherwise 0).
    """
    flat = np.asarray(board, dtype=np.int8).reshape(-1)
    if flat.size != SIZE * SIZE:
        raise ValueError("Gunuce board must contain exactly 225 cells")
    if current_player not in (BLACK, WHITE):
        raise ValueError("current_player must be BLACK or WHITE")

    state = np.zeros((1, 4, SIZE, SIZE), dtype=np.float32)
    state[0, 0] = (flat == current_player).reshape(SIZE, SIZE)
    state[0, 1] = (flat == (WHITE if current_player == BLACK else BLACK)).reshape(
        SIZE, SIZE
    )
    if last_move is not None and int(last_move) >= 0:
        last = int(last_move)
        if last >= SIZE * SIZE or flat[last] == EMPTY:
            raise ValueError("last_move must point to an occupied cell")
        state[0, 2].reshape(-1)[last] = 1.0
    if current_player == BLACK:
        state[0, 3].fill(1.0)
    return state


def _won(board: np.ndarray, action: int, player: int) -> bool:
    row, col = divmod(int(action), SIZE)
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        count = 1
        for sign in (-1, 1):
            r, c = row + sign * dr, col + sign * dc
            while (
                0 <= r < SIZE
                and 0 <= c < SIZE
                and int(board[r * SIZE + c]) == player
            ):
                count += 1
                r += sign * dr
                c += sign * dc
        if count >= 5:
            return True
    return False


def _fast_wins(board: np.ndarray, player: int) -> list[int]:
    if int(np.count_nonzero(board == player)) < 4:
        return []
    wins: set[int] = set()
    for window in _WINDOWS:
        values = board[window]
        if (
            int(np.count_nonzero(values == player)) == 4
            and int(np.count_nonzero(values == EMPTY)) == 1
        ):
            wins.add(int(window[np.flatnonzero(values == EMPTY)[0]]))
    return sorted(wins)


class _Node:
    __slots__ = (
        "board", "player", "last", "winner", "value",
        "actions", "prior", "n", "w", "children",
    )

    def __init__(
        self,
        board: np.ndarray,
        player: int,
        last: int = -1,
        winner: int = 0,
    ) -> None:
        self.board = np.asarray(board, dtype=np.int8).reshape(-1).copy()
        self.player = int(player)
        self.last = int(last)
        self.winner = int(winner)
        self.value = 0.0
        self.actions: np.ndarray | None = None
        self.prior = np.empty(0, dtype=np.float64)
        self.n = np.empty(0, dtype=np.int32)
        self.w = np.empty(0, dtype=np.float64)
        self.children: dict[int, _Node] = {}

    def expand(self, policy_logits: np.ndarray) -> int | None:
        actions = np.flatnonzero(self.board == EMPTY).astype(np.int32)
        own_wins = _fast_wins(self.board, self.player)
        opponent_wins = (
            [] if own_wins else _fast_wins(
                self.board, WHITE if self.player == BLACK else BLACK
            )
        )
        if own_wins:
            actions = np.asarray(own_wins, dtype=np.int32)
        elif len(opponent_wins) == 1:
            actions = np.asarray(opponent_wins, dtype=np.int32)

        if actions.size == 0:
            raise RuntimeError("cannot expand a terminal Gunuce node")

        logits = np.asarray(policy_logits, dtype=np.float64).reshape(-1)
        if logits.shape != (SIZE * SIZE,) or not np.isfinite(logits).all():
            raise ValueError("Gunuce policy output must be 225 finite logits")

        selected = logits[actions]
        selected = selected - float(np.max(selected))
        probabilities = np.exp(selected)
        total = float(probabilities.sum())
        if not math.isfinite(total) or total <= 0:
            probabilities = np.full(len(actions), 1.0 / len(actions))
        else:
            probabilities /= total

        self.actions = actions
        self.prior = probabilities.astype(np.float64, copy=False)
        self.n = np.zeros(len(actions), dtype=np.int32)
        self.w = np.zeros(len(actions), dtype=np.float64)

        if own_wins:
            return 1
        if len(opponent_wins) > 1:
            return -1
        return None

    def child(self, index: int) -> "_Node":
        action = int(self.actions[index])
        if action not in self.children:
            board = self.board.copy()
            board[action] = self.player
            winner = self.player if _won(board, action, self.player) else 0
            next_player = WHITE if self.player == BLACK else BLACK
            self.children[action] = _Node(
                board, next_player, action, winner=winner
            )
        return self.children[action]


class GunuceSearch:
    """
    Python reference port of Gunuce's deployed PUCT search.

    Defaults intentionally match the shipped browser runtime:
    c_puct=1.5, FPU reduction=0.2, full-board legal actions, 128 simulations.
    """

    def __init__(
        self,
        infer: Callable[[np.ndarray], dict[str, object]],
        simulations: int = 128,
        c_puct: float = 1.5,
        fpu_reduction: float = 0.2,
    ) -> None:
        if simulations < 1:
            raise ValueError("simulations must be positive")
        if not math.isfinite(c_puct) or c_puct <= 0:
            raise ValueError("c_puct must be finite and positive")
        if not math.isfinite(fpu_reduction) or fpu_reduction < 0:
            raise ValueError("fpu_reduction must be finite and non-negative")
        self.infer = infer
        self.simulations = int(simulations)
        self.c_puct = float(c_puct)
        self.fpu_reduction = float(fpu_reduction)

    def _evaluate(self, node: _Node) -> float:
        state = encode_gunuce_state(node.board, node.player, node.last)
        output = self.infer(state)
        value = float(output["value"])
        # Match v4.0/src/gunuce-search.js: the deployed browser runtime
        # forwards the ONNX value directly into PUCT without clipping or
        # imposing a [-1, 1] range check. Only reject non-finite model output.
        if not math.isfinite(value):
            raise ValueError("Gunuce value output must be finite")
        proof = node.expand(np.asarray(output["policy"], dtype=np.float32))
        node.value = float(proof) if proof is not None else value
        return node.value

    def _select(self, root: _Node) -> tuple[_Node, list[tuple[_Node, int]]]:
        node = root
        path: list[tuple[_Node, int]] = []
        while (
            node.actions is not None
            and node.winner == 0
            and np.any(node.board == EMPTY)
        ):
            total = 1 + int(node.n.sum())
            scale = math.sqrt(total)
            best_score = -math.inf
            best_index = 0
            for index in range(len(node.actions)):
                visits = int(node.n[index])
                q_value = (
                    float(node.w[index]) / visits
                    if visits
                    else max(-1.0, node.value - self.fpu_reduction)
                )
                score = (
                    q_value
                    + self.c_puct * float(node.prior[index]) * scale
                    / (1 + visits)
                )
                if score > best_score:
                    best_score = score
                    best_index = index
            path.append((node, best_index))
            node = node.child(best_index)
        return node, path

    @staticmethod
    def _backup(path: list[tuple[_Node, int]], value: float) -> None:
        for node, index in reversed(path):
            value = -value
            node.n[index] += 1
            node.w[index] += value

    def search(
        self,
        board: np.ndarray,
        player: int,
        last_move: int | None = None,
    ) -> dict[str, object]:
        root = _Node(
            board,
            player,
            -1 if last_move is None else int(last_move),
        )
        if not np.any(root.board == EMPTY):
            raise ValueError("cannot search a full board")
        self._evaluate(root)

        for _ in range(self.simulations):
            node, path = self._select(root)
            if node.winner:
                value = 1.0 if node.winner == node.player else -1.0
            elif not np.any(node.board == EMPTY):
                value = 0.0
            else:
                value = self._evaluate(node)
            self._backup(path, value)

        visits = root.n
        total_visits = int(visits.sum())
        if total_visits <= 0:
            raise RuntimeError("Gunuce PUCT produced no root visits")

        best_index = 0
        for index in range(1, len(root.actions)):
            current_n = int(visits[index])
            best_n = int(visits[best_index])
            if current_n > best_n:
                best_index = index
                continue
            if current_n < best_n:
                continue
            current_prior = float(root.prior[index])
            best_prior = float(root.prior[best_index])
            if current_prior > best_prior:
                best_index = index
                continue
            if current_prior < best_prior:
                continue
            if current_n > 0:
                current_q = float(root.w[index]) / current_n
                best_q = float(root.w[best_index]) / best_n
                if current_q > best_q:
                    best_index = index

        policy = np.zeros(SIZE * SIZE, dtype=np.float32)
        policy[root.actions] = visits.astype(np.float32) / total_visits
        return {
            "index": int(root.actions[best_index]),
            "policy": policy,
            "visits": visits.copy(),
            "simulations": self.simulations,
            "root_value": float(root.value),
        }


class GunuceONNXOpponent:
    """Frozen Gunuce ONNX opponent, compatible with GomokuGame."""

    def __init__(
        self,
        model_path: str | Path | None = None,
        simulations: int = 128,
        c_puct: float = 1.5,
        fpu_reduction: float = 0.2,
        intra_op_threads: int = 1,
    ) -> None:
        try:
            import onnxruntime as ort
        except ImportError as error:
            raise RuntimeError(
                "Gunuce comparison requires onnxruntime; install it with "
                "python -m pip install onnxruntime."
            ) from error

        self.model_path = ensure_gunuce_model(model_path)
        self.model_sha256 = _sha256(self.model_path)
        options = ort.SessionOptions()
        options.intra_op_num_threads = max(1, int(intra_op_threads))
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(
            str(self.model_path),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )

        input_names = {item.name for item in self.session.get_inputs()}
        output_names = {item.name for item in self.session.get_outputs()}
        if "state" not in input_names or not {"policy", "value"}.issubset(output_names):
            raise RuntimeError(
                "Unexpected Gunuce ONNX signature; expected input=state, outputs=policy/value"
            )

        def infer(state: np.ndarray) -> dict[str, object]:
            policy, value = self.session.run(
                ["policy", "value"],
                {"state": np.asarray(state, dtype=np.float32)},
            )
            return {
                "policy": np.asarray(policy, dtype=np.float32).reshape(-1),
                "value": float(np.asarray(value).reshape(-1)[0]),
            }

        self.infer = infer
        self.search = GunuceSearch(
            infer,
            simulations=simulations,
            c_puct=c_puct,
            fpu_reduction=fpu_reduction,
        )
        self.simulations = int(simulations)
        self.name = f"GUNUCE_{GUNUCE_MODEL_ID}_MCTS{self.simulations}"

    def choose_game_move(self, game) -> tuple[int, dict[str, object]]:
        if game.done:
            raise ValueError("Gunuce cannot move in a terminal game")
        result = self.search.search(
            game.board,
            game.current_player,
            game.last_move,
        )
        move = int(result["index"])
        if move not in game.legal_moves():
            raise RuntimeError(f"Gunuce returned an illegal move: {move}")
        return move, {
            "opponent": self.name,
            "model_sha256": self.model_sha256,
            "simulations": self.simulations,
            "root_value": result["root_value"],
        }
