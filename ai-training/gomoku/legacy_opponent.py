from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

from .game import CELLS, GomokuGame, validate_player


class LegacyEngineOpponent:
    """
    Persistent JSON-lines bridge to the actual V4.0 JavaScript AI.

    The champion is V4.0's hard/王者 engine: tactical move ordering,
    iterative-deepening alpha-beta, transposition table and tactical extension.
    Search time is capped for practical M4 training throughput.
    """

    def __init__(
        self,
        node_executable: str = "node",
        level: str = "hard",
        width: int = 12,
        time_ms: int = 180,
        max_depth: int = 7,
    ) -> None:
        if level not in {"easy", "normal", "hard"}:
            raise ValueError("level must be easy, normal, or hard")
        if width < 1 or time_ms < 0 or max_depth < 1:
            raise ValueError("width/depth must be positive and time_ms non-negative")

        executable = shutil.which(node_executable)
        if executable is None:
            raise RuntimeError(
                "Node.js was not found. Install Node.js or pass --node-executable."
            )

        bridge = Path(__file__).with_name("legacy_bridge.mjs")
        if not bridge.is_file():
            raise FileNotFoundError(f"legacy bridge not found: {bridge}")

        self.level = level
        self.width = int(width)
        self.time_ms = int(time_ms)
        self.max_depth = int(max_depth)
        self._process = subprocess.Popen(
            [executable, str(bridge)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

    def choose_move(
        self,
        board,
        player: int,
    ) -> tuple[int, dict[str, object]]:
        player = validate_player(player)
        array = np.asarray(board)
        if array.size != CELLS:
            raise ValueError(f"board must contain {CELLS} cells")
        array = array.reshape(CELLS)

        if self._process.poll() is not None:
            raise RuntimeError("V4.0 champion process exited unexpectedly")
        if self._process.stdin is None or self._process.stdout is None:
            raise RuntimeError("V4.0 champion process pipes are unavailable")

        request = {
            "board": array.astype(int, copy=False).tolist(),
            "player": player,
            "level": self.level,
            "width": self.width,
            "time_ms": self.time_ms,
            "max_depth": self.max_depth,
        }
        self._process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
        self._process.stdin.flush()

        line = self._process.stdout.readline()
        if not line:
            raise RuntimeError("V4.0 champion returned no response")

        response = json.loads(line)
        if "error" in response:
            raise RuntimeError(f"V4.0 champion error: {response['error']}")

        move = response.get("index")
        if (
            isinstance(move, bool)
            or not isinstance(move, int)
            or not 0 <= move < CELLS
            or int(array[move]) != 0
        ):
            raise RuntimeError(f"V4.0 champion returned illegal move: {move!r}")

        return move, response

    def close(self) -> None:
        process = getattr(self, "_process", None)
        if process is None or process.poll() is not None:
            return

        if process.stdin is not None:
            process.stdin.close()

        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

    def __enter__(self) -> LegacyEngineOpponent:
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()
