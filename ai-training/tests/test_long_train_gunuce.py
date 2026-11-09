from gomoku.long_train_gunuce import (
    _all_benchmarks_pass,
    _gunuce_promotion_decision,
    _quick_pass,
    build_parser,
)


def test_gunuce_quick_gate_requires_score_and_both_colors():
    strong = {
        "pair_score": 0.60,
        "black_score": 0.55,
        "white_score": 0.52,
    }
    assert _quick_pass(strong, min_score=0.55)
    assert not _quick_pass({**strong, "white_score": 0.49}, min_score=0.55)
    assert not _quick_pass({**strong, "pair_score": 0.54}, min_score=0.55)


def test_gunuce_promotion_gate_requires_confidence_and_both_colors():
    strong = {
        "pair_score": 0.62,
        "pair_ci_low": 0.53,
        "pair_ci_high": 0.71,
        "black_score": 0.58,
        "white_score": 0.55,
    }
    assert _gunuce_promotion_decision(strong, min_score=0.55, ci_lower=0.50)
    assert not _gunuce_promotion_decision(
        {**strong, "pair_ci_low": 0.49},
        min_score=0.55,
        ci_lower=0.50,
    )
    assert not _gunuce_promotion_decision(
        {**strong, "black_score": 0.47},
        min_score=0.55,
        ci_lower=0.50,
    )



def test_three_way_promotion_requires_all_benchmarks():
    assert _all_benchmarks_pass(True, True, True)
    assert not _all_benchmarks_pass(False, True, True)
    assert not _all_benchmarks_pass(True, False, True)
    assert not _all_benchmarks_pass(True, True, False)


def test_training_mix_reserves_slots_for_gunuce_league_and_v40():
    args = build_parser().parse_args([])

    assert args.gunuce_fraction == 0.40
    assert args.league_fraction == 0.30
    assert args.gunuce_fraction + args.league_fraction == 0.70
    # dual_train assigns the remaining 30% to its V4.0 alpha-beta engine.
