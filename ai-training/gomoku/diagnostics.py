from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .game import coord


def board_signature(board) -> str:
    """Compact, lossless 225-cell board snapshot for JSONL diagnostics."""
    return "".join(str(int(value)) for value in np.asarray(board).reshape(-1))


def tactical_move_flags(evidence, move: int) -> dict[str, object]:
    """Summarize exact tactical opportunities and whether the selected move missed them."""
    win_now = [int(value) for value in evidence.win_now_moves]
    must_block = [int(value) for value in evidence.must_block_moves]
    opponent_wins = [int(value) for value in evidence.opponent_winning_moves]
    forks = [int(value) for value in evidence.fork_moves]
    forced_loss = bool(evidence.forced_loss)

    return {
        "win_now_moves": win_now,
        "must_block_moves": must_block,
        "opponent_winning_moves": opponent_wins,
        "fork_moves": forks,
        "forced_loss": forced_loss,
        "missed_immediate_win": bool(win_now and move not in win_now),
        "missed_forced_block": bool(
            must_block and not forced_loss and move not in must_block
        ),
        "missed_fork": bool(
            forks and not win_now and not must_block and move not in forks
        ),
    }


def top_search_moves(search_result, limit: int = 5) -> list[dict[str, object]]:
    """Return the most visited root actions with their prior probabilities."""
    actions = set(search_result.visit_counts) | set(search_result.root_priors)
    ranked = sorted(
        actions,
        key=lambda action: (
            int(search_result.visit_counts.get(action, 0)),
            float(search_result.root_priors.get(action, 0.0)),
        ),
        reverse=True,
    )[:limit]
    return [
        {
            "index": int(action),
            "coord": coord(int(action)),
            "visits": int(search_result.visit_counts.get(action, 0)),
            "prior": float(search_result.root_priors.get(action, 0.0)),
        }
        for action in ranked
    ]


def make_ply_record(
    board,
    ply: int,
    player: int,
    agent: str,
    move: int,
    evidence,
    search_ms: float,
    last_move: int | None = None,
    search_result=None,
    champion_diagnostics: dict[str, object] | None = None,
) -> dict[str, object]:
    """Build one JSON-serializable move record shared by training and evaluation."""
    record: dict[str, object] = {
        "ply": int(ply),
        "player": "BLACK" if int(player) == 1 else "WHITE",
        "agent": agent,
        "move_index": int(move),
        "move": coord(int(move)),
        "board_before": board_signature(board),
        "last_move_before": None if last_move is None else int(last_move),
        "search_ms": round(float(search_ms), 3),
        "tactical": tactical_move_flags(evidence, int(move)),
    }

    if search_result is not None:
        record["search"] = {
            "simulations": int(search_result.simulations),
            "root_value": float(search_result.root_value),
            "forced_loss": bool(search_result.forced_loss),
            "top_moves": top_search_moves(search_result),
        }

    if champion_diagnostics is not None:
        record["champion_search"] = {
            "nodes": int(champion_diagnostics.get("nodes", 0)),
            "depth": int(champion_diagnostics.get("depth", 0)),
            "engine_elapsed_ms": float(champion_diagnostics.get("elapsedMs", 0.0)),
            "reason": str(champion_diagnostics.get("reason", "")),
        }

    return record


def append_jsonl(path: Path, record: dict[str, object]) -> None:
    """Append one UTF-8 JSON object per line without loading prior records."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
        handle.write("\n")
