from __future__ import annotations

import shutil

import numpy as np
import pytest
import torch

from gomoku.game import BLACK, spot
from gomoku.legacy_opponent import LegacyEngineOpponent
from gomoku.network import build_model
from gomoku.train import ReplayBuffer
from gomoku.dual_train import (
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
