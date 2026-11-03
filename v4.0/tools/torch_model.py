"""15x15 freestyle Gomoku policy/value network; values use side-to-move perspective."""
import torch
from torch import nn


def conv(in_channels, out_channels):
    return nn.Sequential(nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
                         nn.BatchNorm2d(out_channels), nn.ReLU())


class ResidualBlock(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.layers = nn.Sequential(conv(channels, channels),
            nn.Conv2d(channels, channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(channels))

    def forward(self, x):
        return torch.relu(x + self.layers(x))


class PolicyValueNet(nn.Module):
    def __init__(self, channels=64, blocks=8, dropout=0.0):
        super().__init__()
        self.trunk = nn.Sequential(conv(4, channels),
                                   *[ResidualBlock(channels) for _ in range(blocks)])
        self.dropout = nn.Dropout2d(dropout)
        self.policy = nn.Conv2d(channels, 1, 1)
        self.value = nn.Sequential(nn.Conv2d(channels, 8, 1), nn.ReLU(),
            nn.Flatten(), nn.Linear(8 * 225, 128), nn.ReLU(), nn.Linear(128, 1), nn.Tanh())

    def forward(self, state):
        features = self.dropout(self.trunk(state))
        return self.policy(features).flatten(1), self.value(features).squeeze(-1)


def training_loss(logits, value, legal, target_policy, target_value, value_weight):
    """value_weight=0 for puzzles without a proven outcome; never label those draws."""
    logits = logits.masked_fill(~legal.bool(), -1e9)
    policy_loss = -(target_policy * logits.log_softmax(-1)).sum(-1).mean()
    value_loss = ((value - target_value).square() * value_weight).sum() / value_weight.sum().clamp_min(1)
    return policy_loss + value_loss
