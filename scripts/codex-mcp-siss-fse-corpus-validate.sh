#!/usr/bin/env bash
set -euo pipefail

# @Codex
SERVER_NAME="siss-fse-corpus"
EXPECTED_SCRIPT="scripts/siss-fse-corpus-mcp.mjs"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI not found in PATH." >&2
  exit 1
fi

if ! output="$(codex mcp get "$SERVER_NAME" 2>/dev/null)"; then
  echo "MCP server '$SERVER_NAME' is not configured in Codex." >&2
  echo "Run from repo root:" >&2
  echo "  codex mcp add $SERVER_NAME -- node \"$(pwd)/$EXPECTED_SCRIPT\" --manifest \"$(pwd)/scripts/siss-docs-corpus-sources.json\" --corpus-dir \"$(pwd)/tmp/siss-docs-corpus\"" >&2
  exit 1
fi

if ! grep -q "$EXPECTED_SCRIPT" <<<"$output"; then
  echo "MCP server '$SERVER_NAME' is configured, but does not point to $EXPECTED_SCRIPT." >&2
  echo "Current config:" >&2
  echo "$output" >&2
  exit 1
fi

echo "Codex MCP validation passed for '$SERVER_NAME' ($EXPECTED_SCRIPT)."
