# TEBA-Net-S three-way large-scale training: self, V4.0 and Gunuce

This experiment starts from the frozen TEBA champion snapshot (Round 1060), not
from the regressed Round 1560 learner. It keeps Gunuce frozen and uses it both
as a training sparring opponent and as an independent promotion benchmark.

## What is compared

- TEBA-Net-S: 77,477 parameters, three input planes, policy/value/tactical
  heads, current TEBA PUCT implementation.
- Gunuce: frozen production ONNX model
  white-rl-pilot-001-fit7-update4000, 1,121,482 parameters, four input planes,
  policy/value heads. Its Python PUCT implementation ports the deployed
  browser search settings: 128 simulations by default, c_puct=1.5 and FPU
  reduction=0.2.
- The Gunuce ONNX file is fetched from a pinned public Git commit on first use,
  cached outside the repository, and verified against SHA-256
  23d38cef34cb63ebd537a3b34be3f5042f05a24688c98a840b55c4e1a9ee0602.

The ONNX model is an inference artifact only. It does not contain Gunuce's
training data, optimizer state, or source training checkpoint.

## Training plan

Defaults in gomoku.long_train_gunuce:

| Setting | Value |
|---|---:|
| Starting checkpoint | checkpoints_longrun/best.pt (Round 1060) |
| New target round | 31,060 (30,000 additional rounds) |
| Stage size | 500 rounds |
| Self-play games / round | 8 |
| Sparring games / round | 8 |
| Gunuce share of sparring games | 40% |
| Historical TEBA / tactical league bucket | 30% (24% / 6%) |
| V4.0 alpha-beta share | 30% |
| Gunuce sparring simulations | 64 |
| TEBA training simulations | 64 |
| TEBA / Gunuce evaluation simulations | 128 / 128 |
| V4.0 evaluation budget | width 14, 500 ms, max depth 10 |
| Updates / round | 100 |
| Batch size | 64 |
| Full checkpoint interval | 10 rounds (stage end is always saved) |
| Game diagnostics | 1 in every 20 games |
| Learning rate | 2e-5 |
| Self-play / sparring loss weights | 0.5 / 0.5 |
| D4 augmentation | enabled |

The historical league's 30% allocation is further split by the
tactical-opponent fraction (default 20% of league games) between historical
TEBA snapshots (including the initial Round-1060 champion) and the rule-based
tactical opponent. The remaining 30% is the actual V4.0 hard/王者 alpha-beta
engine. Thus the learner sees three distinct frozen opponent families:
historical TEBA, V4.0, and Gunuce, in addition to self-play.

Gunuce's search considers the full board, while TEBA training normally uses a
radius-2 candidate set. The sparring pipeline explicitly adds a legal Gunuce
move to that sample's TEBA teacher mask when it falls outside the local set;
this prevents valid full-board Gunuce moves from aborting training.

A fresh optimizer and fresh sparring/teacher buffers are used when starting
from the model-only Round 1060 snapshot. The old Round 1560 optimizer/replay
state is deliberately not resumed. The candidate learner still evolves from
stage to stage; the champion file remains unchanged unless promotion succeeds.
To control disk writes, the full replay/optimizer checkpoint is saved every 10
rounds (and at every stage boundary); up to nine rounds may need to be replayed
after an abrupt power loss. Game-level move diagnostics are sampled at one in
every 20 games; all positions are still retained in the training replay buffers.

## Promotion gates

Every 500 rounds:

1. Quick paired-opening comparison against the current best TEBA checkpoint.
2. Quick paired-opening comparison against the actual V4.0 hard/王者
   alpha-beta engine (width 14, 500 ms, max depth 10).
3. Quick paired-opening comparison against frozen Gunuce.
4. Each benchmark independently enters its 100-game confirmation only if its
   40-game quick result reaches 55% paired score and scores at least 50% as
   both BLACK and WHITE.
5. Promotion requires all three 100-game confirmations (current best TEBA,
   V4.0, and Gunuce) to pass independently:
   - paired score >= 55%;
   - paired bootstrap 95% CI lower bound > 50%;
   - BLACK score >= 50%;
   - WHITE score >= 50%.

The two color-swapped games in each pair use the same opening. This controls
opening variance. The current-best comparison measures improvement over the
learner's own previous champion; the V4.0 and Gunuce matches are independent
external benchmarks. A candidate is promoted only when it improves over its
own incumbent and clears both external benchmarks. Win-rate promotion is
independent of inference latency.
Latency is reported descriptively; TEBA may run on MPS while ONNX Runtime
Gunuce runs on CPU, so those latency values are not a hardware-normalized
benchmark.

## Install and launch on macOS M4

Run from the ai-training directory:

    python -m pip install -r requirements.txt

Start the long run:

    caffeinate -dimsu python -u -m gomoku.long_train_gunuce \
      --device mps \
      --eval-device mps \
      --init-checkpoint checkpoints_longrun/best.pt \
      --output-dir checkpoints_gunuce_longrun \
      --target-rounds 31060 \
      --stage-rounds 500

The first use downloads and verifies the Gunuce ONNX model into
~/Library/Caches/GomokuLab/gunuce.onnx. A custom exact copy can be supplied
with --gunuce-model /absolute/path/to/gunuce.onnx.

If the process stops, run the same command again. The script resumes from
checkpoints_gunuce_longrun/latest.pt and restores optimizer, scheduler, RNG,
and replay buffers. Do not point this experiment at the old
checkpoints_longrun/latest.pt from Round 1560.

## Monitor

    tail -f checkpoints_gunuce_longrun/dual_training.csv
    tail -f checkpoints_gunuce_longrun/evaluation/gunuce_long_run_evaluations.jsonl

Important files:

- latest.pt: full resumable learner state (large; includes replay buffers).
- best.pt: compact promoted TEBA champion model.
- round_NNNNN_model.pt: stage model snapshots.
- evaluation/baseline_round_NNNNN_vs_gunuce.csv: starting Gunuce baseline.
- evaluation/baseline_round_NNNNN_vs_v40.csv: starting V4.0 baseline.
- evaluation/round_NNNNN_quick_vs_gunuce.csv and *_vs_v40.csv: stage quick tests.
- evaluation/round_NNNNN_confirmation_vs_gunuce.csv and *_vs_v40.csv: confirmations.
- evaluation/gunuce_long_run_evaluations.jsonl: promotion and metric history.

## Standalone 100-game comparison

    python -m gomoku.evaluate_gunuce \
      --checkpoint checkpoints_longrun/best.pt \
      --device mps \
      --games 100 \
      --simulations 128 \
      --gunuce-simulations 128 \
      --opening-plies 6 \
      --seed 2032 \
      --output evaluation/round1060_vs_gunuce.csv

The result reports W/D/L, game score, paired score, paired bootstrap 95% CI,
pair W/D/L, BLACK/WHITE scores, and per-move search latency.


V4.0 can also be evaluated independently:

    python -m gomoku.evaluate_v40 \
      --checkpoint checkpoints_longrun/best.pt \
      --device mps \
      --games 100 \
      --simulations 128 \
      --opening-plies 6 \
      --champion-width 14 \
      --champion-time-ms 500 \
      --champion-max-depth 10 \
      --seed 2033 \
      --output evaluation/round1060_vs_v40.csv


## Three-way progress reporting

For each 500-round stage, the evaluation folder contains independent
color-swapped results:

- `round_NNNNN_quick_vs_incumbent`: candidate versus the previous best TEBA.
- `round_NNNNN_quick_vs_v40`: candidate versus the V4.0 hard/王者 engine.
- `round_NNNNN_quick_vs_gunuce`: candidate versus the frozen Gunuce ONNX model.
- Matching `confirmation` files are generated only when the corresponding
  quick test passes.

The JSONL history records all three quick metrics, all available confirmation
metrics, each gate result, and the final promotion decision. Initial baseline
files record the starting Round-1060 champion against V4.0 and Gunuce.
Subsequent stages compare each candidate directly with the then-current best
TEBA, which measures improvement over the learner's own previous champion.

The Python Gunuce value check now matches the deployed browser implementation:
finite ONNX values are forwarded without clipping or a [-1, 1] assertion;
NaN and infinite outputs are still rejected.
