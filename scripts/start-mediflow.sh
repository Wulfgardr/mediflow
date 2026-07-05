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

# --- 1. Node.js ---
if ! command -v node >/dev/null 2>&1; then
    echo "  Node.js non trovato. Installa Node 20 LTS e riprova." >&2
    exit 1
fi
if ! node scripts/launcher-helpers.mjs check-node >/dev/null 2>&1; then
    echo "  Attenzione: Node $(node -v) non compatibile, serve Node 20 LTS (vedi .nvmrc)."
    echo "  Con un'altra versione l'install di better-sqlite3 puo cadere su node-gyp."
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
