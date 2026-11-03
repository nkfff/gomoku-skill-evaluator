from __future__ import annotations

import torch
import torch.nn.functional as F


POLICY_SIZE = 225
TACTICAL_CHANNELS = 3
TACTICAL_WEIGHT = 0.2


def policy_cross_entropy(
    policy_logits: torch.Tensor,
    policy_targets: torch.Tensor,
    legal_mask: torch.Tensor | None = None,
) -> torch.Tensor:
    """
    Cross-entropy against an MCTS visit distribution.

    Args:
        policy_logits: [B, 225], unnormalized network policy scores.
        policy_targets: [B, 225], non-negative visit counts or probabilities.
        legal_mask: optional [B, 225] boolean mask. Illegal actions are
            excluded from the softmax and must have zero target mass.

    Target rows are normalized internally, so raw visit counts are accepted.
    """
    if policy_logits.ndim != 2 or policy_logits.shape[1] != POLICY_SIZE:
        raise ValueError("policy_logits must have shape [B, 225]")

    if policy_targets.shape != policy_logits.shape:
        raise ValueError("policy_targets must match policy_logits shape")

    if not torch.is_floating_point(policy_targets):
        policy_targets = policy_targets.to(dtype=policy_logits.dtype)

    if torch.any(policy_targets < 0):
        raise ValueError("policy_targets cannot contain negative values")

    if legal_mask is None:
        legal_mask = torch.ones_like(policy_logits, dtype=torch.bool)
    else:
        if legal_mask.shape != policy_logits.shape:
            raise ValueError("legal_mask must have shape [B, 225]")
        legal_mask = legal_mask.to(device=policy_logits.device, dtype=torch.bool)

    if torch.any(~legal_mask.any(dim=1)):
        raise ValueError("each sample must contain at least one legal action")

    illegal_target_mass = (
        policy_targets.to(device=policy_logits.device)
        * (~legal_mask).to(dtype=policy_logits.dtype)
    ).sum(dim=1)

    if torch.any(illegal_target_mass > 1e-6):
        raise ValueError("policy target assigns probability to an illegal action")

    targets = policy_targets.to(
        device=policy_logits.device,
        dtype=policy_logits.dtype,
    )

    target_mass = targets.sum(dim=1, keepdim=True)
    if torch.any(target_mass <= 0):
        raise ValueError("each policy target row must have positive mass")

    targets = targets / target_mass

    masked_logits = policy_logits.masked_fill(~legal_mask, -1e9)
    log_probabilities = F.log_softmax(masked_logits, dim=1)

    return -(targets * log_probabilities).sum(dim=1).mean()


def value_mse(
    value_predictions: torch.Tensor,
    value_targets: torch.Tensor,
) -> torch.Tensor:
    """Mean-squared error for game outcomes in {-1, 0, +1}."""
    predictions = value_predictions.reshape(-1)
    targets = value_targets.to(
        device=predictions.device,
        dtype=predictions.dtype,
    ).reshape(-1)

    if predictions.shape != targets.shape:
        raise ValueError("value_targets must contain one value per sample")

    return F.mse_loss(predictions, targets)


def balanced_tactical_bce(
    tactical_logits: torch.Tensor,
    tactical_targets: torch.Tensor,
) -> torch.Tensor:
    """
    Class-balanced BCE for the three tactical heatmaps.

    Each sample/channel contributes the mean positive BCE and mean negative
    BCE with equal class weight when both classes are present. If a map has
    no positive labels, its negative BCE is used. This avoids the large
    negative-class count overwhelming sparse tactical positives.

    Shapes:
        tactical_logits:  [B, 3, 15, 15]
        tactical_targets: [B, 3, 15, 15], binary labels
    """
    if tactical_logits.ndim != 4 or tuple(tactical_logits.shape[1:]) != (
        TACTICAL_CHANNELS, 15, 15
    ):
        raise ValueError("tactical_logits must have shape [B, 3, 15, 15]")

    if tactical_targets.shape != tactical_logits.shape:
        raise ValueError("tactical_targets must match tactical_logits shape")

    targets = tactical_targets.to(
        device=tactical_logits.device,
        dtype=tactical_logits.dtype,
    )

    elementwise = F.binary_cross_entropy_with_logits(
        tactical_logits,
        targets,
        reduction="none",
    )

    positive = targets > 0.5
    negative = ~positive

    positive_count = positive.sum(dim=(-2, -1))
    negative_count = negative.sum(dim=(-2, -1))

    positive_loss = (
        elementwise * positive.to(dtype=elementwise.dtype)
    ).sum(dim=(-2, -1)) / positive_count.clamp_min(1)

    negative_loss = (
        elementwise * negative.to(dtype=elementwise.dtype)
    ).sum(dim=(-2, -1)) / negative_count.clamp_min(1)

    positive_present = (positive_count > 0).to(dtype=elementwise.dtype)
    negative_present = (negative_count > 0).to(dtype=elementwise.dtype)

    class_count = (positive_present + negative_present).clamp_min(1)

    per_map_loss = (
        positive_loss * positive_present
        + negative_loss * negative_present
    ) / class_count

    return per_map_loss.mean()


def compute_teba_loss(
    outputs: dict[str, torch.Tensor],
    policy_targets: torch.Tensor,
    value_targets: torch.Tensor,
    tactical_targets: torch.Tensor,
    legal_mask: torch.Tensor | None = None,
    tactical_weight: float = TACTICAL_WEIGHT,
) -> dict[str, torch.Tensor]:
    """
    Compute the frozen TEBA-Net-S multi-task objective:

        L = L_policy + L_value + 0.2 * L_tactical

    Returns a dictionary containing total and component losses.
    """
    required = {"policy_logits", "value", "tactical_logits"}
    missing = required.difference(outputs)

    if missing:
        raise KeyError(f"network outputs missing keys: {sorted(missing)}")

    if tactical_weight < 0:
        raise ValueError("tactical_weight must be non-negative")

    policy_loss = policy_cross_entropy(
        outputs["policy_logits"],
        policy_targets,
        legal_mask,
    )

    value_loss = value_mse(
        outputs["value"],
        value_targets,
    )

    tactical_loss = balanced_tactical_bce(
        outputs["tactical_logits"],
        tactical_targets,
    )

    total_loss = (
        policy_loss
        + value_loss
        + tactical_weight * tactical_loss
    )

    return {
        "loss": total_loss,
        "policy_loss": policy_loss,
        "value_loss": value_loss,
        "tactical_loss": tactical_loss,
    }
