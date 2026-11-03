from __future__ import annotations

import pytest

from gomoku.long_train import bootstrap_pair_interval, promotion_decision


def test_bootstrap_pair_interval_is_deterministic_and_bounded():
    scores = [1.0] * 35 + [0.5] * 5 + [0.0] * 10
    first = bootstrap_pair_interval(scores, seed=77, samples=1000)
    second = bootstrap_pair_interval(scores, seed=77, samples=1000)
    assert first == second
    assert 0.0 <= first[0] <= first[1] <= 1.0


def test_promotion_requires_paired_confidence_and_both_colors():
    strong_candidate = {
        "pair_score": 0.68,
        "pair_ci_low": 0.54,
        "pair_ci_high": 0.79,
        "black_score": 0.62,
        "white_score": 0.58,
    }
    assert promotion_decision(strong_candidate)

    weak_confidence = {**strong_candidate, "pair_ci_low": 0.49}
    assert not promotion_decision(weak_confidence)

    color_bias = {**strong_candidate, "white_score": 0.42}
    assert not promotion_decision(color_bias)

    marginal_score = {**strong_candidate, "pair_score": 0.52}
    assert not promotion_decision(marginal_score)


def test_promotion_threshold_can_be_configured():
    metrics = {
        "pair_score": 0.61,
        "pair_ci_low": 0.53,
        "pair_ci_high": 0.72,
        "black_score": 0.58,
        "white_score": 0.56,
    }
    assert promotion_decision(metrics, min_score=0.60, ci_lower=0.52)
    assert not promotion_decision(metrics, min_score=0.62, ci_lower=0.52)
