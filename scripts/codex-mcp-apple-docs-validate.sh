#!/usr/bin/env bash
set -euo pipefail

# @Codex
SERVER_NAME="apple-docs"
EXPECTED_SPEC="@kimsungwhee/apple-docs-mcp@1.0.23"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI not found in PATH." >&2
  exit 1
fi

if ! output="$(codex mcp get "$SERVER_NAME" 2>/dev/null)"; then
  echo "MCP server '$SERVER_NAME' is not configured in Codex." >&2
  echo "Run: codex mcp add $SERVER_NAME -- npx -y $EXPECTED_SPEC" >&2
  exit 1
fi

if ! grep -q "$EXPECTED_SPEC" <<<"$output"; then
  echo "MCP server '$SERVER_NAME' is configured, but version pin differs." >&2
  echo "Expected: $EXPECTED_SPEC" >&2
  echo "Current config:" >&2
  echo "$output" >&2
  exit 1
fi

echo "Codex MCP validation passed for '$SERVER_NAME' ($EXPECTED_SPEC)."
