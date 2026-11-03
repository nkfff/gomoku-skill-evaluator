from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

from .compare_checkpoints import attach_pair_outcomes, play_comparison_game
from .evaluate import generate_opening_moves, load_model
from .league import register_snapshot
from .mcts import PUCTConfig, PUCTSearch, TorchEvaluator
from .train import resolve_device


def bootstrap_pair_interval(
    pair_scores: list[float],
    seed: int,
    samples: int = 3000,
) -> tuple[float, float]:
    """Percentile bootstrap interval over independent color-swapped openings."""
    if not pair_scores:
        raise ValueError("pair_scores must not be empty")
    values = np.asarray(pair_scores, dtype=np.float64)
    rng = np.random.default_rng(seed)
    draws = rng.choice(values, size=(samples, len(values)), replace=True)
    means = draws.mean(axis=1)
    return float(np.quantile(means, 0.025)), float(np.quantile(means, 0.975))


def promotion_decision(
    metrics: dict[str, float],
    min_score: float = 0.55,
    ci_lower: float = 0.50,
) -> bool:
    """Require paired evidence and no regression on either color before promotion."""
    return bool(
        metrics["pair_score"] >= min_score
        and metrics["pair_ci_low"] > ci_lower
        and metrics["black_score"] >= 0.50
        and metrics["white_score"] >= 0.50
    )


def evaluate_pair_match(
    candidate_path: Path,
    incumbent_path: Path,
    device: torch.device,
    games: int,
    simulations: int,
    seed: int,
    opening_plies: int = 6,
) -> dict[str, float | int]:
    """Run a color-swapped candidate-vs-incumbent tournament without large artifacts."""
    if games < 2 or games % 2:
        raise ValueError("evaluation games must be an even integer >= 2")
    if simulations < 1:
        raise ValueError("evaluation simulations must be positive")

    candidate, _ = load_model(Path(candidate_path), device)
    incumbent, _ = load_model(Path(incumbent_path), device)
    config = PUCTConfig(
        simulations=simulations,
        c_puct=1.25,
        root_noise_fraction=0.0,
    )
    search_a = PUCTSearch(TorchEvaluator(candidate, device=str(device)), config)
    search_b = PUCTSearch(TorchEvaluator(incumbent, device=str(device)), config)

    rng = np.random.default_rng(seed)
    compact_results: list[dict[str, object]] = []
    for pair_index in range(games // 2):
        opening = generate_opening_moves(opening_plies, rng)
        for color_index, model_a_player in enumerate((1, -1)):
            result = play_comparison_game(
                search_a,
                search_b,
                model_a_player,
                opening,
                game_index=pair_index * 2 + color_index + 1,
                pair_index=pair_index + 1,
            )
            compact_results.append({
                "opening_pair": pair_index + 1,
                "model_a_color": "BLACK" if color_index == 0 else "WHITE",
                "outcome": int(result["outcome"]),
            })

    pair_summary = attach_pair_outcomes(compact_results)
    wins = sum(int(item["outcome"]) == 1 for item in compact_results)
    draws = sum(int(item["outcome"]) == 0 for item in compact_results)
    losses = sum(int(item["outcome"]) == -1 for item in compact_results)
    black = [item for item in compact_results if item["model_a_color"] == "BLACK"]
    white = [item for item in compact_results if item["model_a_color"] == "WHITE"]

    grouped: dict[int, list[dict[str, object]]] = defaultdict(list)
    for item in compact_results:
        grouped[int(item["opening_pair"])].append(item)
    pair_scores = [
        1.0 if pair[0]["pair_outcome"] == "MODEL_A"
        else 0.5 if pair[0]["pair_outcome"] == "DRAW"
        else 0.0
        for _, pair in sorted(grouped.items())
    ]
    ci_low, ci_high = bootstrap_pair_interval(pair_scores, seed + 17)

    def score(items: list[dict[str, object]]) -> float:
        return float(np.mean([
            1.0 if int(item["outcome"]) == 1
            else 0.5 if int(item["outcome"]) == 0
            else 0.0 for item in items
        ]))

    return {
        "games": games,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "game_score": float((wins + 0.5 * draws) / games),
        "pair_score": float(np.mean(pair_scores)),
        "pair_ci_low": ci_low,
        "pair_ci_high": ci_high,
        "pair_wins": int(pair_summary["model_a_pair_wins"]),
        "pair_draws": int(pair_summary["pair_draws"]),
        "pair_losses": int(pair_summary["model_b_pair_wins"]),
        "black_score": score(black),
        "white_score": score(white),
    }


def _checkpoint_round(path: Path) -> int:
    payload = torch.load(path, map_location="cpu", weights_only=False)
    round_index = int(payload.get("round_index", -1))
    if round_index < 0 or "model_state_dict" not in payload:
        raise ValueError(f"invalid training checkpoint: {path}")
    return round_index


def _write_model_checkpoint(source: Path, destination: Path, round_index: int) -> None:
    payload = torch.load(source, map_location="cpu", weights_only=False)
    if "model_state_dict" not in payload:
        raise ValueError(f"checkpoint has no model_state_dict: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    torch.save(
        {
            "format_version": payload.get("format_version", 1),
            "round_index": int(round_index),
            "global_step": int(payload.get("global_step", 0)),
            "model_state_dict": payload["model_state_dict"],
            "run_config": payload.get("run_config", {}),
        },
        temporary,
    )
    os.replace(temporary, destination)


def _append_jsonl(path: Path, record: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")


def _save_run_state(path: Path, state: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(state, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _training_command(args: argparse.Namespace, latest: Path, stage_rounds: int) -> list[str]:
    command = [
        sys.executable, "-u", "-m", "gomoku.dual_train",
        "--device", args.device,
        "--resume", str(latest),
        "--rounds", str(args.target_rounds),
        "--run-rounds", str(stage_rounds),
        "--output-dir", str(args.output_dir),
        "--seed", str(args.seed),
        "--self-play-games-per-round", str(args.self_play_games_per_round),
        "--champion-games-per-round", str(args.champion_games_per_round),
        "--simulations", str(args.simulations),
        "--updates-per-round", str(args.updates_per_round),
        "--batch-size", str(args.batch_size),
        "--replay-capacity", str(args.replay_capacity),
        "--checkpoint-interval", str(args.checkpoint_interval),
        "--snapshot-interval", str(args.snapshot_interval),
        "--league-fraction", str(args.league_fraction),
        "--league-max-opponents", str(args.league_max_opponents),
        "--max-plies", str(args.max_plies),
        "--temperature-moves", str(args.temperature_moves),
        "--candidate-radius", str(args.candidate_radius),
        "--c-puct", str(args.c_puct),
        "--dirichlet-alpha", str(args.dirichlet_alpha),
        "--root-noise-fraction", str(args.root_noise_fraction),
        "--champion-width", str(args.champion_width),
        "--champion-time-ms", str(args.champion_time_ms),
        "--champion-max-depth", str(args.champion_max_depth),
        "--self-play-weight", str(args.self_play_weight),
        "--sparring-weight", str(args.sparring_weight),
        "--teacher-policy-weight", str(args.teacher_policy_weight),
        "--tactical-weight", str(args.tactical_weight),
        "--learning-rate", str(args.learning_rate),
        "--rebase-learning-rate", str(args.rebase_learning_rate),
        "--weight-decay", str(args.weight_decay),
        "--gradient-clip", str(args.gradient_clip),
        "--warmup-steps", str(args.warmup_steps),
    ]
    if args.d4_augmentation:
        command.append("--d4-augmentation")
    return command


def run_long_training(args: argparse.Namespace) -> Path:
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    latest = output_dir / "latest.pt"
    best_path = output_dir / "best.pt"
    league_dir = output_dir / "opponent_league"
    evaluation_dir = output_dir / "evaluation"
    state_path = output_dir / "long_run_state.json"
    evaluation_log = evaluation_dir / "long_run_evaluations.jsonl"

    if not latest.exists():
        source = Path(args.init_checkpoint)
        if not source.is_file():
            raise FileNotFoundError(f"initial checkpoint not found: {source}")
        shutil.copy2(source, latest)

    current_round = _checkpoint_round(latest)
    if current_round >= args.target_rounds:
        print(f"Target already reached: round {current_round}/{args.target_rounds}")
        return latest

    if not best_path.exists():
        _write_model_checkpoint(latest, best_path, current_round)
    best_round = _checkpoint_round(best_path)
    register_snapshot(best_path, league_dir, best_round, args.league_max_opponents)

    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        plateau_evaluations = int(state.get("plateau_evaluations", 0))
    else:
        plateau_evaluations = 0

    device = resolve_device(args.device)
    evaluation_dir.mkdir(parents=True, exist_ok=True)
    previous_round = current_round

    while current_round < args.target_rounds:
        stage_rounds = min(args.stage_rounds, args.target_rounds - current_round)
        print(
            f"\n===== LONG-RUN STAGE: {current_round + 1}–{current_round + stage_rounds} "
            f"/ {args.target_rounds} ====="
        )
        command = _training_command(args, latest, stage_rounds)
        print("Training command:", " ".join(command))
        subprocess.run(command, check=True)

        current_round = _checkpoint_round(latest)
        expected_round = previous_round + stage_rounds
        if current_round != expected_round:
            raise RuntimeError(
                f"stage checkpoint mismatch: expected round {expected_round}, got {current_round}"
            )

        quick = evaluate_pair_match(
            latest, best_path, device, args.eval_games, args.eval_simulations,
            args.seed + current_round,
        )
        confirmation = None
        promoted = False
        if (
            quick["pair_score"] >= args.promotion_min_score
            and quick["black_score"] >= 0.50
            and quick["white_score"] >= 0.50
        ):
            confirmation = evaluate_pair_match(
                latest, best_path, device, args.confirm_games, args.eval_simulations,
                args.seed + current_round + 100_003,
            )
            promoted = promotion_decision(
                confirmation,
                min_score=args.promotion_min_score,
                ci_lower=args.promotion_ci_lower,
            )

        if promoted:
            _write_model_checkpoint(latest, best_path, current_round)
            register_snapshot(best_path, league_dir, current_round, args.league_max_opponents)
            best_round = current_round
            plateau_evaluations = 0
            print(
                f"PROMOTED: best checkpoint round={best_round}; "
                f"paired score={confirmation['pair_score']:.3f}; "
                f"95% CI=[{confirmation['pair_ci_low']:.3f}, {confirmation['pair_ci_high']:.3f}]"
            )
        else:
            plateau_evaluations += 1
            print(
                f"Candidate not promoted. Best remains round {best_round}; "
                f"plateau={plateau_evaluations}/{args.early_stop_patience}"
            )

        _append_jsonl(evaluation_log, {
            "round": current_round,
            "quick": quick,
            "confirmation": confirmation,
            "promoted": promoted,
            "best_round": best_round,
            "plateau_evaluations": plateau_evaluations,
        })

        if (
            args.champion_eval_interval > 0
            and current_round // args.champion_eval_interval
            > previous_round // args.champion_eval_interval
        ):
            champion_output = evaluation_dir / f"round_{current_round:05d}_vs_v40.csv"
            champion_command = [
                sys.executable, "-u", "-m", "gomoku.evaluate",
                "--checkpoint", str(latest),
                "--device", str(device),
                "--games", str(args.champion_eval_games),
                "--simulations", str(args.eval_simulations),
                "--opening-plies", "6",
                "--seed", str(args.seed + current_round + 200_003),
                "--champion-time-ms", str(args.champion_time_ms),
                "--output", str(champion_output),
            ]
            subprocess.run(champion_command, check=True)

        _save_run_state(state_path, {
            "version": 1,
            "target_rounds": args.target_rounds,
            "current_round": current_round,
            "best_round": best_round,
            "plateau_evaluations": plateau_evaluations,
            "best_checkpoint": str(best_path),
        })

        if (
            current_round >= args.early_stop_min_round
            and plateau_evaluations >= args.early_stop_patience
        ):
            print(
                f"Early stopping at round {current_round}: no promotion in "
                f"{plateau_evaluations} consecutive evaluation stages."
            )
            break

        previous_round = current_round

    print(f"Long-run learner checkpoint: {latest}")
    print(f"Best promoted checkpoint: {best_path} (round {best_round})")
    print(f"Opponent league: {league_dir}")
    print(f"Evaluation history: {evaluation_log}")
    return latest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Long-horizon TEBA reinforcement learning with opponent league and automatic promotion."
    )
    parser.add_argument("--device", choices=("auto", "mps", "cpu", "cuda"), default="mps")
    parser.add_argument("--init-checkpoint", default="checkpoints_dual/latest.pt")
    parser.add_argument("--output-dir", default="checkpoints_longrun")
    parser.add_argument("--target-rounds", type=int, default=30_000)
    parser.add_argument("--stage-rounds", type=int, default=500)
    parser.add_argument("--seed", type=int, default=2029)

    parser.add_argument("--self-play-games-per-round", type=int, default=8)
    parser.add_argument("--champion-games-per-round", type=int, default=8)
    parser.add_argument("--simulations", type=int, default=64)
    parser.add_argument("--updates-per-round", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--replay-capacity", type=int, default=50_000)
    parser.add_argument("--checkpoint-interval", type=int, default=10)
    parser.add_argument("--snapshot-interval", type=int, default=500)

    parser.add_argument("--league-fraction", type=float, default=0.25)
    parser.add_argument("--league-max-opponents", type=int, default=8)
    parser.add_argument("--d4-augmentation", action=argparse.BooleanOptionalAction, default=True)

    parser.add_argument("--eval-games", type=int, default=40)
    parser.add_argument("--confirm-games", type=int, default=100)
    parser.add_argument("--eval-simulations", type=int, default=64)
    parser.add_argument("--promotion-min-score", type=float, default=0.55)
    parser.add_argument("--promotion-ci-lower", type=float, default=0.50)
    parser.add_argument("--early-stop-patience", type=int, default=8)
    parser.add_argument("--early-stop-min-round", type=int, default=5_000)
    parser.add_argument("--champion-eval-interval", type=int, default=2_000)
    parser.add_argument("--champion-eval-games", type=int, default=20)

    parser.add_argument("--max-plies", type=int, default=225)
    parser.add_argument("--temperature-moves", type=int, default=12)
    parser.add_argument("--candidate-radius", type=int, default=2)
    parser.add_argument("--c-puct", type=float, default=1.25)
    parser.add_argument("--dirichlet-alpha", type=float, default=0.3)
    parser.add_argument("--root-noise-fraction", type=float, default=0.25)
    parser.add_argument("--champion-width", type=int, default=14)
    parser.add_argument("--champion-time-ms", type=int, default=500)
    parser.add_argument("--champion-max-depth", type=int, default=10)

    parser.add_argument("--self-play-weight", type=float, default=0.6)
    parser.add_argument("--sparring-weight", type=float, default=0.4)
    parser.add_argument("--teacher-policy-weight", type=float, default=0.15)
    parser.add_argument("--tactical-weight", type=float, default=0.2)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--rebase-learning-rate", type=float, default=5e-5)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--gradient-clip", type=float, default=1.0)
    parser.add_argument("--warmup-steps", type=int, default=500)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.target_rounds < 1 or args.stage_rounds < 1:
        raise SystemExit("target-rounds and stage-rounds must be positive")
    if args.updates_per_round < 1:
        raise SystemExit("updates-per-round must be positive")
    if args.eval_games < 2 or args.eval_games % 2 or args.confirm_games < 2 or args.confirm_games % 2:
        raise SystemExit("eval-games and confirm-games must be even integers >= 2")
    if args.eval_simulations < 1 or args.league_max_opponents < 1:
        raise SystemExit("eval simulations and league size must be positive")
    if not 0.0 <= args.league_fraction <= 1.0:
        raise SystemExit("league-fraction must be in [0, 1]")
    if args.early_stop_patience < 1 or args.early_stop_min_round < 0:
        raise SystemExit("invalid early-stopping settings")
    if args.promotion_min_score <= 0.5 or not 0.0 <= args.promotion_ci_lower < 1.0:
        raise SystemExit("invalid promotion thresholds")
    run_long_training(args)


if __name__ == "__main__":
    main()
