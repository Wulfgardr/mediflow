#!/usr/bin/env bash
# @Codex
# MediFlow - one-click launcher (Linux).
# Avvia la web app locale Next.js e apre il browser. Equivalente di
# Start_MediFlow.command (macOS) e Start-MediFlow.ps1 (Windows).
# Non avvia i client Apple. Se Ollama o ICD-11 non sono installati,
# MediFlow resta usabile con funzionalita ridotte.
set -euo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

PORT=3000
URL="http://localhost:${PORT}"

echo "==================================================="
echo "   MediFlow - Avvio (Linux)"
echo "==================================================="
echo ""

# --- 1. Node.js + native binding ---
REQUIRED_NODE_MAJOR="$(tr -dc '0-9' < "$DIR/.nvmrc")"
path_node="$(command -v node 2>/dev/null || true)"
for candidate in "$path_node" "$HOME"/.nvm/versions/node/v"$REQUIRED_NODE_MAJOR".*/bin/node \
    "$HOME"/.local/share/fnm/node-versions/v"$REQUIRED_NODE_MAJOR".*/installation/bin/node; do
    [ -x "$candidate" ] || continue
    if "$candidate" scripts/launcher-helpers.mjs check-runtime >/dev/null 2>&1; then
        export PATH="$(dirname "$candidate"):$PATH"
        break
    fi
done
if ! node scripts/launcher-helpers.mjs check-runtime >/dev/null 2>&1; then
    echo "  Serve Node ${REQUIRED_NODE_MAJOR}.x con dipendenze installate dalla stessa versione." >&2
    echo "  Esegui npm ci con Node ${REQUIRED_NODE_MAJOR}; non usare npm rebuild." >&2
    exit 1
fi

# --- 2. Ollama (opzionale: AI/OCR locale) ---
if ! pgrep -x ollama >/dev/null 2>&1; then
    if command -v ollama >/dev/null 2>&1; then
        echo "  Avvio Ollama..."
        ( ollama serve >/dev/null 2>&1 & ) || true
    else
        echo "  Ollama non installato: AI e OCR locali disattivati. Vedi https://ollama.com"
    fi
fi

# --- 3. Porta gia occupata? ---
listener_pid="$(node scripts/launcher-helpers.mjs port-listener "$PORT" || true)"
if [ -n "$listener_pid" ]; then
    echo "  MediFlow risulta gia attivo su ${URL} (PID ${listener_pid}). Apro il browser sull'istanza esistente."
    node scripts/launcher-helpers.mjs open "$URL" || true
    exit 0
fi

# --- 4. Avvio server + apertura browser (non bloccante) ---
( sleep 5 && node scripts/launcher-helpers.mjs open "$URL" >/dev/null 2>&1 || true ) &

echo ""
echo "  URL: ${URL}"
echo "  Premi CTRL+C per arrestare."
echo ""
exec npm run dev
