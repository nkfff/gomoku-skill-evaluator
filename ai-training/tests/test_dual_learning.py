from __future__ import annotations

import shutil
from types import SimpleNamespace

import numpy as np
import pytest
import torch

from gomoku.game import BLACK, spot
from gomoku.legacy_opponent import LegacyEngineOpponent
from gomoku.network import build_model
from gomoku.train import ReplayBuffer, _make_scheduler
from gomoku.dual_train import (
    _build_dual_scheduler,
    dual_train_step,
    load_dual_checkpoint,
    save_dual_checkpoint,
)


def _batch(batch_size: int = 4):
    states = np.zeros((batch_size, 3, 15, 15), dtype=np.float32)
    policies = np.zeros((batch_size, 225), dtype=np.float32)
    masks = np.zeros((batch_size, 225), dtype=np.bool_)
    for index in range(batch_size):
        action = spot(7, 7) + index
        policies[index, action] = 1.0
        masks[index, action] = True

    return {
        "states": states,
        "policies": policies,
        "values": np.asarray([1, -1, 1, -1][:batch_size], dtype=np.float32),
        "tactical": np.zeros((batch_size, 3, 15, 15), dtype=np.float32),
        "legal_masks": masks,
    }


def _replay_from_batch(batch):
    replay = ReplayBuffer(capacity=32)
    replay.add_many([
        (
            batch["states"][index],
            batch["policies"][index],
            batch["values"][index],
            batch["tactical"][index],
            batch["legal_masks"][index],
        )
        for index in range(len(batch["values"]))
    ])
    return replay


def test_dual_train_step_updates_all_channels_and_returns_finite_losses():
    model = build_model()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)

    metrics = dual_train_step(
        model,
        optimizer,
        _batch(),
        _batch(),
        _batch(),
        torch.device("cpu"),
    )

    assert {
        "loss",
        "policy_loss",
        "value_loss",
        "tactical_loss",
        "self_play_loss",
        "sparring_loss",
        "teacher_policy_loss",
    } == set(metrics)
    assert all(np.isfinite(value) for value in metrics.values())
    assert metrics["teacher_policy_loss"] >= 0


def test_dual_train_step_supports_no_successful_teacher_demonstrations():
    model = build_model()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)

    metrics = dual_train_step(
        model,
        optimizer,
        _batch(),
        _batch(),
        None,
        torch.device("cpu"),
    )

    assert all(np.isfinite(value) for value in metrics.values())
    assert metrics["teacher_policy_loss"] == 0.0


def test_dual_checkpoint_round_trip_restores_all_replay_buffers(tmp_path):
    model = build_model()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
    scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=1)
    self_play = _replay_from_batch(_batch())
    sparring = _replay_from_batch(_batch())
    teacher = _replay_from_batch(_batch())
    rng = np.random.default_rng(123)

    checkpoint_path = tmp_path / "dual_latest.pt"
    save_dual_checkpoint(
        checkpoint_path,
        model,
        optimizer,
        scheduler,
        self_play,
        sparring,
        teacher,
        round_index=3,
        global_step=150,
        rng=rng,
        run_config={"test": True},
    )

    restored_model = build_model()
    restored_optimizer = torch.optim.AdamW(restored_model.parameters(), lr=1e-3)
    restored_scheduler = torch.optim.lr_scheduler.StepLR(
        restored_optimizer,
        step_size=1,
    )
    restored_self_play = ReplayBuffer(capacity=32)
    restored_sparring = ReplayBuffer(capacity=32)
    restored_teacher = ReplayBuffer(capacity=32)

    round_index, global_step = load_dual_checkpoint(
        checkpoint_path,
        restored_model,
        restored_optimizer,
        restored_scheduler,
        restored_self_play,
        restored_sparring,
        restored_teacher,
        torch.device("cpu"),
        np.random.default_rng(999),
    )

    assert (round_index, global_step) == (3, 150)
    assert len(restored_self_play) == 4
    assert len(restored_sparring) == 4
    assert len(restored_teacher) == 4
    for original, restored in zip(model.parameters(), restored_model.parameters()):
        assert torch.equal(original, restored)


@pytest.mark.skipif(
    shutil.which("node") is None,
    reason="Node.js is required to call the V4.0 JavaScript champion engine",
)
def test_v40_champion_bridge_returns_legal_center_move_on_empty_board():
    board = np.zeros(225, dtype=np.int8)
    with LegacyEngineOpponent(
        level="hard",
        width=4,
        time_ms=0,
        max_depth=1,
    ) as champion:
        move, diagnostics = champion.choose_move(board, BLACK)

    assert move == spot(7, 7)
    assert diagnostics["index"] == move



@pytest.mark.skipif(
    not torch.backends.mps.is_available(),
    reason="Apple MPS is not available on this machine",
)
def test_dual_train_step_runs_three_channel_backward_on_mps():
    device = torch.device("mps")
    model = build_model().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)

    metrics = dual_train_step(
        model,
        optimizer,
        _batch(batch_size=2),
        _batch(batch_size=2),
        _batch(batch_size=2),
        device,
    )
    torch.mps.synchronize()

    assert all(np.isfinite(value) for value in metrics.values())

def test_extending_dual_training_starts_from_checkpoint_lr_without_jump(tmp_path):
    model = build_model()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
    scheduler = _make_scheduler(optimizer, total_steps=12, warmup_steps=2)

    for _ in range(12):
        optimizer.zero_grad(set_to_none=True)
        sum(parameter.square().mean() for parameter in model.parameters()).backward()
        optimizer.step()
        scheduler.step()

    checkpoint_lr = float(optimizer.param_groups[0]["lr"])
    self_play = _replay_from_batch(_batch())
    sparring = _replay_from_batch(_batch())
    teacher = _replay_from_batch(_batch())
    checkpoint_path = tmp_path / "round_0003_full.pt"
    save_dual_checkpoint(
        checkpoint_path,
        model,
        optimizer,
        scheduler,
        self_play,
        sparring,
        teacher,
        round_index=3,
        global_step=12,
        rng=np.random.default_rng(123),
        run_config={
            "rounds": 3,
            "updates_per_round": 4,
            "learning_rate": 1e-4,
            "warmup_steps": 2,
        },
    )

    restored_model = build_model()
    restored_optimizer = torch.optim.AdamW(restored_model.parameters(), lr=1e-4)
    restored_self_play = ReplayBuffer(capacity=32)
    restored_sparring = ReplayBuffer(capacity=32)
    restored_teacher = ReplayBuffer(capacity=32)
    (
        start_round,
        global_step,
        checkpoint_config,
        checkpoint_scheduler_state,
    ) = load_dual_checkpoint(
        checkpoint_path,
        restored_model,
        restored_optimizer,
        scheduler=None,
        self_play_replay=restored_self_play,
        sparring_replay=restored_sparring,
        teacher_replay=restored_teacher,
        device=torch.device("cpu"),
        rng=np.random.default_rng(999),
        return_metadata=True,
    )

    args = SimpleNamespace(
        rounds=6,
        updates_per_round=4,
        learning_rate=1e-4,
        warmup_steps=2,
    )
    resumed_scheduler, schedule_config = _build_dual_scheduler(
        restored_optimizer,
        args,
        start_round,
        checkpoint_run_config=checkpoint_config,
        checkpoint_scheduler_state=checkpoint_scheduler_state,
    )

    assert (start_round, global_step) == (3, 12)
    assert schedule_config["schedule_mode"] == "extended_phase"
    assert schedule_config["schedule_start_round"] == 3
    assert schedule_config["schedule_target_rounds"] == 6
    assert schedule_config["schedule_warmup_steps"] == 0
    assert schedule_config["schedule_total_steps"] == 12
    assert float(restored_optimizer.param_groups[0]["lr"]) == pytest.approx(
        checkpoint_lr
    )

    restored_optimizer.zero_grad(set_to_none=True)
    sum(
        parameter.square().mean()
        for parameter in restored_model.parameters()
    ).backward()
    restored_optimizer.step()
    resumed_scheduler.step()
    first_resumed_lr = float(restored_optimizer.param_groups[0]["lr"])

    assert first_resumed_lr <= checkpoint_lr
    assert first_resumed_lr > checkpoint_lr * 0.98


def test_resuming_an_extended_phase_restores_its_scheduler_position(tmp_path):
    model = build_model()
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-5)
    args = SimpleNamespace(
        rounds=6,
        updates_per_round=4,
        learning_rate=1e-4,
        warmup_steps=100,
    )
    scheduler, schedule_config = _build_dual_scheduler(
        optimizer,
        args,
        start_round=3,
        checkpoint_run_config={
            "rounds": 3,
            "learning_rate": 1e-4,
            "warmup_steps": 2,
        },
        checkpoint_scheduler_state=None,
    )

    for _ in range(4):
        optimizer.zero_grad(set_to_none=True)
        sum(parameter.square().mean() for parameter in model.parameters()).backward()
        optimizer.step()
        scheduler.step()

    saved_lr = float(optimizer.param_groups[0]["lr"])
    self_play = _replay_from_batch(_batch())
    sparring = _replay_from_batch(_batch())
    teacher = _replay_from_batch(_batch())
    checkpoint_path = tmp_path / "extended_phase.pt"
    run_config = {
        **vars(args),
        **schedule_config,
    }
    save_dual_checkpoint(
        checkpoint_path,
        model,
        optimizer,
        scheduler,
        self_play,
        sparring,
        teacher,
        round_index=4,
        global_step=16,
        rng=np.random.default_rng(123),
        run_config=run_config,
    )

    restored_model = build_model()
    restored_optimizer = torch.optim.AdamW(restored_model.parameters(), lr=1e-4)
    restored_self_play = ReplayBuffer(capacity=32)
    restored_sparring = ReplayBuffer(capacity=32)
    restored_teacher = ReplayBuffer(capacity=32)
    (
        start_round,
        global_step,
        checkpoint_config,
        checkpoint_scheduler_state,
    ) = load_dual_checkpoint(
        checkpoint_path,
        restored_model,
        restored_optimizer,
        scheduler=None,
        self_play_replay=restored_self_play,
        sparring_replay=restored_sparring,
        teacher_replay=restored_teacher,
        device=torch.device("cpu"),
        rng=np.random.default_rng(999),
        return_metadata=True,
    )

    restored_scheduler, restored_config = _build_dual_scheduler(
        restored_optimizer,
        args,
        start_round,
        checkpoint_run_config=checkpoint_config,
        checkpoint_scheduler_state=checkpoint_scheduler_state,
    )

    assert (start_round, global_step) == (4, 16)
    assert restored_config["schedule_mode"] == "resume_same_schedule"
    assert restored_scheduler.last_epoch == scheduler.last_epoch
    assert float(restored_optimizer.param_groups[0]["lr"]) == pytest.approx(saved_lr)

    optimizer.zero_grad(set_to_none=True)
    sum(parameter.square().mean() for parameter in model.parameters()).backward()
    optimizer.step()
    scheduler.step()

    restored_optimizer.zero_grad(set_to_none=True)
    sum(
        parameter.square().mean()
        for parameter in restored_model.parameters()
    ).backward()
    restored_optimizer.step()
    restored_scheduler.step()

    assert float(restored_optimizer.param_groups[0]["lr"]) == pytest.approx(
        float(optimizer.param_groups[0]["lr"])
    )

