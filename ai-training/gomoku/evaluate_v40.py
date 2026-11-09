from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

from .evaluate import generate_opening_moves, load_model, play_evaluation_game
from .game import BLACK, WHITE
from .legacy_opponent import LegacyEngineOpponent
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


def _game_score(outcome: int) -> float:
    return 1.0 if outcome > 0 else 0.5 if outcome == 0 else 0.0


def evaluate_v40_match(
    checkpoint: str | Path,
    *,
    device: str = "mps",
    games: int = 40,
    simulations: int = 128,
    c_puct: float = 1.25,
    opening_plies: int = 6,
    max_plies: int = 225,
    seed: int = 2032,
    node_executable: str = "node",
    champion_width: int = 14,
    champion_time_ms: int = 500,
    champion_max_depth: int = 10,
    output: str | Path | None = None,
) -> dict[str, object]:
    """Evaluate TEBA against the actual V4.0 hard/王者 alpha-beta engine.

    Each opening is played twice with TEBA colors swapped. The V4.0 engine
    keeps the same width/time/depth budget in every game.
    """
    if games < 2 or games % 2:
        raise ValueError("games must be an even integer >= 2")
    if simulations < 1:
        raise ValueError("simulations must be positive")
    if not 0 <= opening_plies <= 20:
        raise ValueError("opening_plies must be in [0, 20]")
    if max_plies <= opening_plies or max_plies > 225:
        raise ValueError("max_plies must exceed opening_plies and be <= 225")

    torch_device = resolve_device(device)
    model, payload = load_model(Path(checkpoint), torch_device)
    rng = np.random.default_rng(seed)
    results: list[dict[str, object]] = []

    with LegacyEngineOpponent(
        node_executable=node_executable,
        level="hard",
        width=champion_width,
        time_ms=champion_time_ms,
        max_depth=champion_max_depth,
    ) as v40:
        for pair_index in range(games // 2):
            opening = generate_opening_moves(opening_plies, rng)
            for color_index, learner_player in enumerate((BLACK, WHITE)):
                game_index = pair_index * 2 + color_index + 1
                raw = play_evaluation_game(
                    model,
                    torch_device,
                    v40,
                    learner_player,
                    simulations=simulations,
                    c_puct=c_puct,
                    max_plies=max_plies,
                    opening_moves=opening,
                    game_index=game_index,
                    pair_index=pair_index + 1,
                )
                item = {
                    "game": game_index,
                    "opening_pair": pair_index + 1,
                    "learner_color": (
                        "BLACK" if learner_player == BLACK else "WHITE"
                    ),
                    "outcome": int(raw["outcome"]),
                    "winner": raw["winner"],
                    "plies": int(raw["plies"]),
                    "teba_mean_search_ms": float(raw["mean_search_ms"]),
                    "v40_mean_search_ms": float(raw["mean_champion_search_ms"]),
                    "missed_immediate_wins": int(raw["missed_immediate_wins"]),
                    "missed_forced_blocks": int(raw["missed_forced_blocks"]),
                    "missed_forks": int(raw["missed_forks"]),
                    "opening_moves": opening,
                }
                results.append(item)
                print(
                    f"V4.0 eval {game_index}/{games} | pair={pair_index + 1} | "
                    f"TEBA={item['learner_color']} | "
                    f"outcome={item['outcome']:+d} | plies={item['plies']} | "
                    f"TEBA/V4.0="
                    f"{item['teba_mean_search_ms']:.1f}/"
                    f"{item['v40_mean_search_ms']:.1f} ms"
                )

    grouped: dict[int, list[dict[str, object]]] = defaultdict(list)
    for item in results:
        grouped[int(item["opening_pair"])].append(item)

    pair_scores: list[float] = []
    pair_wins = pair_draws = pair_losses = 0
    for pair_index, pair in sorted(grouped.items()):
        if len(pair) != 2 or {item["learner_color"] for item in pair} != {"BLACK", "WHITE"}:
            raise RuntimeError(f"invalid color-swapped pair: {pair_index}")
        points = sum(_game_score(int(item["outcome"])) for item in pair)
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
    black = [item for item in results if item["learner_color"] == "BLACK"]
    white = [item for item in results if item["learner_color"] == "WHITE"]
    ci_low, ci_high = _bootstrap_pair_interval(pair_scores, seed + 17)

    def color_score(items: list[dict[str, object]]) -> float:
        return float(np.mean([_game_score(int(item["outcome"])) for item in items]))

    metrics: dict[str, object] = {
        "checkpoint": str(checkpoint),
        "checkpoint_round": int(payload.get("round_index", -1)),
        "games": int(games),
        "simulations": int(simulations),
        "opening_plies": int(opening_plies),
        "seed": int(seed),
        "v40_level": "hard",
        "v40_width": int(champion_width),
        "v40_time_ms": int(champion_time_ms),
        "v40_max_depth": int(champion_max_depth),
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
        "black_score": color_score(black),
        "white_score": color_score(white),
        "teba_mean_search_ms": float(np.mean([
            float(item["teba_mean_search_ms"]) for item in results
        ])),
        "v40_mean_search_ms": float(np.mean([
            float(item["v40_mean_search_ms"]) for item in results
        ])),
        "missed_immediate_wins": int(sum(
            int(item["missed_immediate_wins"]) for item in results
        )),
        "missed_forced_blocks": int(sum(
            int(item["missed_forced_blocks"]) for item in results
        )),
        "missed_forks": int(sum(int(item["missed_forks"]) for item in results)),
    }

    if output is not None:
        output_path = Path(output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fields = [
            "game", "opening_pair", "learner_color", "outcome", "winner",
            "plies", "teba_mean_search_ms", "v40_mean_search_ms",
            "missed_immediate_wins", "missed_forced_blocks", "missed_forks",
        ]
        with output_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows({key: item[key] for key in fields} for item in results)

        summary_path = output_path.with_suffix(".json")
        summary_path.write_text(
            json.dumps(metrics, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        games_path = output_path.with_name(f"{output_path.stem}_games.jsonl")
        with games_path.open("w", encoding="utf-8") as handle:
            for item in results:
                handle.write(json.dumps(item, ensure_ascii=False) + "\n")
        metrics["output"] = str(output_path)
        metrics["summary_output"] = str(summary_path)
        metrics["games_output"] = str(games_path)

    print("\n========== TEBA vs V4.0 ==========")
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
        f"mean search latency TEBA/V4.0="
        f"{metrics['teba_mean_search_ms']:.1f}/"
        f"{metrics['v40_mean_search_ms']:.1f} ms/move"
    )
    print(
        "TEBA tactical misses (win / forced block / fork): "
        f"{metrics['missed_immediate_wins']} / "
        f"{metrics['missed_forced_blocks']} / {metrics['missed_forks']}"
    )
    return metrics


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Paired-opening TEBA versus the V4.0 hard/王者 alpha-beta engine."
    )
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--device", choices=("auto", "mps", "cpu", "cuda"), default="mps")
    parser.add_argument("--node-executable", default="node")
    parser.add_argument("--games", type=int, default=40)
    parser.add_argument("--simulations", type=int, default=128)
    parser.add_argument("--c-puct", type=float, default=1.25)
    parser.add_argument("--max-plies", type=int, default=225)
    parser.add_argument("--opening-plies", type=int, default=6)
    parser.add_argument("--seed", type=int, default=2032)
    parser.add_argument("--champion-width", type=int, default=14)
    parser.add_argument("--champion-time-ms", type=int, default=500)
    parser.add_argument("--champion-max-depth", type=int, default=10)
    parser.add_argument("--output", default="evaluation/teba_vs_v40.csv")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.games < 2 or args.games % 2:
        raise SystemExit("--games must be an even integer >= 2")
    if args.simulations < 1 or args.champion_time_ms < 0:
        raise SystemExit("simulations must be positive and V4.0 time non-negative")
    evaluate_v40_match(
        args.checkpoint,
        device=args.device,
        games=args.games,
        simulations=args.simulations,
        c_puct=args.c_puct,
        opening_plies=args.opening_plies,
        max_plies=args.max_plies,
        seed=args.seed,
        node_executable=args.node_executable,
        champion_width=args.champion_width,
        champion_time_ms=args.champion_time_ms,
        champion_max_depth=args.champion_max_depth,
        output=args.output,
    )


if __name__ == "__main__":
    main()
