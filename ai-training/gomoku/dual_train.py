from __future__ import annotations

import argparse
import csv
import os
import random
import time
from pathlib import Path

import numpy as np
import torch

from .encoding import encode_state
from .game import BLACK, WHITE, GomokuGame
from .diagnostics import append_jsonl, make_ply_record
from .legacy_opponent import LegacyEngineOpponent
from .losses import compute_teba_loss, policy_cross_entropy
from .mcts import PUCTConfig, PUCTSearch, TorchEvaluator
from .network import build_model
from .tactical import analyze_tactical_evidence
from .train import (
    ReplayBuffer,
    _append_csv,
    _candidate_mask,
    _make_scheduler,
    _mean_metrics,
    play_self_play_game,
    resolve_device,
)

DUAL_CHECKPOINT_VERSION = 1
TACTICAL_WEIGHT = 0.2


def _sample(
    state: np.ndarray,
    policy: np.ndarray,
    value: float,
    tactical: np.ndarray,
    legal_mask: np.ndarray,
):
    return (
        np.asarray(state, dtype=np.float32).copy(),
        np.asarray(policy, dtype=np.float32).copy(),
        np.float32(value),
        np.asarray(tactical, dtype=np.float32).copy(),
        np.asarray(legal_mask, dtype=np.bool_).copy(),
    )


def play_champion_game(
    model: torch.nn.Module,
    device: torch.device,
    search_config: PUCTConfig,
    champion: LegacyEngineOpponent,
    learner_player: int,
    rng: np.random.Generator,
    temperature_moves: int = 12,
    max_plies: int = 225,
    game_record: dict[str, object] | None = None,
    game_id: str | None = None,
) -> tuple[list, list, int]:
    """
    Play the current TEBA model against the frozen V4.0 hard AI.

    Returns:
      learner_samples: learner-turn PUCT targets with terminal outcomes.
      teacher_samples: champion-turn one-hot targets, retained only when the
                       champion wins or draws (successful demonstrations).
      learner_outcome: +1 learner win, 0 draw, -1 learner loss.

    The V4.0 engine is not updated. It remains a fixed champion opponent.
    """
    if learner_player not in (BLACK, WHITE):
        raise ValueError("learner_player must be BLACK or WHITE")
    if max_plies < 1 or max_plies > 225:
        raise ValueError("max_plies must be in [1, 225]")

    game = GomokuGame()
    evaluator = TorchEvaluator(model, device=str(device))
    search = PUCTSearch(evaluator, search_config)
    pending_learner = []
    pending_teacher = []
    move_records: list[dict[str, object]] = []

    for ply in range(max_plies):
        player = game.current_player
        state = encode_state(
            game.board,
            current_player=player,
            last_move=game.last_move,
        )
        evidence = analyze_tactical_evidence(game.board, player)

        board_before = game.board.copy()
        last_move_before = game.last_move
        if player == learner_player:
            started = time.perf_counter()
            result = search.search(
                game,
                add_root_noise=True,
                seed=int(rng.integers(0, 2**32 - 1)),
            )
            search_ms = (time.perf_counter() - started) * 1000.0
            if result.best_move is None:
                break

            legal_mask = _candidate_mask(result.visit_counts.keys())
            pending_learner.append(
                (state, result.visit_policy.copy(), player, evidence.targets, legal_mask)
            )

            temperature = 1.0 if ply < temperature_moves else 0.1
            move = PUCTSearch.select_move(
                result,
                temperature=temperature,
                seed=int(rng.integers(0, 2**32 - 1)),
            )
            if move is None:
                break
            move_records.append(
                make_ply_record(
                    board_before,
                    ply,
                    player,
                    "TEBA_CHAMPION_SPAR",
                    move,
                    evidence,
                    search_ms,
                    last_move=last_move_before,
                    search_result=result,
                )
            )
        else:
            started = time.perf_counter()
            move, champion_diagnostics = champion.choose_move(game.board, player)
            search_ms = (time.perf_counter() - started) * 1000.0
            actions = game.get_candidates(radius=2)
            legal_mask = _candidate_mask(actions)
            if not legal_mask[move]:
                raise RuntimeError(
                    f"V4.0 champion selected a move outside the candidate set: {move}"
                )

            teacher_policy = np.zeros(225, dtype=np.float32)
            teacher_policy[move] = 1.0
            pending_teacher.append(
                (state, teacher_policy, player, evidence.targets, legal_mask)
            )
            move_records.append(
                make_ply_record(
                    board_before,
                    ply,
                    player,
                    "V4.0_CHAMPION",
                    move,
                    evidence,
                    search_ms,
                    last_move=last_move_before,
                    champion_diagnostics=champion_diagnostics,
                )
            )

        game.play(move)
        if game.done:
            break

    if not game.done:
        raise RuntimeError(
            "champion sparring game did not terminate; increase --max-plies"
        )

    learner_outcome = (
        0 if game.winner is None
        else 1 if game.winner == learner_player
        else -1
    )
    learner_samples = [
        _sample(state, policy, learner_outcome, tactical, legal_mask)
        for state, policy, _player, tactical, legal_mask in pending_learner
    ]

    # Do not distill a losing champion trajectory as if it were expert play.
    # Winning and drawn champion games are retained as low-weight demonstrations.
    champion_outcome = -learner_outcome
    teacher_samples = []
    if champion_outcome >= 0:
        teacher_samples = [
            _sample(state, policy, champion_outcome, tactical, legal_mask)
            for state, policy, _player, tactical, legal_mask in pending_teacher
        ]

    if game_record is not None:
        game_record.update({
            "game_id": game_id,
            "mode": "champion_sparring",
            "learner_player": "BLACK" if learner_player == BLACK else "WHITE",
            "outcome": int(learner_outcome),
            "winner": game.winner,
            "winner_name": (
                "DRAW" if game.winner is None
                else "BLACK" if game.winner == BLACK
                else "WHITE"
            ),
            "plies": game.move_count,
            "moves": move_records,
        })

    return learner_samples, teacher_samples, learner_outcome


def _to_tensors(batch: dict[str, np.ndarray], device: torch.device):
    return {
        "states": torch.as_tensor(batch["states"], dtype=torch.float32, device=device),
        "policies": torch.as_tensor(batch["policies"], dtype=torch.float32, device=device),
        "values": torch.as_tensor(batch["values"], dtype=torch.float32, device=device),
        "tactical": torch.as_tensor(batch["tactical"], dtype=torch.float32, device=device),
        "legal_masks": torch.as_tensor(batch["legal_masks"], dtype=torch.bool, device=device),
    }


def dual_train_step(
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    self_play_batch: dict[str, np.ndarray],
    sparring_batch: dict[str, np.ndarray],
    teacher_batch: dict[str, np.ndarray] | None,
    device: torch.device,
    self_play_weight: float = 0.6,
    sparring_weight: float = 0.4,
    teacher_policy_weight: float = 0.15,
    tactical_weight: float = TACTICAL_WEIGHT,
    gradient_clip: float = 1.0,
) -> dict[str, float]:
    """
    Joint update from three complementary data sources.

    Self-play and learner-vs-champion batches train policy, value and tactical
    heads. Successful V4.0 champion moves provide a low-weight policy-only
    imitation signal; the frozen opponent is never treated as infallible.
    """
    if self_play_weight < 0 or sparring_weight < 0:
        raise ValueError("self-play and sparring weights must be non-negative")
    weight_sum = self_play_weight + sparring_weight
    if weight_sum <= 0:
        raise ValueError("at least one RL channel weight must be positive")
    if teacher_policy_weight < 0:
        raise ValueError("teacher_policy_weight must be non-negative")

    self_play_weight /= weight_sum
    sparring_weight /= weight_sum
    model.train()
    optimizer.zero_grad(set_to_none=True)

    self_tensors = _to_tensors(self_play_batch, device)
    self_outputs = model(self_tensors["states"])
    self_losses = compute_teba_loss(
        self_outputs,
        self_tensors["policies"],
        self_tensors["values"],
        self_tensors["tactical"],
        legal_mask=self_tensors["legal_masks"],
        tactical_weight=tactical_weight,
    )

    spar_tensors = _to_tensors(sparring_batch, device)
    spar_outputs = model(spar_tensors["states"])
    spar_losses = compute_teba_loss(
        spar_outputs,
        spar_tensors["policies"],
        spar_tensors["values"],
        spar_tensors["tactical"],
        legal_mask=spar_tensors["legal_masks"],
        tactical_weight=tactical_weight,
    )

    zero = self_losses["loss"].new_zeros(())
    teacher_loss = zero
    if teacher_batch is not None and teacher_policy_weight > 0:
        teacher_tensors = _to_tensors(teacher_batch, device)
        teacher_outputs = model(teacher_tensors["states"])
        teacher_loss = policy_cross_entropy(
            teacher_outputs["policy_logits"],
            teacher_tensors["policies"],
            teacher_tensors["legal_masks"],
        )

    total_loss = (
        self_play_weight * self_losses["loss"]
        + sparring_weight * spar_losses["loss"]
        + teacher_policy_weight * teacher_loss
    )
    total_loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), gradient_clip)
    optimizer.step()

    policy_loss = (
        self_play_weight * self_losses["policy_loss"]
        + sparring_weight * spar_losses["policy_loss"]
    )
    value_loss = (
        self_play_weight * self_losses["value_loss"]
        + sparring_weight * spar_losses["value_loss"]
    )
    tactical_loss = (
        self_play_weight * self_losses["tactical_loss"]
        + sparring_weight * spar_losses["tactical_loss"]
    )

    return {
        "loss": float(total_loss.detach().cpu()),
        "policy_loss": float(policy_loss.detach().cpu()),
        "value_loss": float(value_loss.detach().cpu()),
        "tactical_loss": float(tactical_loss.detach().cpu()),
        "self_play_loss": float(self_losses["loss"].detach().cpu()),
        "sparring_loss": float(spar_losses["loss"].detach().cpu()),
        "teacher_policy_loss": float(teacher_loss.detach().cpu()),
    }


def save_dual_checkpoint(
    path: Path,
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    scheduler,
    self_play_replay: ReplayBuffer,
    sparring_replay: ReplayBuffer,
    teacher_replay: ReplayBuffer,
    round_index: int,
    global_step: int,
    rng: np.random.Generator,
    run_config: dict,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    payload = {
        "format_version": DUAL_CHECKPOINT_VERSION,
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "scheduler_state_dict": scheduler.state_dict(),
        "round_index": int(round_index),
        "global_step": int(global_step),
        "self_play_replay_samples": list(self_play_replay.samples),
        "sparring_replay_samples": list(sparring_replay.samples),
        "teacher_replay_samples": list(teacher_replay.samples),
        "numpy_rng_state": rng.bit_generator.state,
        "torch_rng_state": torch.get_rng_state(),
        "python_rng_state": random.getstate(),
        "run_config": run_config,
    }
    torch.save(payload, temporary)
    os.replace(temporary, path)


def load_dual_checkpoint(
    path: Path,
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    scheduler,
    self_play_replay: ReplayBuffer,
    sparring_replay: ReplayBuffer,
    teacher_replay: ReplayBuffer,
    device: torch.device,
    rng: np.random.Generator,
) -> tuple[int, int]:
    checkpoint = torch.load(path, map_location=device, weights_only=False)
    if checkpoint.get("format_version") != DUAL_CHECKPOINT_VERSION:
        raise ValueError("unsupported dual-learning checkpoint version")

    model.load_state_dict(checkpoint["model_state_dict"])
    optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
    scheduler.load_state_dict(checkpoint["scheduler_state_dict"])
    self_play_replay.samples.extend(checkpoint["self_play_replay_samples"])
    sparring_replay.samples.extend(checkpoint["sparring_replay_samples"])
    teacher_replay.samples.extend(checkpoint["teacher_replay_samples"])
    rng.bit_generator.state = checkpoint["numpy_rng_state"]
    torch.set_rng_state(checkpoint["torch_rng_state"].cpu())
    random.setstate(checkpoint["python_rng_state"])
    return int(checkpoint["round_index"]), int(checkpoint["global_step"])


def _load_initial_model(
    path: Path,
    model: torch.nn.Module,
    self_play_replay: ReplayBuffer,
    device: torch.device,
) -> None:
    checkpoint = torch.load(path, map_location=device, weights_only=False)
    if "model_state_dict" not in checkpoint:
        raise ValueError(f"checkpoint has no model_state_dict: {path}")
    model.load_state_dict(checkpoint["model_state_dict"])

    # Import the completed V4.1.4 self-play replay as the starting experience.
    existing = checkpoint.get(
        "self_play_replay_samples",
        checkpoint.get("replay_samples", []),
    )
    self_play_replay.add_many(existing)


def _append_dual_log(path: Path, row: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    exists = path.exists()
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(row))
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def run_training(args: argparse.Namespace) -> Path:
    device = resolve_device(args.device)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if not args.resume and (output_dir / "latest.pt").exists():
        raise FileExistsError(
            f"{output_dir / 'latest.pt'} already exists; use --resume or choose a new --output-dir"
        )

    random.seed(args.seed)
    rng = np.random.default_rng(args.seed)
    torch.manual_seed(args.seed)

    model = build_model().to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=args.learning_rate,
        weight_decay=args.weight_decay,
    )
    scheduler = _make_scheduler(
        optimizer,
        total_steps=max(1, args.rounds * args.updates_per_round),
        warmup_steps=args.warmup_steps,
    )

    self_play_replay = ReplayBuffer(args.replay_capacity)
    sparring_replay = ReplayBuffer(args.replay_capacity)
    teacher_replay = ReplayBuffer(args.replay_capacity)
    start_round = 0
    global_step = 0

    if args.resume:
        start_round, global_step = load_dual_checkpoint(
            Path(args.resume),
            model,
            optimizer,
            scheduler,
            self_play_replay,
            sparring_replay,
            teacher_replay,
            device,
            rng,
        )
        print(
            f"Resumed dual checkpoint: round={start_round}, "
            f"step={global_step}, self_play={len(self_play_replay)}, "
            f"sparring={len(sparring_replay)}, teacher={len(teacher_replay)}"
        )
    else:
        if not args.init_checkpoint:
            raise SystemExit("provide --init-checkpoint or --resume")
        _load_initial_model(
            Path(args.init_checkpoint),
            model,
            self_play_replay,
            device,
        )
        print(f"Initialized from: {args.init_checkpoint}")
        print(f"Imported self-play positions: {len(self_play_replay)}")

    run_config = vars(args).copy()
    run_config["device_resolved"] = str(device)
    run_config["model"] = "TEBA-Net-S"
    run_config["parameter_count"] = model.trainable_parameter_count
    run_config["champion"] = "V4.0 hard / iterative-deepening alpha-beta"
    run_config["champion_source"] = "v4.0/src/engine.js"

    search_config = PUCTConfig(
        simulations=args.simulations,
        c_puct=args.c_puct,
        candidate_radius=args.candidate_radius,
        dirichlet_alpha=args.dirichlet_alpha,
        root_noise_fraction=args.root_noise_fraction,
    )

    log_path = output_dir / "dual_training.csv"
    training_games_path = output_dir / "training_games.jsonl"
    with LegacyEngineOpponent(
        node_executable=args.node_executable,
        level="hard",
        width=args.champion_width,
        time_ms=args.champion_time_ms,
        max_depth=args.champion_max_depth,
    ) as champion:
        for round_index in range(start_round + 1, args.rounds + 1):
            started = time.perf_counter()
            model.eval()
            self_play_positions = 0
            sparring_positions = 0
            teacher_positions = 0
            learner_wins = 0
            champion_wins = 0
            draws = 0

            for game_index in range(args.self_play_games_per_round):
                game_record: dict[str, object] = {}
                samples = play_self_play_game(
                    model,
                    device,
                    search_config,
                    rng,
                    temperature_moves=args.temperature_moves,
                    max_plies=args.max_plies,
                    game_record=game_record,
                    game_id=f"round-{round_index:04d}-selfplay-{game_index + 1:03d}",
                )
                append_jsonl(training_games_path, game_record)
                self_play_replay.add_many(samples)
                self_play_positions += len(samples)
                print(
                    f"Round {round_index}/{args.rounds} | "
                    f"self-play {game_index + 1}/{args.self_play_games_per_round} | "
                    f"positions={len(samples)}"
                )

            for game_index in range(args.champion_games_per_round):
                global_game_index = (
                    (round_index - 1) * args.champion_games_per_round + game_index
                )
                learner_player = BLACK if global_game_index % 2 == 0 else WHITE
                game_record = {}
                learner_samples, teacher_samples, outcome = play_champion_game(
                    model,
                    device,
                    search_config,
                    champion,
                    learner_player,
                    rng,
                    temperature_moves=args.temperature_moves,
                    max_plies=args.max_plies,
                    game_record=game_record,
                    game_id=f"round-{round_index:04d}-champion-{game_index + 1:03d}",
                )
                append_jsonl(training_games_path, game_record)
                sparring_replay.add_many(learner_samples)
                teacher_replay.add_many(teacher_samples)
                sparring_positions += len(learner_samples)
                teacher_positions += len(teacher_samples)

                if outcome > 0:
                    learner_wins += 1
                elif outcome < 0:
                    champion_wins += 1
                else:
                    draws += 1

                print(
                    f"Round {round_index}/{args.rounds} | "
                    f"champion game {game_index + 1}/{args.champion_games_per_round} | "
                    f"learner={'BLACK' if learner_player == BLACK else 'WHITE'} | "
                    f"outcome={outcome:+d} | learner_positions={len(learner_samples)} | "
                    f"teacher_positions={len(teacher_samples)}"
                )

            if not self_play_replay or not sparring_replay:
                raise RuntimeError("both self-play and champion-sparring buffers must be non-empty")

            update_metrics = []
            half_batch = max(1, args.batch_size // 2)
            for _ in range(args.updates_per_round):
                self_batch = self_play_replay.sample(half_batch, rng)
                sparring_batch = sparring_replay.sample(half_batch, rng)
                teacher_batch = (
                    teacher_replay.sample(half_batch, rng)
                    if len(teacher_replay) > 0
                    else None
                )
                update_metrics.append(
                    dual_train_step(
                        model,
                        optimizer,
                        self_batch,
                        sparring_batch,
                        teacher_batch,
                        device,
                        self_play_weight=args.self_play_weight,
                        sparring_weight=args.sparring_weight,
                        teacher_policy_weight=args.teacher_policy_weight,
                        tactical_weight=args.tactical_weight,
                        gradient_clip=args.gradient_clip,
                    )
                )
                scheduler.step()
                global_step += 1

            means = {
                key: float(np.mean([item[key] for item in update_metrics]))
                for key in (
                    "loss",
                    "policy_loss",
                    "value_loss",
                    "tactical_loss",
                    "self_play_loss",
                    "sparring_loss",
                    "teacher_policy_loss",
                )
            } if update_metrics else {
                key: 0.0 for key in (
                    "loss",
                    "policy_loss",
                    "value_loss",
                    "tactical_loss",
                    "self_play_loss",
                    "sparring_loss",
                    "teacher_policy_loss",
                )
            }
            elapsed = time.perf_counter() - started

            row = {
                "round": round_index,
                "self_play_games": args.self_play_games_per_round,
                "champion_games": args.champion_games_per_round,
                "learner_wins": learner_wins,
                "champion_wins": champion_wins,
                "draws": draws,
                "self_play_positions_added": self_play_positions,
                "sparring_positions_added": sparring_positions,
                "teacher_positions_added": teacher_positions,
                "self_play_replay_size": len(self_play_replay),
                "sparring_replay_size": len(sparring_replay),
                "teacher_replay_size": len(teacher_replay),
                "loss": means["loss"],
                "policy_loss": means["policy_loss"],
                "value_loss": means["value_loss"],
                "tactical_loss": means["tactical_loss"],
                "self_play_loss": means["self_play_loss"],
                "sparring_loss": means["sparring_loss"],
                "teacher_policy_loss": means["teacher_policy_loss"],
                "learning_rate": optimizer.param_groups[0]["lr"],
                "elapsed_seconds": round(elapsed, 2),
            }
            _append_dual_log(log_path, row)

            print(
                f"Round {round_index} complete | "
                f"self-play={self_play_positions} | sparring={sparring_positions} | "
                f"teacher={teacher_positions} | "
                f"record={learner_wins}W/{draws}D/{champion_wins}L | "
                f"loss={means['loss']:.4f} | "
                f"value={means['value_loss']:.4f} | "
                f"time={elapsed / 60:.1f} min"
            )

            save_dual_checkpoint(
                output_dir / "latest.pt",
                model,
                optimizer,
                scheduler,
                self_play_replay,
                sparring_replay,
                teacher_replay,
                round_index,
                global_step,
                rng,
                run_config,
            )
            torch.save(
                {
                    "format_version": DUAL_CHECKPOINT_VERSION,
                    "round_index": round_index,
                    "global_step": global_step,
                    "model_state_dict": model.state_dict(),
                    "run_config": run_config,
                },
                output_dir / f"round_{round_index:04d}_model.pt",
            )

    print(f"Dual-learning checkpoint: {output_dir / 'latest.pt'}")
    print(f"Dual-learning log: {log_path}")
    print(f"Training game diagnostics: {training_games_path}")
    return output_dir / "latest.pt"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Dual-channel TEBA learning: self-play plus V4.0 champion sparring."
    )
    parser.add_argument("--device", choices=("auto", "mps", "cpu", "cuda"), default="auto")
    parser.add_argument("--node-executable", default="node")
    parser.add_argument("--seed", type=int, default=2027)
    parser.add_argument("--init-checkpoint", default="checkpoints/latest.pt")
    parser.add_argument("--resume", default=None)
    parser.add_argument("--output-dir", default="checkpoints_dual")

    parser.add_argument("--rounds", type=int, default=30)
    parser.add_argument("--self-play-games-per-round", type=int, default=8)
    parser.add_argument("--champion-games-per-round", type=int, default=8)
    parser.add_argument("--simulations", type=int, default=64)
    parser.add_argument("--updates-per-round", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--replay-capacity", type=int, default=50_000)

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
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--gradient-clip", type=float, default=1.0)
    parser.add_argument("--warmup-steps", type=int, default=100)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.rounds < 1 or args.updates_per_round < 1:
        raise SystemExit("rounds and updates-per-round must be positive")
    if args.self_play_games_per_round < 1 or args.champion_games_per_round < 1:
        raise SystemExit("both game counts per round must be positive")
    if args.simulations < 1 or args.batch_size < 2:
        raise SystemExit("simulations must be positive and batch-size at least 2")
    if args.champion_width < 1 or args.champion_time_ms < 0 or args.champion_max_depth < 1:
        raise SystemExit("invalid champion search budget")
    run_training(args)


if __name__ == "__main__":
    main()
