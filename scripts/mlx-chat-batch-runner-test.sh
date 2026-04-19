#!/bin/bash
# @Codex
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_EXEC="$ROOT_DIR/.venv_mlx/bin/python3"

if [ ! -x "$PYTHON_EXEC" ]; then
  echo "Missing MLX virtual environment at $PYTHON_EXEC" >&2
  exit 1
fi

OUT_FILE="$(mktemp)"
trap 'rm -f "$OUT_FILE"' EXIT

"$PYTHON_EXEC" "$ROOT_DIR/scripts/mlx-chat-batch-runner.py" \
  --model fake/model \
  --corpus "$ROOT_DIR/scripts/fixtures/mlx-runtime-benchmark-corpus.json" \
  --compare-kv-bits 4 \
  --limit 1 \
  --dry-run \
  --out "$OUT_FILE" >/dev/null

"$PYTHON_EXEC" - <<'PY' "$OUT_FILE"
import json, sys
path = sys.argv[1]
payload = json.load(open(path, "r", encoding="utf8"))
assert payload["model"] == "fake/model"
assert payload["caseIds"] == ["short-clinical-summary"]
assert [variant["id"] for variant in payload["variants"]] == ["baseline", "kv_bits_4"]
print("mlx-chat-batch-runner dry-run smoke passed")
PY
