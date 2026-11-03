from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import torch

from .game import BLACK, WHITE
from .tactical import analyze_tactical_evidence
from .mcts import PUCTConfig, PUCTSearch, TorchEvaluator
from .network import build_model


LEAGUE_VERSION = 1


class FrozenTEBAOpponent:
    """A frozen historical TEBA checkpoint used as a league sparring opponent."""

    def __init__(
        self,
        checkpoint_path: Path,
        device: torch.device,
        search_config: PUCTConfig,
        round_index: int,
    ) -> None:
        payload = torch.load(
            checkpoint_path,
            map_location=device,
            weights_only=False,
        )
        if "model_state_dict" not in payload:
            raise ValueError(f"league checkpoint has no model_state_dict: {checkpoint_path}")

        self.model = build_model().to(device)
        self.model.load_state_dict(payload["model_state_dict"])
        self.model.eval()
        self.search = PUCTSearch(
            TorchEvaluator(self.model, device=str(device)),
            search_config,
        )
        self.round_index = int(payload.get("round_index", round_index))
        self.name = f"TEBA_LEAGUE_R{self.round_index:05d}"

    def choose_game_move(self, game) -> tuple[int, dict[str, object]]:
        result = self.search.search(game, add_root_noise=False)
        if result.best_move is None:
            raise RuntimeError(f"{self.name} returned no move in a non-terminal position")
        return int(result.best_move), {
            "opponent": self.name,
            "round_index": self.round_index,
        }



class TacticalRuleOpponent:
    """
    A deterministic tactical specialist that prioritizes immediate wins,
    forced blocks and fork creation before using a local adjacency heuristic.
    """

    name = "TACTICAL_RULE"

    def choose_game_move(self, game) -> tuple[int, dict[str, object]]:
        player = game.current_player
        evidence = analyze_tactical_evidence(game.board, player)
        candidates = set(int(move) for move in game.get_candidates(radius=2))

        priorities = (
            ("WIN_NOW", evidence.win_now_moves),
            ("MUST_BLOCK", () if evidence.forced_loss else evidence.must_block_moves),
            ("FORK", evidence.fork_moves),
        )
        for reason, moves in priorities:
            available = sorted(candidates.intersection(int(move) for move in moves))
            if available:
                return available[0], {"opponent": self.name, "priority": reason}

        if not candidates:
            raise RuntimeError("tactical opponent received a non-terminal board without legal candidates")

        opponent = WHITE if player == BLACK else BLACK
        board = game.board.reshape(15, 15)
        best_move = None
        best_score = float("-inf")
        for move in sorted(candidates):
            row, col = divmod(move, 15)
            r0, r1 = max(0, row - 2), min(15, row + 3)
            c0, c1 = max(0, col - 2), min(15, col + 3)
            neighborhood = board[r0:r1, c0:c1]
            own_count = int(np.count_nonzero(neighborhood == player))
            opponent_count = int(np.count_nonzero(neighborhood == opponent))
            center_penalty = abs(row - 7) + abs(col - 7)
            score = 2.0 * own_count + 1.5 * opponent_count - 0.05 * center_penalty
            if score > best_score:
                best_score = score
                best_move = move

        return int(best_move), {"opponent": self.name, "priority": "LOCAL_HEURISTIC"}


def register_snapshot(
    checkpoint_path: Path,
    league_dir: Path,
    round_index: int,
    max_opponents: int = 8,
) -> Path:
    """Store a compact model-only snapshot and atomically update the league manifest."""
    if max_opponents < 1:
        raise ValueError("max_opponents must be positive")
    checkpoint_path = Path(checkpoint_path)
    league_dir = Path(league_dir)
    league_dir.mkdir(parents=True, exist_ok=True)

    payload = torch.load(
        checkpoint_path,
        map_location="cpu",
        weights_only=False,
    )
    if "model_state_dict" not in payload:
        raise ValueError(f"checkpoint has no model_state_dict: {checkpoint_path}")

    filename = f"round_{int(round_index):05d}.pt"
    snapshot_path = league_dir / filename
    temporary = snapshot_path.with_suffix(".pt.tmp")
    torch.save(
        {
            "format_version": LEAGUE_VERSION,
            "round_index": int(round_index),
            "model_state_dict": payload["model_state_dict"],
        },
        temporary,
    )
    os.replace(temporary, snapshot_path)

    manifest_path = league_dir / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("version") != LEAGUE_VERSION:
            raise ValueError("unsupported opponent league manifest version")
    else:
        manifest = {"version": LEAGUE_VERSION, "opponents": []}

    entries = [
        item for item in manifest.get("opponents", [])
        if int(item.get("round_index", -1)) != int(round_index)
    ]
    entries.append({"round_index": int(round_index), "path": filename})
    entries.sort(key=lambda item: int(item["round_index"]))

    if len(entries) > max_opponents:
        # Retain the original baseline and the newest snapshots for diversity.
        if max_opponents == 1:
            entries = [entries[-1]]
        else:
            entries = [entries[0], *entries[-(max_opponents - 1):]]

    updated = {"version": LEAGUE_VERSION, "opponents": entries}
    manifest_tmp = manifest_path.with_suffix(".json.tmp")
    manifest_tmp.write_text(
        json.dumps(updated, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(manifest_tmp, manifest_path)
    return snapshot_path


def load_opponent_league(
    league_dir: Path,
    device: torch.device,
    search_config: PUCTConfig,
    max_opponents: int = 8,
) -> list[FrozenTEBAOpponent]:
    """Load a bounded set of historical snapshots for the next training stage."""
    if max_opponents < 1:
        raise ValueError("max_opponents must be positive")
    manifest_path = Path(league_dir) / "manifest.json"
    if not manifest_path.exists():
        return []

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != LEAGUE_VERSION:
        raise ValueError("unsupported opponent league manifest version")

    entries = manifest.get("opponents", [])[-max_opponents:]
    opponents: list[FrozenTEBAOpponent] = []
    for entry in entries:
        path = Path(league_dir) / entry["path"]
        if not path.is_file():
            raise FileNotFoundError(f"opponent league snapshot is missing: {path}")
        opponents.append(
            FrozenTEBAOpponent(
                path,
                device,
                search_config,
                int(entry["round_index"]),
            )
        )
    return opponents
