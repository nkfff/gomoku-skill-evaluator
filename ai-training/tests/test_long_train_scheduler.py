from __future__ import annotations

from types import SimpleNamespace

import pytest
import torch

from gomoku.dual_train import _build_dual_scheduler


def test_long_run_rebases_near_zero_round60_learning_rate():
    optimizer = torch.optim.AdamW([torch.nn.Parameter(torch.ones(2))], lr=1.164e-6)
    args = SimpleNamespace(
        rounds=30_000,
        updates_per_round=100,
        learning_rate=1e-4,
        warmup_steps=500,
        rebase_learning_rate=5e-5,
    )
    scheduler, config = _build_dual_scheduler(
        optimizer,
        args,
        start_round=60,
        checkpoint_run_config={
            "rounds": 60,
            "learning_rate": 1e-4,
            "warmup_steps": 100,
        },
        checkpoint_scheduler_state=None,
    )

    assert config["schedule_mode"] == "rebase_phase"
    assert config["schedule_start_round"] == 60
    assert config["schedule_target_rounds"] == 30_000
    assert config["schedule_total_steps"] == (30_000 - 60) * 100
    assert config["schedule_warmup_steps"] == 500
    assert optimizer.param_groups[0]["lr"] == pytest.approx(5e-5)
    assert scheduler.last_epoch == 0
