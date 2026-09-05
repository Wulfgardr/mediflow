#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"
HELPER="$DIR/scripts/launcher-helpers.mjs"

# @Codex: select a Node runtime that matches both .nvmrc and the installed native binding.
REQUIRED_NODE_MAJOR="$(tr -dc '0-9' < "$DIR/.nvmrc")"
select_mediflow_node() {
    local candidate=""
    local path_node="$(command -v node 2>/dev/null || true)"
    for candidate in "$path_node" \
        "$HOME"/.nvm/versions/node/v"$REQUIRED_NODE_MAJOR".*/bin/node \
        "$HOME"/.local/share/fnm/node-versions/v"$REQUIRED_NODE_MAJOR".*/installation/bin/node \
        /opt/homebrew/opt/node@"$REQUIRED_NODE_MAJOR"/bin/node \
        /usr/local/opt/node@"$REQUIRED_NODE_MAJOR"/bin/node \
        /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
        [ -x "$candidate" ] || continue
        if "$candidate" "$HELPER" check-runtime >/dev/null 2>&1; then
            export PATH="$(dirname "$candidate"):$PATH"
            return 0
        fi
    done
    return 1
}

if ! select_mediflow_node; then
    echo "MediFlow richiede Node ${REQUIRED_NODE_MAJOR}.x con dipendenze installate dalla stessa versione." >&2
    echo "Esegui npm ci con Node ${REQUIRED_NODE_MAJOR}, poi rilancia. npm rebuild non e necessario." >&2
    exit 1
fi

echo "==================================================="
echo "   🏥 MediFlow - Avvio Completo"
echo "==================================================="
echo ""

# @Codex
QUIET_EXIT=""
# @Codex
MEDIFLOW_PORT="3000"
# @Codex
MEDIFLOW_URL="http://localhost:${MEDIFLOW_PORT}"
# @Codex
CURRENT_APP_VERSION=""
# @Codex
CURRENT_APP_REVISION=""
# @Codex
CURRENT_APP_BRANCH=""
# @Codex
CURRENT_APP_WORKTREE_HASH=""
# @Codex
CURRENT_APP_SOURCE_FINGERPRINT=""
# @Codex
CURRENT_APP_FINGERPRINT="${CURRENT_APP_SOURCE_FINGERPRINT}"
# @Codex
NEXT_CACHE_REVISION_FILE="$DIR/.next/.mediflow-app-revision"
# @Codex
PORT_LISTENER_PID=""
# @Codex
PORT_STATUS="free"
# @Codex
PORT_INSPECTION_REASON=""
# @Codex
READY_WAITER_PID=""
# @Codex
READY_TIMEOUT_MS="${MEDIFLOW_LAUNCH_READY_TIMEOUT_MS:-30000}"

# @Codex: all exported identity fields come from the same shared algorithm.
if ! CURRENT_APP_VERSION="$(node "$HELPER" identity-field version)" \
    || ! CURRENT_APP_REVISION="$(node "$HELPER" identity-field revision)" \
    || ! CURRENT_APP_BRANCH="$(node "$HELPER" identity-field branch)" \
    || ! CURRENT_APP_WORKTREE_HASH="$(node "$HELPER" identity-field worktreeHash)" \
    || ! CURRENT_APP_SOURCE_FINGERPRINT="$(node "$HELPER" identity-field sourceFingerprint)" \
    || [ -z "$CURRENT_APP_SOURCE_FINGERPRINT" ]; then
    echo "Impossibile determinare in sicurezza l'identità del checkout MediFlow." >&2
    exit 1
fi
CURRENT_APP_FINGERPRINT="$CURRENT_APP_SOURCE_FINGERPRINT"

# @Codex
reset_next_cache_if_revision_changed() {
    local previous_revision=""
    if [ -f "$NEXT_CACHE_REVISION_FILE" ]; then
        previous_revision="$(cat "$NEXT_CACHE_REVISION_FILE" 2>/dev/null)"
    fi

    if [ -n "$previous_revision" ] && [ "$previous_revision" != "$CURRENT_APP_SOURCE_FINGERPRINT" ] && [ -d "$DIR/.next" ]; then
        echo "   ♻️  Sorgente UI cambiato (${previous_revision} -> ${CURRENT_APP_SOURCE_FINGERPRINT}). Reset cache Next locale..."
        rm -rf "$DIR/.next"
    fi

    mkdir -p "$DIR/.next"
    printf '%s' "$CURRENT_APP_SOURCE_FINGERPRINT" > "$NEXT_CACHE_REVISION_FILE"
}

if ! node "$HELPER" identity-summary; then
    echo "Impossibile mostrare l'identità del checkout MediFlow." >&2
    exit 1
fi
echo ""

# --- 1. Start Ollama (AI Engine) ---
echo "🤖 [1/2] Controllo AI Engine (Ollama)..."
if ! pgrep -x "ollama" > /dev/null; then
    echo "   ⚠️  Ollama non attivo. Avvio in corso..."
    if command -v ollama &> /dev/null; then
        ollama serve &
        # Probe di readiness reale invece di uno sleep fisso: poll su /api/tags
        # (l'endpoint usato anche da getHealth) con backoff, fino a ~15s.
        OLLAMA_READY=0
        for _attempt in $(seq 1 15); do
            if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:11434/api/tags"; then
                OLLAMA_READY=1
                break
            fi
            sleep 1
        done
        if [ "$OLLAMA_READY" = "1" ]; then
            echo "   ✅ Ollama avviato e pronto."
        else
            echo "   ⚠️  Ollama avviato ma non ancora pronto dopo 15s: le funzioni AI potrebbero tardare."
        fi
    else
        echo "   ❌ Ollama non trovato. Installa da https://ollama.com"
    fi
else
    echo "   ✅ Ollama già attivo."
fi

PORT_INSPECTION="$(node "$HELPER" inspect-port "$MEDIFLOW_PORT" || true)"
IFS='|' read -r PORT_STATUS PORT_LISTENER_PID PORT_INSPECTION_REASON <<< "$PORT_INSPECTION"
if [ "$PORT_STATUS" != "free" ] && [ "$PORT_STATUS" != "occupied" ]; then
    echo ""
    echo "   ❌ Impossibile determinare in sicurezza lo stato della porta ${MEDIFLOW_PORT}."
    echo "      Dettaglio: ${PORT_INSPECTION_REASON:-ispezione non disponibile}"
    echo "      Avvio bloccato: verifica la porta e rilancia MediFlow."
    exit 1
fi

# --- 2. Start Next.js App ---
echo ""
echo "🚀 [2/2] Avvio Applicazione Next.js..."
echo ""

# Cleanup function
cleanup() {
    if [ -n "${READY_WAITER_PID:-}" ]; then
        if jobs -pr | grep -qx "$READY_WAITER_PID"; then
            kill "$READY_WAITER_PID" 2>/dev/null || true
        fi
        wait "$READY_WAITER_PID" 2>/dev/null || true
        READY_WAITER_PID=""
    fi
    if [ -n "${QUIET_EXIT:-}" ]; then
        exit 0
    fi
    echo ""
    echo "🛑 Arresto in corso..."
    echo "👋 MediFlow arrestato. A presto!"
    exit
}

trap cleanup SIGINT TERM HUP EXIT

if [ "$PORT_STATUS" = "occupied" ]; then
    if ! READY_RESULT="$(node "$HELPER" wait-and-open "$MEDIFLOW_URL" "$CURRENT_APP_SOURCE_FINGERPRINT" 5000 250 2>&1)"; then
        echo "   ❌ Porta ${MEDIFLOW_PORT} occupata, ma l'istanza non corrisponde a questo checkout."
        echo "      PID: ${PORT_LISTENER_PID:-sconosciuto}"
        echo "      Riuso negato senza arrestare alcun processo (${READY_RESULT})."
        exit 1
    fi
    echo "   ✅ MediFlow ${CURRENT_APP_SOURCE_FINGERPRINT} è già attivo su ${MEDIFLOW_URL}."
    echo "      PID: ${PORT_LISTENER_PID:-sconosciuto}"
    echo "      Verifica endpoint: ${READY_RESULT}"
    echo "   ⏭️  Riutilizzo l'istanza esistente senza avviare un secondo server."
    QUIET_EXIT=1
    exit 0
fi

reset_next_cache_if_revision_changed

# @Codex: a free-port race or a mismatched server must never open the browser.
node "$HELPER" wait-and-open "$MEDIFLOW_URL" "$CURRENT_APP_SOURCE_FINGERPRINT" "$READY_TIMEOUT_MS" 250 &
READY_WAITER_PID=$!

echo "   📍 URL: ${MEDIFLOW_URL}"
echo "   ⏹️  Premi CTRL+C per arrestare."
echo ""

# Start Dev Server
MEDIFLOW_APP_REVISION="${CURRENT_APP_REVISION}" \
MEDIFLOW_APP_BRANCH="${CURRENT_APP_BRANCH}" \
MEDIFLOW_APP_WORKTREE_HASH="${CURRENT_APP_WORKTREE_HASH}" \
MEDIFLOW_APP_SOURCE_FINGERPRINT="${CURRENT_APP_SOURCE_FINGERPRINT}" \
MEDIFLOW_APP_FINGERPRINT="${CURRENT_APP_FINGERPRINT}" \
npm run dev
