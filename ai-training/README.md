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
