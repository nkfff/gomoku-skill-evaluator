from __future__ import annotations

import numpy as np
import pytest
import torch

from gomoku.game import BLACK, GomokuGame, spot
from gomoku.network import build_model
from gomoku.train import (
    ReplayBuffer,
    generate_bootstrap_data,
    load_checkpoint,
    pretrain_step,
    save_checkpoint,
    train_step,
)


def test_bootstrap_data_has_expected_shapes_and_valid_policy():
    samples = generate_bootstrap_data(
        max_positions=24,
        seed=17,
    )

    assert samples
    for state, policy, value, tactical, legal_mask in samples:
        assert state.shape == (3, 15, 15)
        assert policy.shape == (225,)
        assert tactical.shape == (3, 15, 15)
        assert legal_mask.shape == (225,)
        assert policy.sum() == pytest.approx(1.0)
        assert np.all(policy[~legal_mask] == 0)
        assert np.isfinite(state).all()
        assert np.isfinite(tactical).all()
        assert value == 0.0


def test_replay_buffer_samples_batch_with_replacement():
    replay = ReplayBuffer(capacity=3)
    state = np.zeros((3, 15, 15), dtype=np.float32)
    policy = np.zeros(225, dtype=np.float32)
    policy[spot(7, 7)] = 1.0
    tactical = np.zeros((3, 15, 15), dtype=np.float32)
    legal = np.zeros(225, dtype=np.bool_)
    legal[spot(7, 7)] = True

    replay.add_many([
        (state, policy, np.float32(1), tactical, legal),
        (state, policy, np.float32(-1), tactical, legal),
    ])

    batch = replay.sample(8, np.random.default_rng(1))

    assert batch["states"].shape == (8, 3, 15, 15)
    assert batch["policies"].shape == (8, 225)
    assert batch["values"].shape == (8,)
    assert batch["tactical"].shape == (8, 3, 15, 15)
    assert batch["legal_masks"].shape == (8, 225)


def _small_batch(batch_size=4):
    states = np.zeros((batch_size, 3, 15, 15), dtype=np.float32)
    policies = np.zeros((batch_size, 225), dtype=np.float32)
    legal_masks = np.zeros((batch_size, 225), dtype=np.bool_)
    for row in range(batch_size):
        action = spot(7, 7) + row
        policies[row, action] = 1.0
        legal_masks[row, action] = True

    return {
        "states": states,
        "policies": policies,
        "values": np.asarray([1, -1, 0, 1][:batch_size], dtype=np.float32),
        "tactical": np.zeros((batch_size, 3, 15, 15), dtype=np.float32),
        "legal_masks": legal_masks,
    }


def test_pretrain_step_updates_network_and_returns_finite_losses():
    model = build_model()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)

    metrics = pretrain_step(
        model,
        optimizer,
        _small_batch(),
        torch.device("cpu"),
    )

    assert set(metrics) == {
        "loss", "policy_loss", "value_loss", "tactical_loss"
    }
    assert all(np.isfinite(value) for value in metrics.values())
    assert metrics["value_loss"] == 0.0


def test_selfplay_train_step_updates_all_three_objectives():
    model = build_model()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)

    metrics = train_step(
        model,
        optimizer,
        _small_batch(),
        torch.device("cpu"),
    )

    assert all(np.isfinite(value) for value in metrics.values())
    assert metrics["policy_loss"] >= 0
    assert metrics["value_loss"] >= 0
    assert metrics["tactical_loss"] >= 0


def test_bootstrap_generation_is_reproducible():
    first = generate_bootstrap_data(
        max_positions=12,
        seed=123,
    )
    second = generate_bootstrap_data(
        max_positions=12,
        seed=123,
    )

    assert len(first) == len(second)
    for first_sample, second_sample in zip(first, second):
        assert np.array_equal(first_sample[0], second_sample[0])
        assert np.array_equal(first_sample[1], second_sample[1])
        assert np.array_equal(first_sample[3], second_sample[3])


def test_replay_buffer_enforces_capacity():
    replay = ReplayBuffer(capacity=2)
    state = np.zeros((3, 15, 15), dtype=np.float32)
    policy = np.zeros(225, dtype=np.float32)
    tactical = np.zeros((3, 15, 15), dtype=np.float32)
    legal = np.ones(225, dtype=np.bool_)

    replay.add_many([
        (state, policy, np.float32(0), tactical, legal),
        (state, policy, np.float32(1), tactical, legal),
        (state, policy, np.float32(-1), tactical, legal),
    ])

    assert len(replay) == 2
    assert [float(sample[2]) for sample in replay.samples] == [1.0, -1.0]



def test_bootstrap_dataset_contains_all_three_rule_verified_classes():
    samples = generate_bootstrap_data(max_positions=30, seed=7)
    classes = set()

    for _, _, _, tactical, _ in samples:
        active = np.flatnonzero(tactical.sum(axis=(1, 2)) > 0)
        assert len(active) == 1
        classes.add(int(active[0]))

    assert classes == {0, 1, 2}


def test_checkpoint_round_trip_restores_model_optimizer_and_replay(tmp_path):
    model = build_model()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
    scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=1)
    replay = ReplayBuffer(capacity=4)

    sample = _small_batch(batch_size=1)
    replay.add_many([
        (
            sample["states"][0],
            sample["policies"][0],
            np.float32(1.0),
            sample["tactical"][0],
            sample["legal_masks"][0],
        )
    ])

    checkpoint_path = tmp_path / "latest.pt"
    rng = np.random.default_rng(12)
    save_checkpoint(
        checkpoint_path,
        model,
        optimizer,
        scheduler,
        replay,
        round_index=2,
        global_step=37,
        rng=rng,
        run_config={"test": True},
    )

    restored_model = build_model()
    restored_optimizer = torch.optim.AdamW(restored_model.parameters(), lr=1e-3)
    restored_scheduler = torch.optim.lr_scheduler.StepLR(
        restored_optimizer,
        step_size=1,
    )
    restored_replay = ReplayBuffer(capacity=4)
    restored_rng = np.random.default_rng(999)

    round_index, global_step = load_checkpoint(
        checkpoint_path,
        restored_model,
        restored_optimizer,
        restored_scheduler,
        restored_replay,
        torch.device("cpu"),
        restored_rng,
    )

    assert (round_index, global_step) == (2, 37)
    assert len(restored_replay) == 1
    for original, restored in zip(model.parameters(), restored_model.parameters()):
        assert torch.equal(original, restored)



@pytest.mark.skipif(
    not torch.backends.mps.is_available(),
    reason="Apple MPS is not available on this machine",
)
def test_training_step_runs_on_apple_mps():
    device = torch.device("mps")
    model = build_model().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)

    metrics = train_step(
        model,
        optimizer,
        _small_batch(batch_size=2),
        device,
    )
    torch.mps.synchronize()

    assert all(np.isfinite(value) for value in metrics.values())
