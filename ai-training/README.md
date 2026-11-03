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
- 8 random bootstrap games, capped at 1,200 tactical positions.
- 100 policy/tactical pretraining updates. The value head is intentionally not
  trained from synthetic bootstrap labels.
- 3 self-play rounds, 4 games per round, 16 PUCT simulations per move.
- 50 multi-task optimizer updates per self-play round, batch size 32.
- AdamW, float32, gradient clipping, warmup and cosine learning-rate decay.

The bootstrap teacher is generated from exact one-ply rule evidence
(WIN_NOW, MUST_BLOCK and the defined two-threat FORK). It is a tactical
initialization dataset, not expert play and not a claim of optimal strategy.
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
