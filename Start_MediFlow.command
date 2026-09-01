#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

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
        if "$candidate" "$DIR/scripts/launcher-helpers.mjs" check-runtime >/dev/null 2>&1; then
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
CURRENT_APP_REVISION="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
# @Codex
CURRENT_APP_BRANCH="$(git branch --show-current 2>/dev/null || echo unknown)"
# @Codex
CURRENT_APP_STATUS="$(git status --porcelain=v1 2>/dev/null)"
# @Codex
if [ -n "$CURRENT_APP_STATUS" ]; then
    CURRENT_APP_WORKTREE_HASH="$(printf '%s' "$CURRENT_APP_STATUS" | shasum -a 1 | awk '{print substr($1,1,12)}')"
else
    CURRENT_APP_WORKTREE_HASH="clean"
fi
# @Codex
CURRENT_APP_SOURCE_FINGERPRINT="${CURRENT_APP_BRANCH}@${CURRENT_APP_REVISION}:${CURRENT_APP_WORKTREE_HASH}"
# @Codex
CURRENT_APP_FINGERPRINT="${CURRENT_APP_SOURCE_FINGERPRINT}"
# @Codex
NEXT_CACHE_REVISION_FILE="$DIR/.next/.mediflow-app-revision"
# @Codex
PORT_LISTENER_PID=""
# @Codex
PORT_LISTENER_CWD=""
# @Codex
PORT_LISTENER_COMMAND=""
# @Codex
PORT_STATUS="free"

# /* @Codex */
find_port_listener_pid() {
    lsof -nP -iTCP:"$MEDIFLOW_PORT" -sTCP:LISTEN -Fp 2>/dev/null | sed -n 's/^p//p' | head -n 1
}

# @Codex
find_process_cwd() {
    local pid="$1"
    lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

# @Codex
find_process_command() {
    local pid="$1"
    ps -p "$pid" -o command= 2>/dev/null
}

# @Codex
fetch_running_revision() {
    curl -fsS "${MEDIFLOW_URL}/api/system/revision" 2>/dev/null | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("revision",""))' 2>/dev/null
}

# @Codex
fetch_running_source_fingerprint() {
    curl -fsS "${MEDIFLOW_URL}/api/system/revision" 2>/dev/null | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("sourceFingerprint",""))' 2>/dev/null
}

# @Codex
inspect_mediflow_port() {
    PORT_LISTENER_PID="$(find_port_listener_pid)"
    PORT_LISTENER_CWD=""
    PORT_LISTENER_COMMAND=""
    PORT_STATUS="free"

    if [ -z "$PORT_LISTENER_PID" ]; then
        return
    fi

    PORT_LISTENER_CWD="$(find_process_cwd "$PORT_LISTENER_PID")"
    PORT_LISTENER_COMMAND="$(find_process_command "$PORT_LISTENER_PID")"

    if [ "$PORT_LISTENER_CWD" = "$DIR" ]; then
        PORT_STATUS="mediflow_running"
    else
        PORT_STATUS="occupied_other"
    fi
}

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

echo "   🌿 Branch: ${CURRENT_APP_BRANCH}"
echo "   🧬 Revisione: ${CURRENT_APP_REVISION}"
echo "   🪪 Sorgente: ${CURRENT_APP_SOURCE_FINGERPRINT}"
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

inspect_mediflow_port
if [ "$PORT_STATUS" = "occupied_other" ]; then
    echo ""
    echo "   ❌ Porta ${MEDIFLOW_PORT} già occupata da un altro processo."
    echo "      PID: ${PORT_LISTENER_PID}"
    if [ -n "$PORT_LISTENER_COMMAND" ]; then
        echo "      Comando: ${PORT_LISTENER_COMMAND}"
    fi
    if [ -n "$PORT_LISTENER_CWD" ]; then
        echo "      Cartella: ${PORT_LISTENER_CWD}"
    fi
    echo "      Arresta quel processo oppure libera la porta ${MEDIFLOW_PORT} e rilancia MediFlow."
    exit 1
fi

# --- 2. Start Next.js App ---
echo ""
echo "🚀 [2/2] Avvio Applicazione Next.js..."
echo ""

# Cleanup function
cleanup() {
    if [ -n "${QUIET_EXIT:-}" ]; then
        exit 0
    fi
    echo ""
    echo "🛑 Arresto in corso..."
    echo "👋 MediFlow arrestato. A presto!"
    exit
}

trap cleanup SIGINT EXIT

if [ "$PORT_STATUS" = "mediflow_running" ]; then
    RUNNING_APP_REVISION="$(fetch_running_revision)"
    RUNNING_APP_SOURCE_FINGERPRINT="$(fetch_running_source_fingerprint)"
    if [ -z "$RUNNING_APP_SOURCE_FINGERPRINT" ] || [ "$RUNNING_APP_SOURCE_FINGERPRINT" != "$CURRENT_APP_SOURCE_FINGERPRINT" ]; then
        echo "   ♻️  Istanza MediFlow esistente ma non allineata alla revisione corrente."
        echo "      PID: ${PORT_LISTENER_PID}"
        echo "      Revisione in esecuzione: ${RUNNING_APP_REVISION:-sconosciuta}"
        echo "      Sorgente in esecuzione: ${RUNNING_APP_SOURCE_FINGERPRINT:-sconosciuta}"
        echo "      Sorgente richiesto: ${CURRENT_APP_SOURCE_FINGERPRINT}"
        echo "   🔄 Arresto l'istanza precedente per evitare UI ibride o bundle stantii..."
        kill "$PORT_LISTENER_PID" 2>/dev/null || true
        sleep 2
        inspect_mediflow_port
        if [ "$PORT_STATUS" != "free" ]; then
            echo "   ❌ Non sono riuscito a liberare la porta ${MEDIFLOW_PORT}. Arresta manualmente il processo e rilancia."
            exit 1
        fi
    else
        echo "   ✅ MediFlow risulta già attivo su ${MEDIFLOW_URL}"
        echo "      PID: ${PORT_LISTENER_PID}"
        echo "      Revisione: ${RUNNING_APP_REVISION}"
        echo "      Sorgente: ${RUNNING_APP_SOURCE_FINGERPRINT}"
        echo "   ⏭️  Riutilizzo l'istanza esistente senza avviare un secondo server."
        echo ""
        open "${MEDIFLOW_URL}"
        QUIET_EXIT=1
        exit 0
    fi
fi

reset_next_cache_if_revision_changed

# Open browser after delay
(sleep 5 && open "${MEDIFLOW_URL}") &

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
