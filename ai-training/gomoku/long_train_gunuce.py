from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import torch

from .evaluate_gunuce import evaluate_match
from .gunuce import GunuceONNXOpponent
from .long_train import (
    _append_jsonl,
    _checkpoint_round,
    _save_run_state,
    _write_model_checkpoint,
    evaluate_pair_match,
    promotion_decision,
)
from .league import register_snapshot
from .train import resolve_device


def _is_full_dual_checkpoint(path: Path) -> bool:
    payload = torch.load(
        path,
        map_location="cpu",
        weights_only=False,
        mmap=True,
    )
    required = {
        "model_state_dict",
        "optimizer_state_dict",
        "scheduler_state_dict",
        "self_play_replay_samples",
        "sparring_replay_samples",
        "teacher_replay_samples",
    }
    return required.issubset(payload)


def _quick_pass(metrics: dict[str, object], min_score: float) -> bool:
    return bool(
        float(metrics["pair_score"]) >= min_score
        and float(metrics["black_score"]) >= 0.50
        and float(metrics["white_score"]) >= 0.50
    )


def _gunuce_promotion_decision(
    metrics: dict[str, object],
    min_score: float,
    ci_lower: float,
) -> bool:
    return bool(
        float(metrics["pair_score"]) >= min_score
        and float(metrics["pair_ci_low"]) > ci_lower
        and float(metrics["black_score"]) >= 0.50
        and float(metrics["white_score"]) >= 0.50
    )


def _training_command(
    args: argparse.Namespace,
    latest: Path,
    stage_rounds: int,
    *,
    initialize_from_model: bool,
) -> list[str]:
    command = [
        sys.executable,
        "-u",
        "-m",
        "gomoku.dual_train",
        "--device", args.device,
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
        "--diagnostics-every", str(args.diagnostics_every),
        "--snapshot-interval", str(args.snapshot_interval),
        "--league-fraction", str(args.league_fraction),
        "--league-max-opponents", str(args.league_max_opponents),
        "--tactical-opponent-fraction", str(args.tactical_opponent_fraction),
        "--gunuce-fraction", str(args.gunuce_fraction),
        "--gunuce-simulations", str(args.gunuce_simulations),
        "--gunuce-c-puct", str(args.gunuce_c_puct),
        "--gunuce-fpu-reduction", str(args.gunuce_fpu_reduction),
        "--gunuce-threads", str(args.gunuce_threads),
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
        "--weight-decay", str(args.weight_decay),
        "--gradient-clip", str(args.gradient_clip),
        "--warmup-steps", str(args.warmup_steps),
    ]
    if args.gunuce_model:
        command.extend(["--gunuce-model", str(args.gunuce_model)])
    if args.d4_augmentation:
        command.append("--d4-augmentation")
    if initialize_from_model:
        command.extend(["--init-checkpoint", str(latest)])
    else:
        command.extend(["--resume", str(latest)])
    return command


def run_long_training(args: argparse.Namespace) -> Path:
    output_dir = Path(args.output_dir).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)
    latest = output_dir / "latest.pt"
    best_path = output_dir / "best.pt"
    league_dir = output_dir / "opponent_league"
    evaluation_dir = output_dir / "evaluation"
    state_path = output_dir / "long_run_state.json"
    evaluation_log = evaluation_dir / "gunuce_long_run_evaluations.jsonl"

    if not latest.exists():
        source = Path(args.init_checkpoint).expanduser()
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

    device = resolve_device(args.eval_device)
    evaluation_dir.mkdir(parents=True, exist_ok=True)
    gunuce = GunuceONNXOpponent(
        model_path=args.gunuce_model,
        simulations=args.eval_gunuce_simulations,
        c_puct=args.gunuce_c_puct,
        fpu_reduction=args.gunuce_fpu_reduction,
        intra_op_threads=args.gunuce_threads,
    )
    print(
        f"Frozen benchmark: {gunuce.name} | "
        f"model_sha256={gunuce.model_sha256}"
    )

    baseline_path = evaluation_dir / f"baseline_round_{best_round:05d}_vs_gunuce.csv"
    if not baseline_path.exists():
        print("\n===== BASELINE: current best TEBA vs Gunuce =====")
        baseline = evaluate_match(
            best_path,
            gunuce,
            device=args.eval_device,
            games=args.baseline_eval_games,
            teba_simulations=args.eval_simulations,
            c_puct=args.eval_c_puct,
            opening_plies=args.opening_plies,
            max_plies=args.max_plies,
            seed=args.seed + 77_777,
            output=baseline_path,
        )
        _append_jsonl(evaluation_log, {
            "type": "baseline",
            "round": best_round,
            "gunuce": {key: value for key, value in baseline.items() if key != "results"},
        })

    previous_round = current_round
    first_stage = not _is_full_dual_checkpoint(latest)

    while current_round < args.target_rounds:
        stage_rounds = min(args.stage_rounds, args.target_rounds - current_round)
        print(
            f"\n===== GUNUCE SELF-IMPROVEMENT: "
            f"{current_round + 1}–{current_round + stage_rounds} "
            f"/ {args.target_rounds} ====="
        )
        command = _training_command(
            args,
            latest,
            stage_rounds,
            initialize_from_model=first_stage,
        )
        print("Training command:", " ".join(command))
        subprocess.run(command, check=True)
        first_stage = False

        current_round = _checkpoint_round(latest)
        expected_round = previous_round + stage_rounds
        if current_round != expected_round:
            raise RuntimeError(
                f"stage checkpoint mismatch: expected round {expected_round}, "
                f"got {current_round}"
            )

        candidate_snapshot = output_dir / f"round_{current_round:05d}_model.pt"
        if not candidate_snapshot.is_file():
            _write_model_checkpoint(latest, candidate_snapshot, current_round)

        print("\n===== QUICK EVALUATION: candidate vs best TEBA =====")
        quick_incumbent = evaluate_pair_match(
            candidate_snapshot,
            best_path,
            device,
            args.eval_games,
            args.eval_simulations,
            args.seed + current_round,
        )

        print("\n===== QUICK EVALUATION: candidate vs Gunuce =====")
        quick_gunuce = evaluate_match(
            candidate_snapshot,
            gunuce,
            device=args.eval_device,
            games=args.gunuce_eval_games,
            teba_simulations=args.eval_simulations,
            c_puct=args.eval_c_puct,
            opening_plies=args.opening_plies,
            max_plies=args.max_plies,
            seed=args.seed + current_round + 50_021,
            output=evaluation_dir / f"round_{current_round:05d}_quick_vs_gunuce.csv",
        )

        confirmation_incumbent = None
        confirmation_gunuce = None
        if _quick_pass(quick_incumbent, args.promotion_min_score):
            print("\n===== CONFIRMATION: candidate vs best TEBA =====")
            confirmation_incumbent = evaluate_pair_match(
                candidate_snapshot,
                best_path,
                device,
                args.confirm_games,
                args.eval_simulations,
                args.seed + current_round + 100_003,
            )

        if _quick_pass(quick_gunuce, args.promotion_min_score):
            print("\n===== CONFIRMATION: candidate vs Gunuce =====")
            confirmation_gunuce = evaluate_match(
                candidate_snapshot,
                gunuce,
                device=args.eval_device,
                games=args.gunuce_confirm_games,
                teba_simulations=args.eval_simulations,
                c_puct=args.eval_c_puct,
                opening_plies=args.opening_plies,
                max_plies=args.max_plies,
                seed=args.seed + current_round + 150_037,
                output=evaluation_dir / f"round_{current_round:05d}_confirmation_vs_gunuce.csv",
            )

        incumbent_pass = (
            confirmation_incumbent is not None
            and promotion_decision(
                confirmation_incumbent,
                min_score=args.promotion_min_score,
                ci_lower=args.promotion_ci_lower,
            )
        )
        gunuce_pass = (
            confirmation_gunuce is not None
            and _gunuce_promotion_decision(
                confirmation_gunuce,
                min_score=args.promotion_min_score,
                ci_lower=args.promotion_ci_lower,
            )
        )
        promoted = bool(incumbent_pass and gunuce_pass)

        if promoted:
            _write_model_checkpoint(candidate_snapshot, best_path, current_round)
            register_snapshot(
                best_path,
                league_dir,
                current_round,
                args.league_max_opponents,
            )
            best_round = current_round
            plateau_evaluations = 0
            print(
                f"PROMOTED: round {best_round} passed both gates. "
                f"Gunuce paired score={confirmation_gunuce['pair_score']:.3f}, "
                f"95% CI=[{confirmation_gunuce['pair_ci_low']:.3f}, "
                f"{confirmation_gunuce['pair_ci_high']:.3f}]"
            )
        else:
            plateau_evaluations += 1
            print(
                f"NOT PROMOTED: incumbent_pass={incumbent_pass}, "
                f"gunuce_pass={gunuce_pass}; best remains round {best_round}; "
                f"plateau={plateau_evaluations}/{args.early_stop_patience}"
            )

        _append_jsonl(evaluation_log, {
            "type": "stage",
            "round": current_round,
            "quick_vs_incumbent": quick_incumbent,
            "quick_vs_gunuce": {
                key: value for key, value in quick_gunuce.items()
                if key != "results"
            },
            "confirmation_vs_incumbent": confirmation_incumbent,
            "confirmation_vs_gunuce": (
                {
                    key: value for key, value in confirmation_gunuce.items()
                    if key != "results"
                }
                if confirmation_gunuce is not None else None
            ),
            "incumbent_pass": bool(incumbent_pass),
            "gunuce_pass": bool(gunuce_pass),
            "promoted": promoted,
            "best_round": best_round,
            "plateau_evaluations": plateau_evaluations,
        })

        _save_run_state(state_path, {
            "version": 2,
            "target_rounds": args.target_rounds,
            "current_round": current_round,
            "best_round": best_round,
            "plateau_evaluations": plateau_evaluations,
            "best_checkpoint": str(best_path),
            "gunuce_model_sha256": gunuce.model_sha256,
            "gunuce_model": str(gunuce.model_path),
        })

        if (
            current_round >= args.early_stop_min_round
            and plateau_evaluations >= args.early_stop_patience
        ):
            print(
                f"Early stopping at round {current_round}: "
                f"{plateau_evaluations} consecutive stages failed promotion."
            )
            break

        previous_round = current_round

    print(f"\nLong-run learner checkpoint: {latest}")
    print(f"Best promoted checkpoint: {best_path} (round {best_round})")
    print(f"Opponent league: {league_dir}")
    print(f"Gunuce evaluation history: {evaluation_log}")
    return latest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Large-scale TEBA self-improvement with Gunuce ONNX sparring "
            "and paired-opening promotion gates."
        )
    )
    parser.add_argument("--device", choices=("auto", "mps", "cpu", "cuda"), default="mps")
    parser.add_argument("--eval-device", choices=("auto", "mps", "cpu", "cuda"), default="mps")
    parser.add_argument(
        "--init-checkpoint",
        default="checkpoints_longrun/best.pt",
        help="model-only TEBA baseline; defaults to the Round-1060 champion snapshot",
    )
    parser.add_argument("--gunuce-model", default=None)
    parser.add_argument("--output-dir", default="checkpoints_gunuce_longrun")
    parser.add_argument("--target-rounds", type=int, default=31_060)
    parser.add_argument("--stage-rounds", type=int, default=500)
    parser.add_argument("--seed", type=int, default=2037)

    parser.add_argument("--self-play-games-per-round", type=int, default=8)
    parser.add_argument("--champion-games-per-round", type=int, default=8)
    parser.add_argument("--simulations", type=int, default=64)
    parser.add_argument("--updates-per-round", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--replay-capacity", type=int, default=50_000)
    parser.add_argument("--checkpoint-interval", type=int, default=10)
    parser.add_argument("--diagnostics-every", type=int, default=20)
    parser.add_argument("--snapshot-interval", type=int, default=500)

    parser.add_argument("--league-fraction", type=float, default=0.25)
    parser.add_argument("--league-max-opponents", type=int, default=8)
    parser.add_argument("--tactical-opponent-fraction", type=float, default=0.2)
    parser.add_argument("--gunuce-fraction", type=float, default=0.50)
    parser.add_argument("--gunuce-simulations", type=int, default=64)
    parser.add_argument("--gunuce-c-puct", type=float, default=1.5)
    parser.add_argument("--gunuce-fpu-reduction", type=float, default=0.2)
    parser.add_argument("--gunuce-threads", type=int, default=1)
    parser.add_argument("--d4-augmentation", action=argparse.BooleanOptionalAction, default=True)

    parser.add_argument("--eval-games", type=int, default=40)
    parser.add_argument("--confirm-games", type=int, default=100)
    parser.add_argument("--baseline-eval-games", type=int, default=40)
    parser.add_argument("--gunuce-eval-games", type=int, default=40)
    parser.add_argument("--gunuce-confirm-games", type=int, default=100)
    parser.add_argument("--eval-simulations", type=int, default=128)
    parser.add_argument("--eval-c-puct", type=float, default=1.25)
    parser.add_argument("--eval-gunuce-simulations", type=int, default=128)
    parser.add_argument("--promotion-min-score", type=float, default=0.55)
    parser.add_argument("--promotion-ci-lower", type=float, default=0.50)
    parser.add_argument("--early-stop-patience", type=int, default=12)
    parser.add_argument("--early-stop-min-round", type=int, default=10_000)

    parser.add_argument("--max-plies", type=int, default=225)
    parser.add_argument("--opening-plies", type=int, default=6)
    parser.add_argument("--temperature-moves", type=int, default=12)
    parser.add_argument("--candidate-radius", type=int, default=2)
    parser.add_argument("--c-puct", type=float, default=1.25)
    parser.add_argument("--dirichlet-alpha", type=float, default=0.3)
    parser.add_argument("--root-noise-fraction", type=float, default=0.25)
    parser.add_argument("--champion-width", type=int, default=14)
    parser.add_argument("--champion-time-ms", type=int, default=500)
    parser.add_argument("--champion-max-depth", type=int, default=10)

    parser.add_argument("--self-play-weight", type=float, default=0.50)
    parser.add_argument("--sparring-weight", type=float, default=0.50)
    parser.add_argument("--teacher-policy-weight", type=float, default=0.15)
    parser.add_argument("--tactical-weight", type=float, default=0.2)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--gradient-clip", type=float, default=1.0)
    parser.add_argument("--warmup-steps", type=int, default=200)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.target_rounds < 1 or args.stage_rounds < 1:
        raise SystemExit("target-rounds and stage-rounds must be positive")
    if args.updates_per_round < 1 or args.simulations < 1:
        raise SystemExit("updates-per-round and simulations must be positive")
    if args.checkpoint_interval < 1 or args.diagnostics_every < 1:
        raise SystemExit("checkpoint-interval and diagnostics-every must be positive")
    if args.gunuce_simulations < 1 or args.eval_gunuce_simulations < 1:
        raise SystemExit("Gunuce simulation budgets must be positive")
    if args.gunuce_fraction < 0 or args.league_fraction < 0:
        raise SystemExit("opponent fractions must be non-negative")
    if args.gunuce_fraction + args.league_fraction > 1:
        raise SystemExit("gunuce-fraction + league-fraction must not exceed 1")
    for name in ("eval_games", "confirm_games", "baseline_eval_games",
                 "gunuce_eval_games", "gunuce_confirm_games"):
        value = getattr(args, name)
        if value < 2 or value % 2:
            raise SystemExit(f"--{name.replace('_', '-')} must be an even integer >= 2")
    if args.promotion_min_score <= 0.5 or not 0 <= args.promotion_ci_lower < 1:
        raise SystemExit("invalid promotion thresholds")
    run_long_training(args)


if __name__ == "__main__":
    main()
