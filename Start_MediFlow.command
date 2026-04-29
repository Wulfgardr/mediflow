#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

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
echo "🤖 [1/3] Controllo AI Engine (Ollama)..."
if ! pgrep -x "ollama" > /dev/null; then
    echo "   ⚠️  Ollama non attivo. Avvio in corso..."
    if command -v ollama &> /dev/null; then
        ollama serve &
        echo "   ✅ Ollama avviato."
        sleep 3
    else
        echo "   ❌ Ollama non trovato. Installa da https://ollama.com"
    fi
else
    echo "   ✅ Ollama già attivo."
fi

# --- 2. Start ICD-11 API (Docker) ---
echo ""
echo "🩺 [2/3] Controllo ICD-11 API (Docker)..."
if command -v docker &> /dev/null; then
    # Check if container is running
    if docker ps --format '{{.Names}}' | grep -q 'mediflow-icd'; then
        echo "   ✅ ICD-11 API già attivo (porta 8888)."
    else
        echo "   ⚠️  ICD-11 non attivo. Avvio container..."
        docker compose up -d icd-api 2>/dev/null || docker-compose up -d icd-api 2>/dev/null
        if [ $? -eq 0 ]; then
            echo "   ✅ ICD-11 API avviato (porta 8888)."
        else
            echo "   ⚠️  Impossibile avviare ICD-11. Le diagnosi non funzioneranno."
        fi
    fi
else
    echo "   ⚠️  Docker non installato. Le diagnosi ICD-11 non saranno disponibili."
    echo "      Per abilitarle: installa Docker Desktop e rilancia."
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

# --- 3. Start Next.js App ---
echo ""
echo "🚀 [3/3] Avvio Applicazione Next.js..."
echo ""

# Cleanup function
cleanup() {
    if [ -n "${QUIET_EXIT:-}" ]; then
        exit 0
    fi
    echo ""
    echo "🛑 Arresto in corso..."
    # Optional: stop ICD container on exit to save resources
    # docker compose stop icd-api 2>/dev/null
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
