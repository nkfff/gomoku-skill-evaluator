from __future__ import annotations

import pytest
import torch

from gomoku.network import (
    EXPECTED_PARAMETER_COUNT,
    TEBANetS,
    build_model,
)


def test_network_output_shapes():
    model = build_model()
    inputs = torch.randn(4, 3, 15, 15)

    outputs = model(inputs)

    assert outputs["policy_logits"].shape == (4, 225)
    assert outputs["value"].shape == (4,)
    assert outputs["tactical_logits"].shape == (4, 3, 15, 15)


def test_network_has_frozen_parameter_count():
    model = build_model()

    assert model.trainable_parameter_count == EXPECTED_PARAMETER_COUNT
    assert model.trainable_parameter_count == 77_477


def test_value_is_bounded():
    model = build_model()
    outputs = model(torch.randn(3, 3, 15, 15))

    assert torch.all(outputs["value"] >= -1.0)
    assert torch.all(outputs["value"] <= 1.0)


def test_network_supports_batch_size_one():
    model = build_model()
    outputs = model(torch.randn(1, 3, 15, 15))

    assert outputs["policy_logits"].shape == (1, 225)
    assert outputs["value"].shape == (1,)
    assert outputs["tactical_logits"].shape == (1, 3, 15, 15)


@pytest.mark.parametrize(
    "shape",
    [
        (3, 15, 15),
        (2, 4, 15, 15),
        (2, 3, 14, 15),
        (2, 3, 15, 14),
    ],
)
def test_network_rejects_invalid_input_shapes(shape):
    model = build_model()

    with pytest.raises(ValueError):
        model(torch.randn(*shape))


def test_network_backward_reaches_all_heads():
    model = build_model()
    inputs = torch.randn(2, 3, 15, 15)

    outputs = model(inputs)
    loss = (
        outputs["policy_logits"].square().mean()
        + outputs["value"].square().mean()
        + outputs["tactical_logits"].square().mean()
    )

    loss.backward()

    assert model.policy_head.weight.grad is not None
    assert model.value_head[2].weight.grad is not None
    assert model.tactical_head.weight.grad is not None

    assert all(
        parameter.grad is not None
        for parameter in model.parameters()
        if parameter.requires_grad
    )


@pytest.mark.skipif(
    not torch.backends.mps.is_available(),
    reason="Apple MPS is not available on this machine",
)
def test_network_forward_backward_on_mps():
    device = torch.device("mps")
    model = build_model().to(device)
    inputs = torch.randn(2, 3, 15, 15, device=device)

    outputs = model(inputs)
    loss = (
        outputs["policy_logits"].square().mean()
        + outputs["value"].square().mean()
        + outputs["tactical_logits"].square().mean()
    )

    loss.backward()
    torch.mps.synchronize()

    assert outputs["policy_logits"].device.type == "mps"
    assert outputs["value"].device.type == "mps"
    assert outputs["tactical_logits"].device.type == "mps"
