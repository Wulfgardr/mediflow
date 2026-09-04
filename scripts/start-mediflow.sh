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
HELPER="$DIR/scripts/launcher-helpers.mjs"
READY_TIMEOUT_MS="${MEDIFLOW_LAUNCH_READY_TIMEOUT_MS:-30000}"

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
if ! node "$HELPER" check-runtime >/dev/null 2>&1; then
    echo "  Serve Node ${REQUIRED_NODE_MAJOR}.x con dipendenze installate dalla stessa versione." >&2
    echo "  Esegui npm ci con Node ${REQUIRED_NODE_MAJOR}; non usare npm rebuild." >&2
    exit 1
fi

# @Codex: make the exact checkout identity visible and use it for safe reuse.
CURRENT_SOURCE_FINGERPRINT="$(node "$HELPER" identity-field sourceFingerprint)"
node "$HELPER" identity-summary
echo ""

# --- 2. Ollama (opzionale: funzioni generative locali) ---
if ! pgrep -x ollama >/dev/null 2>&1; then
    if command -v ollama >/dev/null 2>&1; then
        echo "  Avvio Ollama..."
        ( ollama serve >/dev/null 2>&1 & ) || true
    else
        echo "  Ollama non installato: le funzioni generative locali che lo richiedono non sono disponibili. Vedi https://ollama.com"
    fi
fi

# --- 3. Stato porta: free / occupied / unknown ---
# @Codex
port_inspection="$(node "$HELPER" inspect-port "$PORT" || true)"
IFS='|' read -r port_state listener_pid port_reason <<< "$port_inspection"
if [ "$port_state" != "free" ] && [ "$port_state" != "occupied" ]; then
    echo "  Impossibile determinare in sicurezza lo stato della porta ${PORT}." >&2
    echo "  Avvio bloccato (${port_reason:-ispezione non disponibile})." >&2
    exit 1
fi
if [ "$port_state" = "occupied" ]; then
    if ! probe_result="$(node "$HELPER" wait-and-open "$URL" "$CURRENT_SOURCE_FINGERPRINT" 5000 250 2>&1)"; then
        echo "  Porta ${PORT} occupata dal PID ${listener_pid:-sconosciuto}, ma l'istanza non corrisponde a questo checkout." >&2
        echo "  Riuso negato senza arrestare alcun processo (${probe_result})." >&2
        exit 1
    fi
    echo "  MediFlow ${CURRENT_SOURCE_FINGERPRINT} e gia attivo su ${URL} (PID ${listener_pid:-sconosciuto})."
    echo "  Verifica endpoint: ${probe_result}"
    exit 0
fi

# --- 4. Avvio server + apertura browser dopo readiness esatta ---
# @Codex: a free-port race or a mismatched server must never open the browser.
node "$HELPER" wait-and-open "$URL" "$CURRENT_SOURCE_FINGERPRINT" "$READY_TIMEOUT_MS" 250 &
readiness_pid=$!
cleanup_readiness() {
    if jobs -pr | grep -qx "$readiness_pid"; then
        kill "$readiness_pid" 2>/dev/null || true
    fi
    wait "$readiness_pid" 2>/dev/null || true
}
trap cleanup_readiness EXIT INT TERM

echo ""
echo "  URL: ${URL}"
echo "  Premi CTRL+C per arrestare."
echo ""
set +e
MEDIFLOW_APP_SOURCE_FINGERPRINT="$CURRENT_SOURCE_FINGERPRINT" \
MEDIFLOW_APP_FINGERPRINT="$CURRENT_SOURCE_FINGERPRINT" \
npm run dev
npm_exit_code=$?
set -e
cleanup_readiness
trap - EXIT INT TERM
exit "$npm_exit_code"
