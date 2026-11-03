# GomokuZero V4.1 — Local AI Training

This directory contains the Python research implementation for the V4.1
TEBA-MCTS project. It is deliberately separated from the stable V4.0
browser game.

## Current milestone

V4.1.1 — deterministic Gomoku environment and state encoding.

- 15x15 board, flattened to 225 cells.
- Cell values: 0 = empty, 1 = black, 2 = white.
- Black moves first.
- Five or more contiguous stones win.
- No Renju forbidden-move rules.
- Candidate generation follows the iteration and insertion order used by
  `v4.0/src/engine.js`.
- State encoding: current-player stones, opponent stones, last-move plane.

## Activate the local environment

From the repository root:

```bash
source .venv/bin/activate
cd ai-training
python -m pytest tests/test_game.py -v
```

The JavaScript differential test runs when Node.js is available. It imports
the actual V4.0 engine and compares candidate ordering, immediate wins, and
winning-line output.

## MPS check

From the repository root:

```bash
python ai-training/check_mps.py
```

Training artifacts, datasets, and checkpoints should remain local and should
not be committed to Git.
