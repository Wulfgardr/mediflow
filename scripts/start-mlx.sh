#!/bin/bash
# Default Model: Optimized 4-bit MedGemma 2 or similar
DEFAULT_MODEL="mlx-community/medgemma-1.5-4b-it-bf16"
MODEL=${1:-$DEFAULT_MODEL}
PORT=8080

echo "Starting Apple MLX Server with model: $MODEL on port $PORT..."

# Resolve directory of this script to find .venv_mlx reliably
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$DIR/.."

# Path to venv python
PYTHON_EXEC="$PROJECT_ROOT/.venv_mlx/bin/python3"

if [ ! -f "$PYTHON_EXEC" ]; then
    echo "❌ Virtual Env not found at $PYTHON_EXEC"
    echo "Running setup..."
    "$DIR/setup-mlx.sh"
fi

echo "🚀 Starting Apple MLX Server"
echo "   Model: $MODEL"
echo "   Port: $PORT"
echo "   Python: $PYTHON_EXEC"

# Run Server (Directly using venv python)
exec "$PYTHON_EXEC" -m mlx_lm.server --model $MODEL --port $PORT --host 0.0.0.0 --log-level INFO
