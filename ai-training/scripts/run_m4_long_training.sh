#!/usr/bin/env bash
set -euo pipefail

# Run from any directory; all paths are resolved relative to ai-training/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_TRAINING_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$AI_TRAINING_DIR"

TARGET_ROUNDS="${TARGET_ROUNDS:-60}"
CHECKPOINT_DIR="${CHECKPOINT_DIR:-checkpoints_dual}"
LATEST_CHECKPOINT="$CHECKPOINT_DIR/latest.pt"
LOG_DIR="${LOG_DIR:-logs}"
STAMP="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="$LOG_DIR/dual_train_to_round_${TARGET_ROUNDS}_${STAMP}.log"

if [[ ! -f "$LATEST_CHECKPOINT" ]]; then
  echo "Missing checkpoint: $LATEST_CHECKPOINT" >&2
  exit 1
fi

python - <<'PY'
import torch

if not torch.backends.mps.is_available():
    raise SystemExit("Apple MPS is unavailable. Refusing to start a long MPS run.")
print(f"PyTorch: {torch.__version__}")
print(f"MPS available: {torch.backends.mps.is_available()}")
PY

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required by the V4.0 champion bridge." >&2
  exit 1
fi
node --version

if pgrep -f '[p]ython -m gomoku.dual_train' >/dev/null 2>&1; then
  echo "A gomoku.dual_train process already appears to be running. Refusing to start a duplicate run." >&2
  exit 1
fi

CURRENT_ROUND="$(python - "$LATEST_CHECKPOINT" "$TARGET_ROUNDS" <<'PY'
import sys
import torch

checkpoint_path, target_text = sys.argv[1:3]
target_rounds = int(target_text)
checkpoint = torch.load(
    checkpoint_path,
    map_location="cpu",
    weights_only=False,
    mmap=True,
)
current_round = int(checkpoint.get("round_index", -1))
if current_round < 0:
    raise SystemExit("Checkpoint does not contain a valid round_index.")
if target_rounds <= current_round:
    raise SystemExit(
        f"Target rounds ({target_rounds}) must exceed checkpoint round ({current_round})."
    )
print(current_round)
PY
)"

mkdir -p "$CHECKPOINT_DIR" "$LOG_DIR"
FULL_BACKUP="$CHECKPOINT_DIR/round_$(printf '%04d' "$CURRENT_ROUND")_full_checkpoint.pt"
if [[ ! -e "$FULL_BACKUP" ]]; then
  cp -p "$LATEST_CHECKPOINT" "$FULL_BACKUP"
  echo "Preserved full resume checkpoint: $FULL_BACKUP"
else
  echo "Full checkpoint backup already exists; leaving it untouched: $FULL_BACKUP"
fi

ADDITIONAL_ROUNDS=$((TARGET_ROUNDS - CURRENT_ROUND))
GAMES_PER_ROUND=16
UPDATES_PER_ROUND=100
ADDITIONAL_GAMES=$((ADDITIONAL_ROUNDS * GAMES_PER_ROUND))
ADDITIONAL_UPDATES=$((ADDITIONAL_ROUNDS * UPDATES_PER_ROUND))

cat <<EOF
Starting TEBA-Net-S extended dual-channel training
  checkpoint round:       $CURRENT_ROUND
  target total rounds:    $TARGET_ROUNDS
  additional rounds:      $ADDITIONAL_ROUNDS
  additional games:       $ADDITIONAL_GAMES
  additional updates:     $ADDITIONAL_UPDATES
  PUCT simulations:       64
  batch size:             64
  self-play games/round:  8
  champion games/round:   8
  V4.0 champion budget:   500 ms/move
  checkpoint directory:   $CHECKPOINT_DIR
  log file:               $LOG_FILE
EOF

set -o pipefail
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dimsu python -m gomoku.dual_train \
    --device mps \
    --resume "$LATEST_CHECKPOINT" \
    --rounds "$TARGET_ROUNDS" \
    --self-play-games-per-round 8 \
    --champion-games-per-round 8 \
    --simulations 64 \
    --updates-per-round "$UPDATES_PER_ROUND" \
    --batch-size 64 \
    --replay-capacity 50000 \
    --output-dir "$CHECKPOINT_DIR" \
    2>&1 | tee -a "$LOG_FILE"
else
  echo "Warning: caffeinate is unavailable; macOS may sleep during the run." | tee -a "$LOG_FILE"
  python -m gomoku.dual_train \
    --device mps \
    --resume "$LATEST_CHECKPOINT" \
    --rounds "$TARGET_ROUNDS" \
    --self-play-games-per-round 8 \
    --champion-games-per-round 8 \
    --simulations 64 \
    --updates-per-round "$UPDATES_PER_ROUND" \
    --batch-size 64 \
    --replay-capacity 50000 \
    --output-dir "$CHECKPOINT_DIR" \
    2>&1 | tee -a "$LOG_FILE"
fi

python - "$LATEST_CHECKPOINT" "$TARGET_ROUNDS" <<'PY'
import sys
import torch

checkpoint_path, target_text = sys.argv[1:3]
checkpoint = torch.load(
    checkpoint_path,
    map_location="cpu",
    weights_only=False,
    mmap=True,
)
actual_round = int(checkpoint.get("round_index", -1))
target_round = int(target_text)
if actual_round != target_round:
    raise SystemExit(
        f"Training exited without reaching target round {target_round}; "
        f"latest checkpoint is round {actual_round}."
    )
print(f"Training complete: latest checkpoint is round {actual_round}.")
PY

echo "Training log: $LOG_FILE"
