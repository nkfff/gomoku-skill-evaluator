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

from .evaluate import _replay_opening, generate_opening_moves, load_model
from .game import BLACK, WHITE, GomokuGame
from .gunuce import GunuceONNXOpponent
from .mcts import PUCTConfig, PUCTSearch, TorchEvaluator
from .train import resolve_device


def _bootstrap_pair_interval(
    pair_scores: list[float],
    seed: int,
    samples: int = 5000,
) -> tuple[float, float]:
    if not pair_scores:
        raise ValueError("pair_scores must not be empty")
    values = np.asarray(pair_scores, dtype=np.float64)
    rng = np.random.default_rng(seed)
    draws = rng.choice(values, size=(samples, len(values)), replace=True)
    means = draws.mean(axis=1)
    return float(np.quantile(means, 0.025)), float(np.quantile(means, 0.975))


def _score(outcome: int) -> float:
    return 1.0 if outcome > 0 else 0.5 if outcome == 0 else 0.0


def _play_game(
    teba_search: PUCTSearch,
    gunuce: GunuceONNXOpponent,
    teba_player: int,
    opening: list[dict[str, int]],
    max_plies: int,
    game_index: int,
    pair_index: int,
) -> dict[str, object]:
    game = GomokuGame()
    _replay_opening(game, list(opening))
    teba_times: list[float] = []
    gunuce_times: list[float] = []
    teba_moves = 0
    gunuce_moves = 0

    while not game.done and game.move_count < max_plies:
        if game.current_player == teba_player:
            started = time.perf_counter()
            result = teba_search.search(game, add_root_noise=False)
            teba_times.append((time.perf_counter() - started) * 1000.0)
            move = result.best_move
            teba_moves += 1
            agent = "TEBA"
        else:
            started = time.perf_counter()
            move, _diagnostics = gunuce.choose_game_move(game)
            gunuce_times.append((time.perf_counter() - started) * 1000.0)
            gunuce_moves += 1
            agent = "GUNUCE"

        if move is None:
            raise RuntimeError(f"{agent} returned no move in a non-terminal position")
        if int(move) not in game.legal_moves():
            raise RuntimeError(f"{agent} returned an illegal move: {move}")
        game.play(int(move))

    if not game.done:
        raise RuntimeError(
            f"game reached max_plies={max_plies} without a terminal result"
        )

    outcome = (
        0 if game.winner is None
        else 1 if game.winner == teba_player
        else -1
    )
    return {
        "game": int(game_index),
        "opening_pair": int(pair_index),
        "teba_player": int(teba_player),
        "teba_color": "BLACK" if teba_player == BLACK else "WHITE",
        "outcome": int(outcome),
        "winner": game.winner,
        "winner_name": (
            "DRAW" if game.winner is None
            else "TEBA" if game.winner == teba_player
            else "GUNUCE"
        ),
        "plies": int(game.move_count),
        "teba_moves": int(teba_moves),
        "gunuce_moves": int(gunuce_moves),
        "teba_mean_search_ms": (
            float(np.mean(teba_times)) if teba_times else 0.0
        ),
        "gunuce_mean_search_ms": (
            float(np.mean(gunuce_times)) if gunuce_times else 0.0
        ),
        "teba_max_search_ms": (
            float(np.max(teba_times)) if teba_times else 0.0
        ),
        "gunuce_max_search_ms": (
            float(np.max(gunuce_times)) if gunuce_times else 0.0
        ),
    }


def evaluate_match(
    checkpoint: str | Path,
    gunuce: GunuceONNXOpponent,
    *,
    device: str = "mps",
    games: int = 100,
    teba_simulations: int = 128,
    c_puct: float = 1.25,
    opening_plies: int = 6,
    max_plies: int = 225,
    seed: int = 2032,
    output: str | Path | None = None,
) -> dict[str, object]:
    """Color-swapped paired-opening evaluation: TEBA (A) versus frozen Gunuce (B)."""
    if games < 2 or games % 2:
        raise ValueError("games must be an even integer >= 2")
    if teba_simulations < 1:
        raise ValueError("teba_simulations must be positive")
    if not 0 <= opening_plies <= 20:
        raise ValueError("opening_plies must be in [0, 20]")
    if max_plies <= opening_plies or max_plies > 225:
        raise ValueError("max_plies must exceed opening_plies and be <= 225")

    torch_device = resolve_device(device)

    model, payload = load_model(Path(checkpoint), torch_device)
    search = PUCTSearch(
        TorchEvaluator(model, device=str(torch_device)),
        PUCTConfig(
            simulations=teba_simulations,
            c_puct=c_puct,
            root_noise_fraction=0.0,
        ),
    )

    rng = np.random.default_rng(seed)
    results: list[dict[str, object]] = []
    for pair_index in range(games // 2):
        opening = generate_opening_moves(opening_plies, rng)
        for color_index, teba_player in enumerate((BLACK, WHITE)):
            game_index = pair_index * 2 + color_index + 1
            result = _play_game(
                search,
                gunuce,
                teba_player,
                opening,
                max_plies,
                game_index,
                pair_index + 1,
            )
            result["opening_moves"] = list(opening)
            results.append(result)
            print(
                f"Game {game_index}/{games} | pair={pair_index + 1} | "
                f"TEBA={'BLACK' if teba_player == BLACK else 'WHITE'} | "
                f"outcome={int(result['outcome']):+d} | plies={result['plies']} | "
                f"TEBA/Gunuce="
                f"{result['teba_mean_search_ms']:.1f}/"
                f"{result['gunuce_mean_search_ms']:.1f} ms"
            )

    grouped: dict[int, list[dict[str, object]]] = defaultdict(list)
    for item in results:
        grouped[int(item["opening_pair"])].append(item)

    pair_scores: list[float] = []
    pair_wins = pair_draws = pair_losses = 0
    for pair_index, pair in sorted(grouped.items()):
        if len(pair) != 2 or {item["teba_color"] for item in pair} != {"BLACK", "WHITE"}:
            raise RuntimeError(f"invalid color-swapped pair: {pair_index}")
        points = sum(_score(int(item["outcome"])) for item in pair)
        if points > 1.0:
            pair_scores.append(1.0)
            pair_wins += 1
        elif points < 1.0:
            pair_scores.append(0.0)
            pair_losses += 1
        else:
            pair_scores.append(0.5)
            pair_draws += 1

    wins = sum(int(item["outcome"]) == 1 for item in results)
    draws = sum(int(item["outcome"]) == 0 for item in results)
    losses = sum(int(item["outcome"]) == -1 for item in results)
    black_games = [item for item in results if item["teba_color"] == "BLACK"]
    white_games = [item for item in results if item["teba_color"] == "WHITE"]
    ci_low, ci_high = _bootstrap_pair_interval(pair_scores, seed + 17)

    def color_score(items: list[dict[str, object]]) -> float:
        return float(np.mean([_score(int(item["outcome"])) for item in items]))

    def mean_latency(key: str) -> float:
        values = [float(item[key]) for item in results if float(item[key]) > 0]
        return float(np.mean(values)) if values else 0.0

    metrics: dict[str, object] = {
        "checkpoint": str(checkpoint),
        "checkpoint_round": int(payload.get("round_index", -1)),
        "gunuce_model_sha256": gunuce.model_sha256,
        "gunuce_model": str(gunuce.model_path),
        "games": int(games),
        "teba_simulations": int(teba_simulations),
        "gunuce_simulations": int(gunuce.simulations),
        "opening_plies": int(opening_plies),
        "seed": int(seed),
        "wins": int(wins),
        "draws": int(draws),
        "losses": int(losses),
        "game_score": float((wins + 0.5 * draws) / games),
        "pair_score": float(np.mean(pair_scores)),
        "pair_ci_low": ci_low,
        "pair_ci_high": ci_high,
        "pair_wins": int(pair_wins),
        "pair_draws": int(pair_draws),
        "pair_losses": int(pair_losses),
        "black_score": color_score(black_games),
        "white_score": color_score(white_games),
        "teba_mean_search_ms": mean_latency("teba_mean_search_ms"),
        "gunuce_mean_search_ms": mean_latency("gunuce_mean_search_ms"),
        "results": results,
    }

    if output is not None:
        output_path = Path(output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fields = [
            "game", "opening_pair", "teba_color", "outcome", "winner_name",
            "plies", "teba_moves", "gunuce_moves",
            "teba_mean_search_ms", "gunuce_mean_search_ms",
            "teba_max_search_ms", "gunuce_max_search_ms",
        ]
        with output_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows({key: item[key] for key in fields} for item in results)

        summary_path = output_path.with_suffix(".json")
        summary = {key: value for key, value in metrics.items() if key != "results"}
        summary_path.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        games_path = output_path.with_name(f"{output_path.stem}_games.jsonl")
        with games_path.open("w", encoding="utf-8") as handle:
            for item in results:
                handle.write(json.dumps(item, ensure_ascii=False) + "\n")
        metrics["output"] = str(output_path)
        metrics["summary_output"] = str(summary_path)
        metrics["games_output"] = str(games_path)

    print("\n========== TEBA vs GUNUCE ==========")
    print(
        f"TEBA checkpoint round={metrics['checkpoint_round']} | "
        f"games={games} | paired openings={games // 2}"
    )
    print(
        f"TEBA W/D/L={wins}/{draws}/{losses} | "
        f"game score={metrics['game_score']:.3f}"
    )
    print(
        f"paired score={metrics['pair_score']:.3f} | "
        f"95% bootstrap CI=[{ci_low:.3f}, {ci_high:.3f}] | "
        f"pair W/D/L={pair_wins}/{pair_draws}/{pair_losses}"
    )
    print(
        f"TEBA as BLACK/WHITE={metrics['black_score']:.3f}/"
        f"{metrics['white_score']:.3f}"
    )
    print(
        f"mean search latency TEBA/Gunuce="
        f"{metrics['teba_mean_search_ms']:.1f}/"
        f"{metrics['gunuce_mean_search_ms']:.1f} ms/move"
    )
    return metrics


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Paired-opening TEBA-Net-S versus frozen production Gunuce ONNX."
    )
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--gunuce-model", default=None)
    parser.add_argument("--device", choices=("mps", "cpu", "cuda"), default="mps")
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--simulations", type=int, default=128)
    parser.add_argument("--c-puct", type=float, default=1.25)
    parser.add_argument("--gunuce-simulations", type=int, default=128)
    parser.add_argument("--gunuce-c-puct", type=float, default=1.5)
    parser.add_argument("--gunuce-fpu-reduction", type=float, default=0.2)
    parser.add_argument("--gunuce-threads", type=int, default=1)
    parser.add_argument("--opening-plies", type=int, default=6)
    parser.add_argument("--max-plies", type=int, default=225)
    parser.add_argument("--seed", type=int, default=2032)
    parser.add_argument("--output", default="evaluation/teba_vs_gunuce.csv")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.games < 2 or args.games % 2:
        raise SystemExit("--games must be an even integer >= 2")
    if args.simulations < 1 or args.gunuce_simulations < 1:
        raise SystemExit("both simulation budgets must be positive")
    opponent = GunuceONNXOpponent(
        model_path=args.gunuce_model,
        simulations=args.gunuce_simulations,
        c_puct=args.gunuce_c_puct,
        fpu_reduction=args.gunuce_fpu_reduction,
        intra_op_threads=args.gunuce_threads,
    )
    evaluate_match(
        args.checkpoint,
        opponent,
        device=args.device,
        games=args.games,
        teba_simulations=args.simulations,
        c_puct=args.c_puct,
        opening_plies=args.opening_plies,
        max_plies=args.max_plies,
        seed=args.seed,
        output=args.output,
    )


if __name__ == "__main__":
    main()
