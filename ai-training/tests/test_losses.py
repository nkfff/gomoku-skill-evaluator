from __future__ import annotations

import pytest
import torch

from gomoku.losses import (
    balanced_tactical_bce,
    compute_teba_loss,
    policy_cross_entropy,
    value_mse,
)


def test_policy_cross_entropy_accepts_visit_counts():
    logits = torch.zeros(2, 225)
    targets = torch.zeros(2, 225)
    targets[0, 10] = 8
    targets[0, 11] = 2
    targets[1, 20] = 1

    loss = policy_cross_entropy(logits, targets)

    assert torch.isfinite(loss)
    assert loss.item() > 0


def test_policy_mask_excludes_illegal_actions():
    logits = torch.zeros(1, 225, requires_grad=True)
    targets = torch.zeros(1, 225)
    mask = torch.zeros(1, 225, dtype=torch.bool)

    mask[0, 5] = True
    mask[0, 8] = True
    targets[0, 5] = 1

    loss = policy_cross_entropy(logits, targets, mask)
    loss.backward()

    assert torch.isfinite(loss)
    assert logits.grad[0, 8].abs() > 0
    assert torch.all(logits.grad[0, ~mask[0]] == 0)


def test_policy_rejects_target_mass_on_illegal_action():
    logits = torch.zeros(1, 225)
    targets = torch.zeros(1, 225)
    mask = torch.zeros(1, 225, dtype=torch.bool)

    mask[0, 5] = True
    targets[0, 6] = 1

    with pytest.raises(ValueError):
        policy_cross_entropy(logits, targets, mask)


def test_policy_rejects_empty_target_row():
    with pytest.raises(ValueError):
        policy_cross_entropy(
            torch.zeros(1, 225),
            torch.zeros(1, 225),
        )


def test_policy_rejects_sample_without_legal_actions():
    with pytest.raises(ValueError):
        policy_cross_entropy(
            torch.zeros(1, 225),
            torch.ones(1, 225),
            torch.zeros(1, 225, dtype=torch.bool),
        )


def test_value_mse():
    predictions = torch.tensor([0.5, -0.5])
    targets = torch.tensor([1.0, -1.0])

    loss = value_mse(predictions, targets)

    assert loss.item() == pytest.approx(0.25)


def test_balanced_tactical_bce_with_sparse_positive_labels():
    logits = torch.zeros(2, 3, 15, 15)
    targets = torch.zeros_like(logits)

    targets[0, 0, 7, 7] = 1
    targets[1, 1, 5, 5] = 1
    targets[1, 2, 6, 6] = 1

    loss = balanced_tactical_bce(logits, targets)

    assert torch.isfinite(loss)
    assert loss.item() == pytest.approx(0.693147, rel=1e-4)


def test_balanced_tactical_bce_handles_no_positive_labels():
    logits = torch.zeros(2, 3, 15, 15)
    targets = torch.zeros_like(logits)

    loss = balanced_tactical_bce(logits, targets)

    assert torch.isfinite(loss)
    assert loss.item() == pytest.approx(0.693147, rel=1e-4)


def test_balanced_tactical_bce_backpropagates():
    logits = torch.randn(2, 3, 15, 15, requires_grad=True)
    targets = torch.zeros_like(logits)
    targets[:, :, 7, 7] = 1

    loss = balanced_tactical_bce(logits, targets)
    loss.backward()

    assert logits.grad is not None
    assert torch.isfinite(logits.grad).all()


def test_compute_teba_loss_and_backward():
    batch_size = 2

    outputs = {
        "policy_logits": torch.randn(batch_size, 225, requires_grad=True),
        "value": torch.tanh(torch.randn(batch_size, requires_grad=True)),
        "tactical_logits": torch.randn(
            batch_size, 3, 15, 15, requires_grad=True
        ),
    }

    policy_targets = torch.zeros(batch_size, 225)
    policy_targets[0, 112] = 1
    policy_targets[1, 100] = 1

    value_targets = torch.tensor([1.0, -1.0])
    tactical_targets = torch.zeros(batch_size, 3, 15, 15)
    tactical_targets[0, 0, 7, 7] = 1
    tactical_targets[1, 1, 6, 6] = 1

    legal_mask = torch.ones(batch_size, 225, dtype=torch.bool)
    legal_mask[0, 112] = True
    legal_mask[1, 100] = True

    losses = compute_teba_loss(
        outputs,
        policy_targets,
        value_targets,
        tactical_targets,
        legal_mask,
    )

    assert set(losses) == {
        "loss",
        "policy_loss",
        "value_loss",
        "tactical_loss",
    }

    assert torch.isfinite(losses["loss"])
    losses["loss"].backward()

    assert outputs["policy_logits"].grad is not None
    assert outputs["tactical_logits"].grad is not None


def test_compute_teba_loss_rejects_negative_tactical_weight():
    outputs = {
        "policy_logits": torch.zeros(1, 225),
        "value": torch.zeros(1),
        "tactical_logits": torch.zeros(1, 3, 15, 15),
    }

    with pytest.raises(ValueError):
        compute_teba_loss(
            outputs,
            torch.nn.functional.one_hot(
                torch.tensor([112]), num_classes=225
            ).float(),
            torch.zeros(1),
            torch.zeros(1, 3, 15, 15),
            tactical_weight=-0.1,
        )
