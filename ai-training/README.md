# GomokuZero V4.1 — Local AI Training

This directory contains the Python research implementation for the V4.1
TEBA-MCTS project. It is deliberately separated from the stable V4.0
browser game.

## Current milestones

### V4.1.1 — Game environment and state encoding

- 15x15 board, flattened to 225 cells.
- Cell values: 0 = empty, 1 = black, 2 = white.
- Black moves first.
- Five or more contiguous stones win.
- No Renju forbidden-move rules.
- Candidate generation follows the iteration and insertion order used by
  `v4.0/src/engine.js`.
- State encoding: current-player stones, opponent stones, last-move plane.

### V4.1.2 — TEBA-Net-S and multi-task losses

- Four residual blocks, 32 channels, GroupNorm(8), ReLU.
- Policy head: 225 logits.
- Value head: scalar in [-1, 1].
- Tactical head: three 15x15 logit maps (WIN_NOW, MUST_BLOCK, FORK).
- Exactly 77,477 trainable parameters.
- Objective: policy cross-entropy + value MSE + 0.2 x balanced tactical BCE.
- Policy loss supports legal-action masking and MCTS visit-count targets.

### V4.1.3 — Rule-derived tactical evidence

- `gomoku/tactical.py` creates deterministic auxiliary labels from board rules.
- `WIN_NOW`: all immediate winning moves for the side to move.
- `MUST_BLOCK`: opponent's immediate winning cells when the side to move has
  no immediate win of its own.
- `FORK`: moves that create at least two distinct immediate winning replies.
- Tactical priority is WIN_NOW, then MUST_BLOCK, then FORK.
- Multiple opponent winning cells are marked as a forced-loss state because
  one move cannot occupy all threats.
- The labeler does not mutate the input board and returns [3, 15, 15] float32
  targets, plus diagnostic move lists.
- Fork detection is a one-ply double-threat definition; it is not a general
  proof of a forced win or a substitute for MCTS.

### V4.1.4 — Neural PUCT baseline

- `gomoku/mcts.py` connects TEBA-Net-S outputs to a PUCT search tree.
- Selection uses `-Q(child) + c_puct * P(child) * sqrt(N(parent)) / (1 + N(child))`.
- Values are stored from each node's side-to-move perspective and signs are
  flipped during backup.
- Policy priors are masked to local legal candidates; tactical-head logits
  provide a configurable, low-weight prior adjustment.
- Exact immediate wins and a unique immediate block are enforced by the
  rule-based tactical analyzer, not by trusting neural predictions.
- Two or more opponent immediate-winning cells are reported as a forced loss,
  while legal moves remain available for a least-bad decision.
- Optional root Dirichlet noise is available for self-play. Evaluation defaults
  to no root noise.
- Search returns root visit counts, a 225-cell visit policy, root priors,
  value estimate, and forced-loss diagnostics.
- `TorchEvaluator` performs TEBA-Net-S inference on CPU or Apple MPS.
- This is the PUCT baseline. The adaptive TEBA search-budget mechanism is a
  separate research stage and is not claimed to be implemented here.

## Activate the local environment

From the repository root:

```bash
source .venv/bin/activate
cd ai-training
```

Run the full test suite:

```bash
python -m pytest tests -v
```

Run only the game/encoding tests:

```bash
python -m pytest tests/test_game.py -v
```

Run only the network/loss tests:

```bash
python -m pytest tests/test_network.py tests/test_losses.py -v
```

The JavaScript differential test runs when Node.js is available. It imports
the actual V4.0 engine and compares candidate ordering, immediate wins, and
winning-line output.

## MPS check

From the repository root:

```bash
python ai-training/check_mps.py
```

The network test suite also runs a forward/backward pass on MPS when the
backend is available.

## Frozen model configuration

The current architecture and initial optimizer settings are recorded in
`configs/teba_net_s.yaml`. The configuration is an implementation baseline;
training throughput and stability must still be measured on the target M4
machine before starting self-play.

Training artifacts, datasets, virtual environments, and checkpoints should
remain local and should not be committed to Git.


## Training TEBA-Net-S on Apple Silicon

Install the Python dependencies from the repository root:

```bash
cd ai-training
python -m pip install -r requirements.txt
```

Run the conservative M4 pilot (tactical bootstrap followed by PUCT self-play):

```bash
python -m gomoku.train --device mps
```

The default pilot uses:
- 1,200 randomized, rule-verified tactical templates spanning WIN_NOW,
  MUST_BLOCK and FORK.
- 100 policy/tactical pretraining updates. The value head is intentionally not
  trained from synthetic bootstrap labels.
- 3 self-play rounds, 4 games per round, 16 PUCT simulations per move.
- 50 multi-task optimizer updates per self-play round, batch size 32.
- AdamW, float32, gradient clipping, warmup and cosine learning-rate decay.

The bootstrap set uses randomized synthetic board patterns for exact one-ply
rule evidence (WIN_NOW, MUST_BLOCK and the defined two-threat FORK). Every
target is re-derived by the rule analyzer. It is a tactical initialization
dataset, not expert play and not a claim of optimal strategy.
The value head begins learning from final self-play outcomes only.

Training outputs are local and ignored by Git:
- `checkpoints/latest.pt`: full resumable checkpoint, including optimizer,
  scheduler and replay buffer.
- `checkpoints/round_NNNN_model.pt`: compact model-only snapshot.
- `checkpoints/training.csv`: per-phase and per-round loss/throughput log.

Resume an interrupted run:

```bash
python -m gomoku.train --device mps --resume checkpoints/latest.pt
```

For the first run, do not immediately scale to the YAML's former large
self-play settings. Confirm MPS stability, elapsed time per game, replay
growth, and all three losses first. Increase simulations and games per round
only after measuring the M4 throughput.

A small pilot is an engineering validation, not evidence of playing strength.
Strength evaluation against fixed baselines and held-out tactical positions
must be added before claiming a trained model is stronger.


### V4.1.5 — Dual-channel learning and champion evaluation

The dual-learning stage preserves the completed V4.1.4 pilot and initializes
from `checkpoints/latest.pt`. It does not overwrite the original checkpoint.

The two reinforcement-learning channels are:

1. **Self-play:** the current TEBA model plays both colors against itself.
   PUCT visit distributions supervise policy; terminal outcomes supervise value.
2. **Champion sparring:** TEBA plays one side against the actual V4.0 hard AI
   from `v4.0/src/engine.js`. Learner turns are trained from PUCT targets and
   game outcomes. Learner colors alternate between games.

A third, deliberately low-weight auxiliary signal uses successful champion
demonstrations. V4.0 moves are distilled only from games in which the champion
wins or draws. A losing champion trajectory is not treated as expert policy.
This avoids blindly imitating mistakes. Teacher demonstrations contribute only
to policy loss; they do not directly train value or tactical heads.

The champion is the real V4.0 hard engine (iterative-deepening alpha-beta,
transposition table, tactical move ordering and tactical extension). Its
per-move budget is capped at 500 ms for practical local training throughput;
this is not the original 2.4-second full hard-mode budget. For a full-budget
champion, pass `--champion-time-ms 2400 --champion-width 14 --champion-max-depth 14`.
Both learner colors are evaluated to reduce first-player bias.

Node.js is required because the champion bridge calls the actual V4.0
JavaScript engine rather than a separately reimplemented approximation.

Run from `ai-training/` after the V4.1.4 pilot has created
`checkpoints/latest.pt`. First record a baseline match before changing the
model:

```bash
python -m gomoku.evaluate --checkpoint checkpoints/latest.pt --device mps --games 20 --simulations 64 --opening-plies 6 --seed 2028 --champion-time-ms 500 --output evaluation/baseline_v4_1_4_diagnostics.csv
```

Then start dual-channel learning:

```bash
python -m gomoku.dual_train --device mps
```

### V4.1.6 — Evaluation diagnostics and extended dual learning

V4.1.6 upgrades the five-round dual-learning pilot to a longer M4 research run
and makes both training and evaluation games auditable.

**Default extended M4 schedule**
- 30 total rounds.
- 8 TEBA self-play games and 8 V4.0 champion games per round: 480 games total.
- 64 PUCT simulations per learner move.
- 100 optimizer updates per round: 3,000 updates total.
- Batch size 64; three replay buffers capped at 50,000 positions each.
- 60% self-play RL objective and 40% champion-sparring RL objective.
- Additional successful-champion policy-distillation coefficient: 0.15.
- AdamW at 1e-4, float32, gradient clipping, 100 warmup steps.
- V4.0 champion: hard level, width 14, 500 ms and maximum depth 10.
- Full model/replay checkpoint saved after every round.

The 30-round setting is the default total target, not 30 additional rounds
when resuming. To continue a completed run to 60 total rounds, pass
`--resume checkpoints_dual/latest.pt --rounds 60`. The trainer keeps the
original `checkpoints/latest.pt` Pilot untouched.

**Training artifacts**
- `checkpoints_dual/latest.pt`: model, optimizer, scheduler, RNG states and
  all three replay buffers for exact round-boundary resume.
- `checkpoints_dual/round_NNNN_model.pt`: model-only snapshot from each round.
- `checkpoints_dual/dual_training.csv`: channel sizes, game outcomes,
  component losses, learning rate and elapsed time.
- `checkpoints_dual/training_games.jsonl`: complete self-play and champion
  sparring move records, board-before snapshots, search data and tactical flags.

**Start or resume extended training**

```bash
python -m gomoku.dual_train --device mps
```

If interrupted, resume from the latest completed round:

```bash
python -m gomoku.dual_train --device mps --resume checkpoints_dual/latest.pt
```

To extend a completed 30-round run to 60 total rounds:

```bash
python -m gomoku.dual_train --device mps --resume checkpoints_dual/latest.pt --rounds 60
```

The trainer refuses to overwrite an existing `checkpoints_dual/latest.pt`
unless `--resume` is supplied. Use a new `--output-dir` for an independent run.
Checkpoints are written every completed round; an interruption during a round
resumes from the preceding completed checkpoint.

**Paired-opening evaluation with full diagnostics**

```bash
python -m gomoku.evaluate \
  --checkpoint checkpoints_dual/latest.pt \
  --device mps \
  --games 20 \
  --simulations 64 \
  --opening-plies 6 \
  --seed 2028 \
  --champion-time-ms 500
```

Each two-game pair reuses the same randomized legal opening and swaps TEBA's
color. This controls opening variation and first-player bias. Evaluation
outputs:
- `evaluation/champion_match_diagnostics.csv`: per-game score, length,
  latency and tactical-miss counts.
- `evaluation/champion_match_diagnostics_games.jsonl`: full game records and
  every move.
- `evaluation/champion_match_diagnostics_plies.jsonl`: one searchable JSON
  record per ply, including the pre-move board, selected move, TEBA root
  top-five visits/priors or V4.0 nodes/depth/reason, elapsed time, and exact
  immediate-win / forced-block / fork diagnostics.

The evaluator reports immediate-win misses and forced-block misses separately.
A multi-threat forced-loss position is not incorrectly counted as a missed
single-move block. The fork flag refers to the project's explicit one-ply
two-winning-reply definition; it is not a proof of a forced win.

Do not promote a checkpoint based on training loss alone. Compare it against
the frozen champion and previous TEBA checkpoints using the same opening pairs,
colors, PUCT simulations and champion search budget. A 20-game match is still
an early screening result, not a publication-grade Elo estimate.


## V4.1.7 — Frozen-checkpoint head-to-head comparison

V4.1.7 adds a direct, reproducible match between two saved TEBA checkpoints.
It is designed to answer whether later training actually improves playing
strength, rather than relying on training loss or matches against only the
fixed V4.0 champion.

**Comparison protocol**
- MODEL_A and MODEL_B are loaded from separate frozen checkpoint files.
- Both use the same PUCT simulations, `c_puct`, candidate rules and
  deterministic evaluation mode (no root Dirichlet noise).
- Each opening pair generates one reproducible legal six-ply opening.
- The exact same opening is replayed twice: MODEL_A plays BLACK in game one
  and WHITE in game two.
- The default is 40 games = 20 distinct opening pairs.
- Search is sequential on the selected device; both models remain frozen.

**Run the Round 5 vs Round 30 comparison on M4**

```bash
python -m gomoku.compare_checkpoints \
  --checkpoint-a checkpoints_dual/round_0005_model.pt \
  --checkpoint-b checkpoints_dual/round_0030_model.pt \
  --device mps \
  --games 40 \
  --simulations 64 \
  --opening-plies 6 \
  --seed 2028 \
  --output evaluation/round05_vs_round30_head_to_head.csv
```

MODEL_A is the first checkpoint (Round 5); MODEL_B is the second checkpoint
(Round 30). The output files are:
- `evaluation/round05_vs_round30_head_to_head.csv`: per-game results,
  color assignment, pair outcome, game length, latency and tactical misses.
- `evaluation/round05_vs_round30_head_to_head_games.jsonl`: complete game
  records, including opening sequence and all moves.
- `evaluation/round05_vs_round30_head_to_head_plies.jsonl`: one diagnostic
  record per ply, including board-before state, selected move, PUCT root
  top-five visits/priors, root value and exact tactical opportunity flags.

The summary reports each model's wins/draws/losses, score, color-specific
results, paired-opening outcomes, mean search latency and tactical misses.
A paired result is based on the two color-swapped games: a model winning both
(or winning one and drawing the other) wins the pair; equal pair points are a
paired draw. The smoothed Elo value is descriptive only and must not be
presented as a publication-grade rating.

**Interpretation**
- A later checkpoint should not be promoted merely because its training loss
  decreased or because it survives longer against the champion.
- The paired head-to-head is the direct test of relative checkpoint strength.
- 20 opening pairs are an initial screening experiment. Publication-grade
  comparisons need substantially more independent openings, confidence
  intervals and repeated seeds.
- Keep all source checkpoints unchanged; comparison is inference-only and
  writes separate evaluation artifacts.
