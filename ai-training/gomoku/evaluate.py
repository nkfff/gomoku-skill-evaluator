from __future__ import annotations

import argparse
import csv
import json
import math
import time
from pathlib import Path

import numpy as np
import torch

from .diagnostics import make_ply_record
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


def generate_opening_moves(
    opening_plies: int,
    rng: np.random.Generator,
) -> list[dict[str, int]]:
    """Create a reproducible legal opening shared by a color-swapped match pair."""
    if isinstance(opening_plies, bool) or not isinstance(opening_plies, int):
        raise TypeError("opening_plies must be an integer")
    if not 0 <= opening_plies <= 20:
        raise ValueError("opening_plies must be between 0 and 20")

    game = GomokuGame()
    opening: list[dict[str, int]] = []
    for _ in range(opening_plies):
        actions = game.get_candidates(radius=2)
        move = int(rng.choice(actions))
        player = game.current_player
        game.play(move)
        if game.done:
            break
        opening.append({"player": int(player), "move": move})
    return opening


def _replay_opening(game: GomokuGame, opening_moves: list[dict[str, int]]) -> None:
    for item in opening_moves:
        if game.current_player != int(item["player"]):
            raise ValueError("opening sequence has an invalid player order")
        game.play(int(item["move"]))
        if game.done:
            raise ValueError("opening sequence must not contain a terminal move")


def play_evaluation_game(
    model: torch.nn.Module,
    device: torch.device,
    champion: LegacyEngineOpponent,
    learner_player: int,
    simulations: int = 64,
    c_puct: float = 1.25,
    max_plies: int = 225,
    opening_moves: list[dict[str, int]] | None = None,
    game_index: int = 0,
    pair_index: int = 0,
) -> dict[str, object]:
    game = GomokuGame()
    opening_moves = list(opening_moves or [])
    _replay_opening(game, opening_moves)

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
    champion_search_seconds = []
    move_records: list[dict[str, object]] = []

    while not game.done and game.move_count < max_plies:
        player = game.current_player
        board_before = game.board.copy()
        last_move_before = game.last_move

        from .tactical import analyze_tactical_evidence
        evidence = analyze_tactical_evidence(
            board_before,
            player,
            include_forks=True,
        )

        if player == learner_player:
            started = time.perf_counter()
            search_result = search.search(game, add_root_noise=False)
            elapsed = time.perf_counter() - started
            learner_search_seconds.append(elapsed)
            move = search_result.best_move
            learner_moves += 1
            if move is None:
                raise RuntimeError("TEBA returned no move in a non-terminal position")
            move_records.append(
                make_ply_record(
                    board_before,
                    game.move_count,
                    player,
                    "TEBA",
                    move,
                    evidence,
                    elapsed * 1000.0,
                    last_move=last_move_before,
                    search_result=search_result,
                )
            )
        else:
            started = time.perf_counter()
            move, champion_diagnostics = champion.choose_move(
                game.board,
                player,
            )
            elapsed = time.perf_counter() - started
            champion_search_seconds.append(elapsed)
            champion_moves += 1
            move_records.append(
                make_ply_record(
                    board_before,
                    game.move_count,
                    player,
                    "V4.0_CHAMPION",
                    move,
                    evidence,
                    elapsed * 1000.0,
                    last_move=last_move_before,
                    champion_diagnostics=champion_diagnostics,
                )
            )

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
        "game": int(game_index),
        "opening_pair": int(pair_index),
        "opening_moves": opening_moves,
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
        "mean_champion_search_ms": (
            1000.0 * float(np.mean(champion_search_seconds))
            if champion_search_seconds else 0.0
        ),
        "missed_immediate_wins": sum(
            int(record["tactical"]["missed_immediate_win"])
            for record in move_records
            if record["agent"] == "TEBA"
        ),
        "missed_forced_blocks": sum(
            int(record["tactical"]["missed_forced_block"])
            for record in move_records
            if record["agent"] == "TEBA"
        ),
        "missed_forks": sum(
            int(record["tactical"]["missed_fork"])
            for record in move_records
            if record["agent"] == "TEBA"
        ),
        "moves": move_records,
    }


def run_evaluation(args: argparse.Namespace) -> Path:
    if args.games < 2:
        raise ValueError("use at least 2 games to test both colors")
    if args.games % 2:
        raise ValueError("--games must be even so both colors are tested equally")
    if not 0 <= args.opening_plies <= 20:
        raise ValueError("--opening-plies must be between 0 and 20")

    device = torch.device(args.device)
    if device.type == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was requested but is not available")
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is not available")

    model, payload = load_model(Path(args.checkpoint), device)
    results = []
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    plies_output = Path(
        args.plies_output
        or output.with_name(f"{output.stem}_plies.jsonl")
    )
    games_output = Path(
        args.games_output
        or output.with_name(f"{output.stem}_games.jsonl")
    )
    rng = np.random.default_rng(args.seed)

    # Each pair shares exactly the same opening; only TEBA's color is swapped.
    # This controls opening variance while preventing repeated empty-board games.
    with LegacyEngineOpponent(
        node_executable=args.node_executable,
        level="hard",
        width=args.champion_width,
        time_ms=args.champion_time_ms,
        max_depth=args.champion_max_depth,
    ) as champion:
        for pair_index in range(args.games // 2):
            opening = generate_opening_moves(args.opening_plies, rng)
            for color_index, learner_player in enumerate((BLACK, WHITE)):
                game_index = pair_index * 2 + color_index + 1
                result = play_evaluation_game(
                    model,
                    device,
                    champion,
                    learner_player,
                    simulations=args.simulations,
                    c_puct=args.c_puct,
                    max_plies=args.max_plies,
                    opening_moves=opening,
                    game_index=game_index,
                    pair_index=pair_index + 1,
                )
                results.append(result)
                print(
                    f"Game {game_index}/{args.games} | pair={pair_index + 1} | "
                    f"learner={'BLACK' if learner_player == BLACK else 'WHITE'} | "
                    f"outcome={result['outcome']:+d} | plies={result['plies']} | "
                    f"TEBA={result['mean_search_ms']:.1f} ms | "
                    f"missed-win/block="
                    f"{result['missed_immediate_wins']}/{result['missed_forced_blocks']}"
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
    mean_champion_ms = float(
        np.mean([item["mean_champion_search_ms"] for item in results])
    )

    fieldnames = [
        "game",
        "opening_pair",
        "learner_player",
        "outcome",
        "winner",
        "plies",
        "learner_moves",
        "champion_moves",
        "mean_search_ms",
        "max_search_ms",
        "mean_champion_search_ms",
        "missed_immediate_wins",
        "missed_forced_blocks",
        "missed_forks",
    ]
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for item in results:
            writer.writerow({
                key: item[key]
                for key in fieldnames
            })

    with games_output.open("w", encoding="utf-8") as handle:
        for item in results:
            handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")

    with plies_output.open("w", encoding="utf-8") as handle:
        for item in results:
            for move in item["moves"]:
                row = {
                    "game": item["game"],
                    "opening_pair": item["opening_pair"],
                    "learner_player": (
                        "BLACK" if item["learner_player"] == BLACK else "WHITE"
                    ),
                    **move,
                }
                handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
                handle.write("\n")

    print("\n========== MATCH SUMMARY ==========")
    print(f"Checkpoint round: {payload.get('round_index', 'unknown')}")
    print(f"Games: {args.games} | color-swapped opening pairs: {args.games // 2}")
    print(f"Opening plies: {args.opening_plies} | seed: {args.seed}")
    print(f"TEBA wins / draws / losses: {wins} / {draws} / {losses}")
    print(f"Match score: {score:.3f}")
    print(f"Smoothed Elo estimate: {elo_difference:+.1f} (small sample; indicative only)")
    print(f"Mean TEBA search latency: {mean_search_ms:.1f} ms/move")
    print(f"Mean V4.0 search latency: {mean_champion_ms:.1f} ms/move")
    print(
        "TEBA tactical misses (win / forced block / fork): "
        f"{sum(int(x['missed_immediate_wins']) for x in results)} / "
        f"{sum(int(x['missed_forced_blocks']) for x in results)} / "
        f"{sum(int(x['missed_forks']) for x in results)}"
    )
    print(f"Match summary CSV: {output}")
    print(f"Full game records: {games_output}")
    print(f"Per-ply diagnostics: {plies_output}")
    return output


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Evaluate TEBA against V4.0 with paired openings and move diagnostics."
    )
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--device", choices=("mps", "cpu", "cuda"), default="mps")
    parser.add_argument("--node-executable", default="node")
    parser.add_argument("--games", type=int, default=20)
    parser.add_argument("--simulations", type=int, default=64)
    parser.add_argument("--c-puct", type=float, default=1.25)
    parser.add_argument("--max-plies", type=int, default=225)
    parser.add_argument("--opening-plies", type=int, default=6)
    parser.add_argument("--seed", type=int, default=2028)
    parser.add_argument("--champion-width", type=int, default=14)
    parser.add_argument("--champion-time-ms", type=int, default=500)
    parser.add_argument("--champion-max-depth", type=int, default=10)
    parser.add_argument("--output", default="evaluation/champion_match_diagnostics.csv")
    parser.add_argument("--games-output", default=None)
    parser.add_argument("--plies-output", default=None)
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
