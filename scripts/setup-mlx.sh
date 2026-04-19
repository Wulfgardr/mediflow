#!/bin/bash
echo "Setting up Apple MLX Environment..."

# Check if python3 exists
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 could not be found."
    exit 1
fi

# Create venv if not exists
if [ ! -d ".venv_mlx" ]; then
    echo "Creating virtual environment .venv_mlx..."
    python3 -m venv .venv_mlx
fi

# Activate venv
source .venv_mlx/bin/activate

# Install MLX-LM
echo "Installing mlx-lm and dependencies..."
pip install mlx-lm huggingface_hub

echo "Setup Complete!"
echo "To start the server, run: ./scripts/start-mlx.sh"
