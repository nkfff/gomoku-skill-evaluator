from __future__ import annotations

import argparse
import csv
import math
import time
from pathlib import Path

import numpy as np
import torch

from .game import BLACK, WHITE, GomokuGame
from .legacy_opponent import LegacyEngineOpponent
from .mcts import PUCTConfig, PUCTSearch, TorchEvaluator
from .network import build_model


def load_model(checkpoint_path: Path, device: torch.device):
    payload = torch.load(
        checkpoint_path,
        map_location=device,
        weights_only=False,
    )
    if "model_state_dict" not in payload:
        raise ValueError(f"checkpoint has no model_state_dict: {checkpoint_path}")

    model = build_model().to(device)
    model.load_state_dict(payload["model_state_dict"])
    model.eval()
    return model, payload


def play_evaluation_game(
    model: torch.nn.Module,
    device: torch.device,
    champion: LegacyEngineOpponent,
    learner_player: int,
    simulations: int = 32,
    c_puct: float = 1.25,
    max_plies: int = 225,
) -> dict[str, object]:
    game = GomokuGame()
    evaluator = TorchEvaluator(model, device=str(device))
    search = PUCTSearch(
        evaluator,
        PUCTConfig(
            simulations=simulations,
            c_puct=c_puct,
            root_noise_fraction=0.0,
        ),
    )
    learner_moves = 0
    champion_moves = 0
    learner_search_seconds = []

    while not game.done and game.move_count < max_plies:
        if game.current_player == learner_player:
            started = time.perf_counter()
            result = search.search(game, add_root_noise=False)
            learner_search_seconds.append(time.perf_counter() - started)
            move = result.best_move
            learner_moves += 1
        else:
            move, _diagnostics = champion.choose_move(
                game.board,
                game.current_player,
            )
            champion_moves += 1

        if move is None:
            raise RuntimeError("an evaluation agent failed to return a legal move")
        game.play(move)

    if not game.done:
        raise RuntimeError("evaluation game did not terminate")

    outcome = (
        0 if game.winner is None
        else 1 if game.winner == learner_player
        else -1
    )
    return {
        "outcome": outcome,
        "learner_player": learner_player,
        "winner": game.winner,
        "plies": game.move_count,
        "learner_moves": learner_moves,
        "champion_moves": champion_moves,
        "mean_search_ms": (
            1000.0 * float(np.mean(learner_search_seconds))
            if learner_search_seconds else 0.0
        ),
        "max_search_ms": (
            1000.0 * float(np.max(learner_search_seconds))
            if learner_search_seconds else 0.0
        ),
    }


def run_evaluation(args: argparse.Namespace) -> Path:
    if args.games < 2:
        raise ValueError("use at least 2 games to test both colors")
    if args.games % 2:
        raise ValueError("--games must be even so both colors are tested equally")

    device = torch.device(args.device)
    if device.type == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was requested but is not available")
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is not available")

    model, payload = load_model(Path(args.checkpoint), device)
    results = []
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    with LegacyEngineOpponent(
        node_executable=args.node_executable,
        level="hard",
        width=args.champion_width,
        time_ms=args.champion_time_ms,
        max_depth=args.champion_max_depth,
    ) as champion:
        for game_index in range(args.games):
            learner_player = BLACK if game_index % 2 == 0 else WHITE
            result = play_evaluation_game(
                model,
                device,
                champion,
                learner_player,
                simulations=args.simulations,
                c_puct=args.c_puct,
                max_plies=args.max_plies,
            )
            result["game"] = game_index + 1
            results.append(result)
            print(
                f"Game {game_index + 1}/{args.games} | "
                f"learner={'BLACK' if learner_player == BLACK else 'WHITE'} | "
                f"outcome={result['outcome']:+d} | "
                f"plies={result['plies']} | "
                f"mean_search={result['mean_search_ms']:.1f} ms"
            )

    wins = sum(int(item["outcome"] == 1) for item in results)
    draws = sum(int(item["outcome"] == 0) for item in results)
    losses = sum(int(item["outcome"] == -1) for item in results)
    score = (wins + 0.5 * draws) / args.games
    smoothed_score = (wins + 0.5 * draws + 0.5) / (args.games + 1)
    elo_difference = 400.0 * math.log10(
        smoothed_score / (1.0 - smoothed_score)
    )
    mean_search_ms = float(np.mean([item["mean_search_ms"] for item in results]))

    fieldnames = [
        "game",
        "learner_player",
        "outcome",
        "winner",
        "plies",
        "learner_moves",
        "champion_moves",
        "mean_search_ms",
        "max_search_ms",
    ]
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for item in results:
            writer.writerow(item)

    print("\n========== MATCH SUMMARY ==========")
    print(f"Checkpoint round: {payload.get('round_index', 'unknown')}")
    print(f"Games: {args.games} (equal black/white assignment)")
    print(f"TEBA wins / draws / losses: {wins} / {draws} / {losses}")
    print(f"Match score: {score:.3f}")
    print(f"Smoothed Elo estimate: {elo_difference:+.1f} (small sample; indicative only)")
    print(f"Mean TEBA search latency: {mean_search_ms:.1f} ms/move")
    print(f"Per-game results: {output}")
    return output


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Evaluate a TEBA checkpoint against the V4.0 hard champion."
    )
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--device", choices=("mps", "cpu", "cuda"), default="mps")
    parser.add_argument("--node-executable", default="node")
    parser.add_argument("--games", type=int, default=10)
    parser.add_argument("--simulations", type=int, default=32)
    parser.add_argument("--c-puct", type=float, default=1.25)
    parser.add_argument("--max-plies", type=int, default=225)
    parser.add_argument("--champion-width", type=int, default=12)
    parser.add_argument("--champion-time-ms", type=int, default=180)
    parser.add_argument("--champion-max-depth", type=int, default=7)
    parser.add_argument("--output", default="evaluation/champion_match.csv")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.games < 2 or args.games % 2:
        raise SystemExit("--games must be an even integer >= 2")
    if args.simulations < 1 or args.champion_time_ms < 0:
        raise SystemExit("simulations must be positive and champion time non-negative")
    run_evaluation(args)


if __name__ == "__main__":
    main()
