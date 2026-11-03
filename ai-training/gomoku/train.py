from __future__ import annotations

import argparse
import csv
import math
import os
import random
import time
from collections import deque
from pathlib import Path
from typing import Iterable

import numpy as np
import torch

from .encoding import encode_state
from .game import BLACK, WHITE, GomokuGame, spot
from .losses import (
    balanced_tactical_bce,
    compute_teba_loss,
    policy_cross_entropy,
)
from .mcts import PUCTConfig, PUCTSearch, TorchEvaluator
from .network import build_model
from .tactical import analyze_tactical_evidence


TACTICAL_WEIGHT = 0.2
CHECKPOINT_VERSION = 1


def resolve_device(requested: str) -> torch.device:
    if requested == "auto":
        if torch.backends.mps.is_available():
            return torch.device("mps")
        if torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")

    device = torch.device(requested)
    if device.type == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was requested but is not available")
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is not available")
    return device


def _candidate_mask(actions: Iterable[int]) -> np.ndarray:
    mask = np.zeros(225, dtype=np.bool_)
    indices = np.asarray(list(actions), dtype=np.int64)
    if indices.size:
        mask[indices] = True
    return mask


def _make_sample(
    game: GomokuGame,
    policy: np.ndarray,
    value: float,
    tactical: np.ndarray,
    legal_mask: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.float32, np.ndarray, np.ndarray]:
    return (
        encode_state(
            game.board,
            current_player=game.current_player,
            last_move=game.last_move,
        ),
        np.asarray(policy, dtype=np.float32).copy(),
        np.float32(value),
        np.asarray(tactical, dtype=np.float32).copy(),
        np.asarray(legal_mask, dtype=np.bool_).copy(),
    )


def _synthetic_tactical_sample(
    kind: str,
    rng: np.random.Generator,
) -> tuple[np.ndarray, np.ndarray, np.float32, np.ndarray, np.ndarray]:
    """
    Build a controlled tactical board pattern and verify its label with the
    same rule analyzer used by search. No hand-authored label is trusted.
    """
    game = GomokuGame()
    player = int(rng.choice((BLACK, WHITE)))
    opponent = WHITE if player == BLACK else BLACK
    board = game.board.copy()

    if kind == "win":
        directions = ((0, 1), (1, 0), (1, 1), (1, -1))
        dr, dc = directions[int(rng.integers(0, len(directions)))]
        if rng.random() < 0.5:
            dr, dc = -dr, -dc
        row = int(rng.integers(3, 12))
        col = int(rng.integers(3, 12))
        stones = [
            spot(row + offset * dr, col + offset * dc)
            for offset in range(4)
        ]
        stone_player = player

    elif kind == "block":
        directions = (
            (0, 1), (0, -1), (1, 0), (-1, 0),
            (1, 1), (-1, -1), (1, -1), (-1, 1),
        )
        dr, dc = directions[int(rng.integers(0, len(directions)))]

        if dr == 0:
            row = int(rng.integers(0, 15))
            col = 0 if dc > 0 else 14
        elif dc == 0:
            row = 0 if dr > 0 else 14
            col = int(rng.integers(0, 15))
        elif dr > 0 and dc > 0:
            row, col = 0, 0
        elif dr > 0 and dc < 0:
            row, col = 0, 14
        elif dr < 0 and dc > 0:
            row, col = 14, 0
        else:
            row, col = 14, 14

        stones = [
            spot(row + offset * dr, col + offset * dc)
            for offset in range(4)
        ]
        stone_player = opponent

    elif kind == "fork":
        row = int(rng.integers(3, 12))
        col = int(rng.integers(3, 12))
        horizontal_sign = int(rng.choice((-1, 1)))
        vertical_sign = int(rng.choice((-1, 1)))
        coordinates = (
            (row, col - horizontal_sign),
            (row, col + horizontal_sign),
            (row, col + 2 * horizontal_sign),
            (row - vertical_sign, col),
            (row + vertical_sign, col),
            (row + 2 * vertical_sign, col),
        )
        stones = [spot(r, c) for r, c in coordinates]
        stone_player = player

    else:
        raise ValueError(f"unknown tactical sample kind: {kind}")

    board[np.asarray(stones, dtype=np.int64)] = stone_player
    game.board = board
    game.current_player = player
    game.last_move = stones[-1]
    game.move_count = len(stones)

    evidence = analyze_tactical_evidence(game.board, game.current_player)

    if kind == "win":
        teacher_moves = list(evidence.win_now_moves)
    elif kind == "block":
        teacher_moves = (
            list(evidence.must_block_moves)
            if not evidence.forced_loss
            else []
        )
    else:
        teacher_moves = list(evidence.fork_moves)

    if not teacher_moves:
        raise RuntimeError(
            f"synthetic {kind} pattern did not produce the expected "
            "rule-derived tactical evidence"
        )

    policy = np.zeros(225, dtype=np.float32)
    policy[teacher_moves] = 1.0 / len(teacher_moves)
    legal_mask = _candidate_mask(game.get_candidates(radius=2))

    return _make_sample(
        game,
        policy,
        0.0,
        evidence.targets,
        legal_mask,
    )


def generate_bootstrap_data(
    max_positions: int = 1200,
    seed: int = 2026,
) -> list[tuple[np.ndarray, np.ndarray, np.float32, np.ndarray, np.ndarray]]:
    """
    Generate balanced, rule-verified tactical pretraining examples.

    Synthetic WIN_NOW, MUST_BLOCK and FORK board patterns are randomized by
    color, location and orientation. Every target is re-derived by
    analyze_tactical_evidence; the generator never writes target labels
    directly. This data initializes the policy and tactical heads only.
    The value head is deliberately not trained from synthetic positions.

    These are controlled tactical examples, not human games or expert play.
    """
    if (
        isinstance(max_positions, bool)
        or not isinstance(max_positions, int)
        or max_positions < 1
    ):
        raise ValueError("max_positions must be a positive integer")

    rng = np.random.default_rng(seed)
    kinds = ("win", "block", "fork")
    samples = [
        _synthetic_tactical_sample(kinds[index % len(kinds)], rng)
        for index in range(max_positions)
    ]
    return samples


class ReplayBuffer:
    """Bounded FIFO replay buffer for self-play training positions."""

    def __init__(self, capacity: int = 50_000) -> None:
        if capacity < 1:
            raise ValueError("capacity must be positive")
        self.capacity = int(capacity)
        self.samples = deque(maxlen=self.capacity)

    def __len__(self) -> int:
        return len(self.samples)

    def add_many(self, samples) -> None:
        self.samples.extend(samples)

    def sample(self, batch_size: int, rng: np.random.Generator) -> dict[str, np.ndarray]:
        if not self.samples:
            raise RuntimeError("cannot sample from an empty replay buffer")
        if batch_size < 1:
            raise ValueError("batch_size must be positive")

        indices = rng.integers(0, len(self.samples), size=batch_size)
        selected = [self.samples[int(index)] for index in indices]

        return {
            "states": np.stack([item[0] for item in selected]).astype(
                np.float32, copy=False
            ),
            "policies": np.stack([item[1] for item in selected]).astype(
                np.float32, copy=False
            ),
            "values": np.asarray([item[2] for item in selected], dtype=np.float32),
            "tactical": np.stack([item[3] for item in selected]).astype(
                np.float32, copy=False
            ),
            "legal_masks": np.stack([item[4] for item in selected]).astype(
                np.bool_, copy=False
            ),
        }


def pretrain_step(
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    batch: dict[str, np.ndarray],
    device: torch.device,
    gradient_clip: float = 1.0,
    tactical_weight: float = TACTICAL_WEIGHT,
) -> dict[str, float]:
    """Update policy and tactical heads using rule-grounded bootstrap data."""
    model.train()
    states = torch.as_tensor(batch["states"], dtype=torch.float32, device=device)
    policies = torch.as_tensor(batch["policies"], dtype=torch.float32, device=device)
    tactical = torch.as_tensor(batch["tactical"], dtype=torch.float32, device=device)
    legal_masks = torch.as_tensor(batch["legal_masks"], dtype=torch.bool, device=device)

    optimizer.zero_grad(set_to_none=True)
    outputs = model(states)
    policy_loss = policy_cross_entropy(
        outputs["policy_logits"],
        policies,
        legal_masks,
    )
    tactical_loss = balanced_tactical_bce(
        outputs["tactical_logits"],
        tactical,
    )
    loss = policy_loss + tactical_weight * tactical_loss
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), gradient_clip)
    optimizer.step()

    return {
        "loss": float(loss.detach().cpu()),
        "policy_loss": float(policy_loss.detach().cpu()),
        "value_loss": 0.0,
        "tactical_loss": float(tactical_loss.detach().cpu()),
    }


def train_step(
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    batch: dict[str, np.ndarray],
    device: torch.device,
    gradient_clip: float = 1.0,
    tactical_weight: float = TACTICAL_WEIGHT,
) -> dict[str, float]:
    """One complete multi-task update from self-play replay data."""
    model.train()
    states = torch.as_tensor(batch["states"], dtype=torch.float32, device=device)
    policies = torch.as_tensor(batch["policies"], dtype=torch.float32, device=device)
    values = torch.as_tensor(batch["values"], dtype=torch.float32, device=device)
    tactical = torch.as_tensor(batch["tactical"], dtype=torch.float32, device=device)
    legal_masks = torch.as_tensor(batch["legal_masks"], dtype=torch.bool, device=device)

    optimizer.zero_grad(set_to_none=True)
    outputs = model(states)
    losses = compute_teba_loss(
        outputs,
        policies,
        values,
        tactical,
        legal_mask=legal_masks,
        tactical_weight=tactical_weight,
    )
    losses["loss"].backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), gradient_clip)
    optimizer.step()

    return {
        name: float(value.detach().cpu())
        for name, value in losses.items()
    }


def play_self_play_game(
    model: torch.nn.Module,
    device: torch.device,
    search_config: PUCTConfig,
    rng: np.random.Generator,
    temperature_moves: int = 12,
    max_plies: int = 225,
) -> list[tuple[np.ndarray, np.ndarray, np.float32, np.ndarray, np.ndarray]]:
    """
    Play one complete self-play game and label every position by its final
    outcome from the player-to-move perspective.
    """
    if max_plies < 1 or max_plies > 225:
        raise ValueError("max_plies must be in [1, 225]")

    game = GomokuGame()
    evaluator = TorchEvaluator(model, device=str(device))
    search = PUCTSearch(evaluator, search_config)
    pending = []

    for ply in range(max_plies):
        player = game.current_player
        state = encode_state(
            game.board,
            current_player=player,
            last_move=game.last_move,
        )
        evidence = analyze_tactical_evidence(game.board, player)

        result = search.search(
            game,
            add_root_noise=True,
            seed=int(rng.integers(0, 2**32 - 1)),
        )
        if result.best_move is None:
            break

        legal_mask = _candidate_mask(result.visit_counts.keys())
        policy = result.visit_policy.copy()
        pending.append((state, policy, player, evidence.targets, legal_mask))

        temperature = 1.0 if ply < temperature_moves else 0.1
        move = PUCTSearch.select_move(
            result,
            temperature=temperature,
            seed=int(rng.integers(0, 2**32 - 1)),
        )
        if move is None:
            break

        game.play(move)
        if game.done:
            break

    if not game.done:
        raise RuntimeError(
            "self-play game did not terminate; increase --max-plies to 225"
        )

    completed = []

    for state, policy, player, tactical, legal_mask in pending:
        value = 0.0 if game.winner is None else (
            1.0 if player == game.winner else -1.0
        )
        completed.append(
            (
                state,
                policy,
                np.float32(value),
                tactical.astype(np.float32, copy=True),
                legal_mask.astype(np.bool_, copy=True),
            )
        )

    return completed


def _make_scheduler(
    optimizer: torch.optim.Optimizer,
    total_steps: int,
    warmup_steps: int,
    minimum_lr_ratio: float = 0.1,
):
    total_steps = max(1, int(total_steps))
    warmup_steps = max(0, min(int(warmup_steps), total_steps - 1))

    def schedule(step: int) -> float:
        if warmup_steps and step < warmup_steps:
            return max(1e-8, (step + 1) / warmup_steps)

        decay_steps = max(1, total_steps - warmup_steps)
        progress = min(1.0, max(0.0, (step - warmup_steps) / decay_steps))
        cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
        return minimum_lr_ratio + (1.0 - minimum_lr_ratio) * cosine

    return torch.optim.lr_scheduler.LambdaLR(optimizer, schedule)


def save_checkpoint(
    path: Path,
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    scheduler,
    replay: ReplayBuffer,
    round_index: int,
    global_step: int,
    rng: np.random.Generator,
    run_config: dict,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")

    payload = {
        "format_version": CHECKPOINT_VERSION,
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "scheduler_state_dict": scheduler.state_dict(),
        "round_index": int(round_index),
        "global_step": int(global_step),
        "replay_samples": list(replay.samples),
        "numpy_rng_state": rng.bit_generator.state,
        "torch_rng_state": torch.get_rng_state(),
        "python_rng_state": random.getstate(),
        "run_config": run_config,
    }

    torch.save(payload, temporary)
    os.replace(temporary, path)


def load_checkpoint(
    path: Path,
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    scheduler,
    replay: ReplayBuffer,
    device: torch.device,
    rng: np.random.Generator,
) -> tuple[int, int]:
    checkpoint = torch.load(
        path,
        map_location=device,
        weights_only=False,
    )
    if checkpoint.get("format_version") != CHECKPOINT_VERSION:
        raise ValueError("unsupported checkpoint format version")

    model.load_state_dict(checkpoint["model_state_dict"])
    optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
    scheduler.load_state_dict(checkpoint["scheduler_state_dict"])
    replay.samples.extend(checkpoint.get("replay_samples", []))
    rng.bit_generator.state = checkpoint["numpy_rng_state"]
    torch.set_rng_state(checkpoint["torch_rng_state"].cpu())
    random.setstate(checkpoint["python_rng_state"])

    return int(checkpoint["round_index"]), int(checkpoint["global_step"])


def _append_csv(path: Path, row: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    exists = path.exists()
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(row))
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def _mean_metrics(metrics: list[dict[str, float]]) -> dict[str, float]:
    if not metrics:
        return {"loss": 0.0, "policy_loss": 0.0, "value_loss": 0.0, "tactical_loss": 0.0}
    return {
        key: float(np.mean([item[key] for item in metrics]))
        for key in ("loss", "policy_loss", "value_loss", "tactical_loss")
    }


def run_training(args: argparse.Namespace) -> Path:
    device = resolve_device(args.device)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    random.seed(args.seed)
    np_rng = np.random.default_rng(args.seed)
    torch.manual_seed(args.seed)

    model = build_model().to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=args.learning_rate,
        weight_decay=args.weight_decay,
    )

    planned_steps = args.bootstrap_updates + args.rounds * args.updates_per_round
    scheduler = _make_scheduler(
        optimizer,
        total_steps=planned_steps,
        warmup_steps=args.warmup_steps,
    )
    replay = ReplayBuffer(args.replay_capacity)
    start_round = 0
    global_step = 0

    run_config = vars(args).copy()
    run_config["device_resolved"] = str(device)
    run_config["model"] = "TEBA-Net-S"
    run_config["parameter_count"] = model.trainable_parameter_count

    if args.resume:
        start_round, global_step = load_checkpoint(
            Path(args.resume),
            model,
            optimizer,
            scheduler,
            replay,
            device,
            np_rng,
        )
        print(
            f"Resumed checkpoint at round={start_round}, "
            f"step={global_step}, replay={len(replay)}"
        )
    else:
        print(f"Device: {device}")
        print(f"TEBA-Net-S parameters: {model.trainable_parameter_count:,}")
        print("Generating rule-grounded tactical bootstrap data...")

        bootstrap = generate_bootstrap_data(
            max_positions=args.bootstrap_positions,
            seed=args.seed,
        )
        print(f"Bootstrap positions: {len(bootstrap):,}")

        bootstrap_metrics = []
        for _ in range(args.bootstrap_updates):
            indices = np_rng.integers(0, len(bootstrap), size=args.batch_size)
            selected = [bootstrap[int(index)] for index in indices]
            batch = {
                "states": np.stack([item[0] for item in selected]),
                "policies": np.stack([item[1] for item in selected]),
                "values": np.asarray([item[2] for item in selected], dtype=np.float32),
                "tactical": np.stack([item[3] for item in selected]),
                "legal_masks": np.stack([item[4] for item in selected]),
            }
            bootstrap_metrics.append(
                pretrain_step(
                    model,
                    optimizer,
                    batch,
                    device,
                    gradient_clip=args.gradient_clip,
                    tactical_weight=args.tactical_weight,
                )
            )
            scheduler.step()
            global_step += 1

        warmup = _mean_metrics(bootstrap_metrics)
        _append_csv(
            output_dir / "training.csv",
            {
                "phase": "bootstrap",
                "round": 0,
                "games": 0,
                "positions_added": len(bootstrap),
                "replay_size": 0,
                "loss": warmup["loss"],
                "policy_loss": warmup["policy_loss"],
                "value_loss": warmup["value_loss"],
                "tactical_loss": warmup["tactical_loss"],
                "learning_rate": optimizer.param_groups[0]["lr"],
                "elapsed_seconds": 0.0,
            },
        )
        print(
            "Bootstrap complete: "
            f"loss={warmup['loss']:.4f}, "
            f"policy={warmup['policy_loss']:.4f}, "
            f"tactical={warmup['tactical_loss']:.4f}"
        )
        save_checkpoint(
            output_dir / "latest.pt",
            model,
            optimizer,
            scheduler,
            replay,
            0,
            global_step,
            np_rng,
            run_config,
        )

    search_config = PUCTConfig(
        simulations=args.simulations,
        c_puct=args.c_puct,
        candidate_radius=args.candidate_radius,
        dirichlet_alpha=args.dirichlet_alpha,
        root_noise_fraction=args.root_noise_fraction,
    )

    for round_index in range(start_round + 1, args.rounds + 1):
        started = time.perf_counter()
        model.eval()
        generated = []

        for game_index in range(args.games_per_round):
            game_samples = play_self_play_game(
                model,
                device,
                search_config,
                np_rng,
                temperature_moves=args.temperature_moves,
                max_plies=args.max_plies,
            )
            generated.extend(game_samples)
            print(
                f"Round {round_index}/{args.rounds} | "
                f"self-play {game_index + 1}/{args.games_per_round} | "
                f"positions={len(game_samples)}"
            )

        replay.add_many(generated)
        if len(replay) < 1:
            raise RuntimeError("self-play produced an empty replay buffer")

        update_metrics = []
        for _ in range(args.updates_per_round):
            batch = replay.sample(args.batch_size, np_rng)
            update_metrics.append(
                train_step(
                    model,
                    optimizer,
                    batch,
                    device,
                    gradient_clip=args.gradient_clip,
                    tactical_weight=args.tactical_weight,
                )
            )
            scheduler.step()
            global_step += 1

        means = _mean_metrics(update_metrics)
        elapsed = time.perf_counter() - started
        row = {
            "phase": "self_play",
            "round": round_index,
            "games": args.games_per_round,
            "positions_added": len(generated),
            "replay_size": len(replay),
            "loss": means["loss"],
            "policy_loss": means["policy_loss"],
            "value_loss": means["value_loss"],
            "tactical_loss": means["tactical_loss"],
            "learning_rate": optimizer.param_groups[0]["lr"],
            "elapsed_seconds": round(elapsed, 2),
        }
        _append_csv(output_dir / "training.csv", row)

        print(
            f"Round {round_index} complete | "
            f"positions={len(generated)} | replay={len(replay)} | "
            f"loss={means['loss']:.4f} | "
            f"policy={means['policy_loss']:.4f} | "
            f"value={means['value_loss']:.4f} | "
            f"tactical={means['tactical_loss']:.4f} | "
            f"time={elapsed / 60:.1f} min"
        )

        save_checkpoint(
            output_dir / "latest.pt",
            model,
            optimizer,
            scheduler,
            replay,
            round_index,
            global_step,
            np_rng,
            run_config,
        )
        torch.save(
            {
                "format_version": CHECKPOINT_VERSION,
                "round_index": round_index,
                "global_step": global_step,
                "model_state_dict": model.state_dict(),
                "run_config": run_config,
            },
            output_dir / f"round_{round_index:04d}_model.pt",
        )

    print(f"Training finished. Latest checkpoint: {output_dir / 'latest.pt'}")
    print(f"Training log: {output_dir / 'training.csv'}")
    return output_dir / "latest.pt"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Train TEBA-Net-S with tactical bootstrap and PUCT self-play."
    )
    parser.add_argument("--device", choices=("auto", "mps", "cpu", "cuda"), default="auto")
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--output-dir", default="checkpoints")
    parser.add_argument("--resume", default=None, help="Path to a latest.pt checkpoint")

    parser.add_argument("--bootstrap-positions", type=int, default=1200)
    parser.add_argument("--bootstrap-updates", type=int, default=100)

    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--games-per-round", type=int, default=4)
    parser.add_argument("--simulations", type=int, default=16)
    parser.add_argument("--updates-per-round", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--replay-capacity", type=int, default=50_000)

    parser.add_argument("--max-plies", type=int, default=225)
    parser.add_argument("--temperature-moves", type=int, default=12)
    parser.add_argument("--candidate-radius", type=int, default=2)
    parser.add_argument("--c-puct", type=float, default=1.25)
    parser.add_argument("--dirichlet-alpha", type=float, default=0.3)
    parser.add_argument("--root-noise-fraction", type=float, default=0.25)

    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--gradient-clip", type=float, default=1.0)
    parser.add_argument("--tactical-weight", type=float, default=0.2)
    parser.add_argument("--warmup-steps", type=int, default=20)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.rounds < 0 or args.bootstrap_updates < 0 or args.updates_per_round < 0:
        raise SystemExit("rounds and update counts must be non-negative")
    if args.games_per_round < 1 or args.simulations < 1 or args.batch_size < 1:
        raise SystemExit("games-per-round, simulations, and batch-size must be positive")
    run_training(args)


if __name__ == "__main__":
    main()
