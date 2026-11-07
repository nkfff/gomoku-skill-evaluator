# TEBA-Net-S large-scale training against Gunuce

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
| Gunuce share of sparring games | 50% |
| Historical TEBA league share | 25% |
| V4.0 alpha-beta share | 25% |
| Gunuce sparring simulations | 64 |
| TEBA training simulations | 64 |
| Evaluation simulations | 128 for both models |
| Updates / round | 100 |
| Batch size | 64 |
| Learning rate | 2e-5 |
| Self-play / sparring loss weights | 0.5 / 0.5 |
| D4 augmentation | enabled |

The league's 25% allocation is further split by the tactical-opponent fraction
(default 20% of league games) between historical TEBA opponents and the
rule-based tactical opponent.

A fresh optimizer and fresh sparring/teacher buffers are used when starting
from the model-only Round 1060 snapshot. The old Round 1560 optimizer/replay
state is deliberately not resumed. The candidate learner still evolves from
stage to stage; the champion file remains unchanged unless promotion succeeds.

## Promotion gates

Every 500 rounds:

1. Quick paired-opening comparison against the current best TEBA checkpoint.
2. Quick paired-opening comparison against frozen Gunuce.
3. A candidate only enters the corresponding 100-game confirmation if its
   40-game quick result reaches 55% paired score and scores at least 50% as
   both BLACK and WHITE.
4. Promotion requires both 100-game confirmations to pass:
   - paired score >= 55%;
   - paired bootstrap 95% CI lower bound > 50%;
   - BLACK score >= 50%;
   - WHITE score >= 50%.

The two color-swapped games in each pair use the same opening. This controls
opening variance. Win-rate promotion is independent of inference latency.
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
- evaluation/baseline_round_NNNNN_vs_gunuce.csv: starting baseline.
- evaluation/round_NNNNN_quick_vs_gunuce.csv: stage quick test.
- evaluation/round_NNNNN_confirmation_vs_gunuce.csv: stage confirmation.
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
