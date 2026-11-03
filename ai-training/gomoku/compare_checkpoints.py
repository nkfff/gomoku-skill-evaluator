from __future__ import annotations

import argparse
import csv
import json
import math
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

from .diagnostics import make_ply_record
from .evaluate import _replay_opening, generate_opening_moves, load_model
from .game import BLACK, WHITE, GomokuGame, validate_player
from .mcts import PUCTConfig, PUCTSearch, TorchEvaluator
from .tactical import analyze_tactical_evidence


def play_comparison_game(
    search_a: PUCTSearch,
    search_b: PUCTSearch,
    model_a_player: int,
    opening_moves: list[dict[str, int]],
    *,
    max_plies: int = 225,
    game_index: int = 1,
    pair_index: int = 1,
) -> dict[str, object]:
    """Play one game between two frozen models from a shared legal opening."""
    try:
        model_a_player = validate_player(model_a_player)
    except (TypeError, ValueError) as error:
        raise ValueError("model_a_player must be BLACK or WHITE") from error
    if not 1 <= max_plies <= 225:
        raise ValueError("max_plies must be between 1 and 225")
    if len(opening_moves) >= max_plies:
        raise ValueError("max_plies must leave room for at least one model move")

    game = GomokuGame()
    move_records = _replay_opening(game, list(opening_moves))
    model_a_times: list[float] = []
    model_b_times: list[float] = []
    model_a_moves = 0
    model_b_moves = 0

    while not game.done and game.move_count < max_plies:
        player = game.current_player
        board_before = game.board.copy()
        last_move_before = game.last_move
        evidence = analyze_tactical_evidence(
            board_before,
            player,
            include_forks=True,
        )

        if player == model_a_player:
            agent = "MODEL_A"
            search = search_a
            timing = model_a_times
            model_a_moves += 1
        else:
            agent = "MODEL_B"
            search = search_b
            timing = model_b_times
            model_b_moves += 1

        started = time.perf_counter()
        search_result = search.search(game, add_root_noise=False)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        timing.append(elapsed_ms)
        move = search_result.best_move

        if move is None:
            raise RuntimeError(f"{agent} returned no move in a non-terminal position")

        move_records.append(
            make_ply_record(
                board_before,
                game.move_count,
                player,
                agent,
                move,
                evidence,
                elapsed_ms,
                last_move=last_move_before,
                search_result=search_result,
            )
        )
        game.play(move)

    if not game.done:
        raise RuntimeError(
            f"comparison game reached max_plies={max_plies} without a terminal result"
        )

    outcome = (
        0 if game.winner is None
        else 1 if game.winner == model_a_player
        else -1
    )
    model_a_color = "BLACK" if model_a_player == BLACK else "WHITE"
    return {
        "game": int(game_index),
        "opening_pair": int(pair_index),
        "opening_moves": list(opening_moves),
        "model_a_player": int(model_a_player),
        "model_a_color": model_a_color,
        "outcome": int(outcome),
        "winner": game.winner,
        "winner_model": (
            "DRAW" if game.winner is None
            else "MODEL_A" if game.winner == model_a_player
            else "MODEL_B"
        ),
        "plies": int(game.move_count),
        "model_a_moves": int(model_a_moves),
        "model_b_moves": int(model_b_moves),
        "model_a_mean_search_ms": (
            float(np.mean(model_a_times)) if model_a_times else 0.0
        ),
        "model_b_mean_search_ms": (
            float(np.mean(model_b_times)) if model_b_times else 0.0
        ),
        "model_a_max_search_ms": (
            float(np.max(model_a_times)) if model_a_times else 0.0
        ),
        "model_b_max_search_ms": (
            float(np.max(model_b_times)) if model_b_times else 0.0
        ),
        "model_a_missed_immediate_wins": sum(
            int(record["tactical"]["missed_immediate_win"])
            for record in move_records
            if record["agent"] == "MODEL_A"
        ),
        "model_a_missed_forced_blocks": sum(
            int(record["tactical"]["missed_forced_block"])
            for record in move_records
            if record["agent"] == "MODEL_A"
        ),
        "model_a_missed_forks": sum(
            int(record["tactical"]["missed_fork"])
            for record in move_records
            if record["agent"] == "MODEL_A"
        ),
        "model_b_missed_immediate_wins": sum(
            int(record["tactical"]["missed_immediate_win"])
            for record in move_records
            if record["agent"] == "MODEL_B"
        ),
        "model_b_missed_forced_blocks": sum(
            int(record["tactical"]["missed_forced_block"])
            for record in move_records
            if record["agent"] == "MODEL_B"
        ),
        "model_b_missed_forks": sum(
            int(record["tactical"]["missed_fork"])
            for record in move_records
            if record["agent"] == "MODEL_B"
        ),
        "moves": move_records,
    }


def attach_pair_outcomes(results: list[dict[str, object]]) -> dict[str, int]:
    """Annotate each two-game color-swapped pair and return pair win counts."""
    grouped: dict[int, list[dict[str, object]]] = defaultdict(list)
    for result in results:
        grouped[int(result["opening_pair"])].append(result)

    summary = {"model_a_pair_wins": 0, "pair_draws": 0, "model_b_pair_wins": 0}
    for pair_index, games in grouped.items():
        if len(games) != 2:
            raise ValueError(f"opening pair {pair_index} must contain exactly two games")
        colors = {str(item["model_a_color"]) for item in games}
        if colors != {"BLACK", "WHITE"}:
            raise ValueError(
                f"opening pair {pair_index} must swap MODEL_A between both colors"
            )

        points = sum(
            1.0 if int(item["outcome"]) == 1
            else 0.5 if int(item["outcome"]) == 0
            else 0.0
            for item in games
        )
        if points > 1.0:
            pair_outcome = "MODEL_A"
            summary["model_a_pair_wins"] += 1
        elif points < 1.0:
            pair_outcome = "MODEL_B"
            summary["model_b_pair_wins"] += 1
        else:
            pair_outcome = "DRAW"
            summary["pair_draws"] += 1

        for item in games:
            item["pair_outcome"] = pair_outcome

    return summary


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")


def run_comparison(args: argparse.Namespace) -> Path:
    if args.games < 2 or args.games % 2:
        raise ValueError("--games must be an even integer >= 2")
    if args.simulations < 1:
        raise ValueError("--simulations must be positive")
    if not 0 <= args.opening_plies <= 20:
        raise ValueError("--opening-plies must be between 0 and 20")
    if args.max_plies <= args.opening_plies or args.max_plies > 225:
        raise ValueError("--max-plies must exceed opening-plies and be <= 225")
    if not math.isfinite(args.c_puct) or args.c_puct <= 0:
        raise ValueError("--c-puct must be finite and positive")

    device = torch.device(args.device)
    if device.type == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was requested but is not available")
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is not available")

    model_a, payload_a = load_model(Path(args.checkpoint_a), device)
    model_b, payload_b = load_model(Path(args.checkpoint_b), device)
    config = PUCTConfig(
        simulations=args.simulations,
        c_puct=args.c_puct,
        root_noise_fraction=0.0,
    )
    search_a = PUCTSearch(TorchEvaluator(model_a, device=str(device)), config)
    search_b = PUCTSearch(TorchEvaluator(model_b, device=str(device)), config)

    output = Path(args.output)
    games_output = Path(
        args.games_output or output.with_name(f"{output.stem}_games.jsonl")
    )
    plies_output = Path(
        args.plies_output or output.with_name(f"{output.stem}_plies.jsonl")
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    games_output.parent.mkdir(parents=True, exist_ok=True)
    plies_output.parent.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(args.seed)
    results: list[dict[str, object]] = []

    # Every pair uses one identical opening, then swaps which frozen model
    # controls BLACK and WHITE. Search settings are identical for both models.
    for pair_index in range(args.games // 2):
        opening = generate_opening_moves(args.opening_plies, rng)
        for color_index, model_a_player in enumerate((BLACK, WHITE)):
            game_index = pair_index * 2 + color_index + 1
            result = play_comparison_game(
                search_a,
                search_b,
                model_a_player,
                opening,
                max_plies=args.max_plies,
                game_index=game_index,
                pair_index=pair_index + 1,
            )
            results.append(result)
            print(
                f"Game {game_index}/{args.games} | pair={pair_index + 1} | "
                f"MODEL_A={'BLACK' if model_a_player == BLACK else 'WHITE'} | "
                f"outcome={int(result['outcome']):+d} | "
                f"plies={result['plies']} | "
                f"A/B search="
                f"{result['model_a_mean_search_ms']:.1f}/"
                f"{result['model_b_mean_search_ms']:.1f} ms"
            )

    pair_summary = attach_pair_outcomes(results)
    wins = sum(int(item["outcome"]) == 1 for item in results)
    draws = sum(int(item["outcome"]) == 0 for item in results)
    losses = sum(int(item["outcome"]) == -1 for item in results)
    score = (wins + 0.5 * draws) / args.games
    smoothed_score = (wins + 0.5 * draws + 0.5) / (args.games + 1)
    elo_difference = 400.0 * math.log10(
        smoothed_score / (1.0 - smoothed_score)
    )

    def mean_move_latency(agent: str) -> float:
        values = [
            float(move["search_ms"])
            for game_result in results
            for move in game_result["moves"]
            if move["agent"] == agent
        ]
        return float(np.mean(values)) if values else 0.0

    a_black = [
        item for item in results if item["model_a_color"] == "BLACK"
    ]
    a_white = [
        item for item in results if item["model_a_color"] == "WHITE"
    ]

    fields = [
        "game",
        "opening_pair",
        "pair_outcome",
        "model_a_color",
        "outcome",
        "winner_model",
        "plies",
        "model_a_moves",
        "model_b_moves",
        "model_a_mean_search_ms",
        "model_b_mean_search_ms",
        "model_a_max_search_ms",
        "model_b_max_search_ms",
        "model_a_missed_immediate_wins",
        "model_a_missed_forced_blocks",
        "model_a_missed_forks",
        "model_b_missed_immediate_wins",
        "model_b_missed_forced_blocks",
        "model_b_missed_forks",
    ]
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows({key: item[key] for key in fields} for item in results)

    _write_jsonl(games_output, results)
    ply_rows = []
    for item in results:
        for move in item["moves"]:
            ply_rows.append({
                "game": item["game"],
                "opening_pair": item["opening_pair"],
                "pair_outcome": item["pair_outcome"],
                "model_a_color": item["model_a_color"],
                **move,
            })
    _write_jsonl(plies_output, ply_rows)

    print("\n========== CHECKPOINT HEAD-TO-HEAD ==========")
    print(
        f"MODEL_A: {args.checkpoint_a} "
        f"(round={payload_a.get('round_index', 'unknown')})"
    )
    print(
        f"MODEL_B: {args.checkpoint_b} "
        f"(round={payload_b.get('round_index', 'unknown')})"
    )
    print(
        f"Games: {args.games} | color-swapped opening pairs: {args.games // 2}"
    )
    print(f"Opening plies: {args.opening_plies} | seed: {args.seed}")
    print(f"MODEL_A wins / draws / losses: {wins} / {draws} / {losses}")
    print(f"MODEL_A match score: {score:.3f}")
    print(
        f"MODEL_A smoothed Elo difference: {elo_difference:+.1f} "
        "(small-sample descriptive estimate)"
    )
    print(
        "Paired results (A / draw / B): "
        f"{pair_summary['model_a_pair_wins']} / "
        f"{pair_summary['pair_draws']} / "
        f"{pair_summary['model_b_pair_wins']}"
    )
    print(
        "MODEL_A as BLACK wins/draws/losses: "
        f"{sum(int(x['outcome']) == 1 for x in a_black)}/"
        f"{sum(int(x['outcome']) == 0 for x in a_black)}/"
        f"{sum(int(x['outcome']) == -1 for x in a_black)}"
    )
    print(
        "MODEL_A as WHITE wins/draws/losses: "
        f"{sum(int(x['outcome']) == 1 for x in a_white)}/"
        f"{sum(int(x['outcome']) == 0 for x in a_white)}/"
        f"{sum(int(x['outcome']) == -1 for x in a_white)}"
    )
    print(
        "Mean search latency (A / B): "
        f"{mean_move_latency('MODEL_A'):.1f} / "
        f"{mean_move_latency('MODEL_B'):.1f} ms/move"
    )
    for model_label, prefix in (("MODEL_A", "model_a"), ("MODEL_B", "model_b")):
        print(
            f"{model_label} tactical misses (win / forced block / fork): "
            f"{sum(int(x[f'{prefix}_missed_immediate_wins']) for x in results)} / "
            f"{sum(int(x[f'{prefix}_missed_forced_blocks']) for x in results)} / "
            f"{sum(int(x[f'{prefix}_missed_forks']) for x in results)}"
        )
    print(f"Game summary CSV: {output}")
    print(f"Full game records: {games_output}")
    print(f"Per-ply diagnostics: {plies_output}")
    return output


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Compare two frozen TEBA checkpoints with paired openings and color swaps."
    )
    parser.add_argument("--checkpoint-a", required=True)
    parser.add_argument("--checkpoint-b", required=True)
    parser.add_argument("--device", choices=("mps", "cpu", "cuda"), default="mps")
    parser.add_argument("--games", type=int, default=40)
    parser.add_argument("--simulations", type=int, default=64)
    parser.add_argument("--c-puct", type=float, default=1.25)
    parser.add_argument("--max-plies", type=int, default=225)
    parser.add_argument("--opening-plies", type=int, default=6)
    parser.add_argument("--seed", type=int, default=2028)
    parser.add_argument("--output", default="evaluation/head_to_head.csv")
    parser.add_argument("--games-output", default=None)
    parser.add_argument("--plies-output", default=None)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.games < 2 or args.games % 2:
        raise SystemExit("--games must be an even integer >= 2")
    if args.simulations < 1:
        raise SystemExit("--simulations must be positive")
    run_comparison(args)


if __name__ == "__main__":
    main()
