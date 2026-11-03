#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_TRAINING_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$AI_TRAINING_DIR"

TARGET_ROUNDS="${TARGET_ROUNDS:-30000}"
SOURCE_CHECKPOINT="${SOURCE_CHECKPOINT:-checkpoints_dual/latest.pt}"
OUTPUT_DIR="${OUTPUT_DIR:-checkpoints_longrun}"
LOG_DIR="${LOG_DIR:-logs}"
STAMP="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="$LOG_DIR/teba_longrun_to_round_${TARGET_ROUNDS}_${STAMP}.log"

if [[ ! -f "$SOURCE_CHECKPOINT" && ! -f "$OUTPUT_DIR/latest.pt" ]]; then
  echo "Missing initial checkpoint: $SOURCE_CHECKPOINT" >&2
  exit 1
fi

python - <<'PY'
import torch
if not torch.backends.mps.is_available():
    raise SystemExit("Apple MPS is unavailable. Refusing to start long training.")
print(f"PyTorch: {torch.__version__}")
print(f"MPS available: {torch.backends.mps.is_available()}")
PY

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required by the V4.0 champion bridge." >&2
  exit 1
fi
node --version

if pgrep -f '[p]ython .* -m gomoku.(long_train|dual_train)' >/dev/null 2>&1; then
  echo "A TEBA long-run or dual-training process is already running. Refusing duplicate training." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR" "$LOG_DIR"
cat <<EOF
Starting TEBA-Net-S long-horizon reinforcement learning
  initial checkpoint:      $SOURCE_CHECKPOINT
  output directory:        $OUTPUT_DIR
  target total rounds:     $TARGET_ROUNDS
  stage length:            500 rounds
  self-play games/round:   8
  sparring games/round:    8
  opponent league share:   25%
  PUCT simulations:        64
  optimizer updates/round: 100
  D4 board augmentation:   enabled
  quick evaluation:        40 games per stage
  promotion confirmation: 100 games when candidate passes screening
  early-stop patience:     8 evaluation stages after round 5000
  log file:                $LOG_FILE
EOF

set -o pipefail
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dimsu python -u -m gomoku.long_train \
    --device mps \
    --init-checkpoint "$SOURCE_CHECKPOINT" \
    --output-dir "$OUTPUT_DIR" \
    --target-rounds "$TARGET_ROUNDS" \
    2>&1 | tee -a "$LOG_FILE"
else
  echo "Warning: caffeinate unavailable; macOS may sleep during the run." | tee -a "$LOG_FILE"
  python -u -m gomoku.long_train \
    --device mps \
    --init-checkpoint "$SOURCE_CHECKPOINT" \
    --output-dir "$OUTPUT_DIR" \
    --target-rounds "$TARGET_ROUNDS" \
    2>&1 | tee -a "$LOG_FILE"
fi

echo "Long-run log: $LOG_FILE"
