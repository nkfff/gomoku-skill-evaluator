from __future__ import annotations

import torch
from torch import nn


BOARD_SIZE = 15
INPUT_CHANNELS = 3
RESIDUAL_CHANNELS = 32
RESIDUAL_BLOCKS = 4
TACTICAL_CHANNELS = 3
EXPECTED_PARAMETER_COUNT = 77_477


class ResidualBlock(nn.Module):
    """Two-convolution residual block with GroupNorm and ReLU."""

    def __init__(self, channels: int = RESIDUAL_CHANNELS) -> None:
        super().__init__()

        self.conv1 = nn.Conv2d(
            channels, channels, kernel_size=3, padding=1, bias=False
        )
        self.norm1 = nn.GroupNorm(num_groups=8, num_channels=channels)
        self.conv2 = nn.Conv2d(
            channels, channels, kernel_size=3, padding=1, bias=False
        )
        self.norm2 = nn.GroupNorm(num_groups=8, num_channels=channels)
        self.activation = nn.ReLU(inplace=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x

        x = self.activation(self.norm1(self.conv1(x)))
        x = self.norm2(self.conv2(x))
        x = self.activation(x + residual)

        return x


class TEBANetS(nn.Module):
    """
    TEBA-Net-S for 15x15 Gomoku.

    Input:
        float tensor [B, 3, 15, 15]
        channel 0: current player's stones
        channel 1: opponent's stones
        channel 2: last move

    Outputs:
        policy_logits:   [B, 225]
        value:           [B], in [-1, 1], from current-player perspective
        tactical_logits: [B, 3, 15, 15]
            channel 0: WIN_NOW
            channel 1: MUST_BLOCK
            channel 2: FORK

    Architecture:
        3x3 stem convolution, 32 channels
        4 residual blocks, 32 channels, GroupNorm(8), ReLU
        policy: 1x1 convolution, 1 output channel
        value: global average pooling -> 32 -> 64 -> 1 -> tanh
        tactical: 1x1 convolution, 3 output channels

    The network has exactly 77,477 trainable parameters.
    """

    def __init__(self) -> None:
        super().__init__()

        self.stem = nn.Sequential(
            nn.Conv2d(
                INPUT_CHANNELS,
                RESIDUAL_CHANNELS,
                kernel_size=3,
                padding=1,
                bias=False,
            ),
            nn.GroupNorm(num_groups=8, num_channels=RESIDUAL_CHANNELS),
            nn.ReLU(inplace=False),
        )

        self.backbone = nn.Sequential(
            *[
                ResidualBlock(RESIDUAL_CHANNELS)
                for _ in range(RESIDUAL_BLOCKS)
            ]
        )

        self.policy_head = nn.Conv2d(
            RESIDUAL_CHANNELS, 1, kernel_size=1, bias=True
        )

        self.value_head = nn.Sequential(
            nn.AdaptiveAvgPool2d(output_size=1),
            nn.Flatten(start_dim=1),
            nn.Linear(RESIDUAL_CHANNELS, 64),
            nn.ReLU(inplace=False),
            nn.Linear(64, 1),
            nn.Tanh(),
        )

        self.tactical_head = nn.Conv2d(
            RESIDUAL_CHANNELS,
            TACTICAL_CHANNELS,
            kernel_size=1,
            bias=True,
        )

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        if x.ndim != 4:
            raise ValueError(
                "input must have shape [B, 3, 15, 15]; "
                f"received {tuple(x.shape)}"
            )

        if tuple(x.shape[1:]) != (INPUT_CHANNELS, BOARD_SIZE, BOARD_SIZE):
            raise ValueError(
                "input must have shape [B, 3, 15, 15]; "
                f"received {tuple(x.shape)}"
            )

        features = self.stem(x)
        features = self.backbone(features)

        policy_logits = self.policy_head(features).flatten(start_dim=1)
        value = self.value_head(features).squeeze(dim=1)
        tactical_logits = self.tactical_head(features)

        return {
            "policy_logits": policy_logits,
            "value": value,
            "tactical_logits": tactical_logits,
        }

    @property
    def trainable_parameter_count(self) -> int:
        return sum(
            parameter.numel()
            for parameter in self.parameters()
            if parameter.requires_grad
        )


def build_model() -> TEBANetS:
    """Construct the frozen TEBA-Net-S architecture."""
    model = TEBANetS()

    if model.trainable_parameter_count != EXPECTED_PARAMETER_COUNT:
        raise RuntimeError(
            "TEBA-Net-S parameter count changed: "
            f"expected {EXPECTED_PARAMETER_COUNT}, "
            f"got {model.trainable_parameter_count}"
        )

    return model
