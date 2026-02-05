#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "==================================================="
echo "   🏥 MediFlow - Avvio Completo"
echo "==================================================="
echo ""

# @Codex
WATCHDOG_PID=""

# --- 1. Start Ollama (AI Engine) ---
echo "🤖 [1/4] Controllo AI Engine (Ollama)..."
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
echo "🩺 [2/4] Controllo ICD-11 API (Docker)..."
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

# /* @Codex */
# --- 3. Optional: Start Native App ---
echo ""
echo "🖥️  [3/4] Avvio App Nativa (opzionale)..."
read -r -p "   Vuoi avviare anche l'app nativa macOS? [y/N] " START_NATIVE
if [[ "$START_NATIVE" =~ ^[Yy]$ ]]; then
    echo "   🚧 Avvio app nativa in corso..."
    if "$DIR/scripts/Launch_MediFlowMac.command"; then
        echo "   ✅ App nativa avviata."
        # @Codex
        if [ -x "$DIR/scripts/native-watchdog.sh" ]; then
            "$DIR/scripts/native-watchdog.sh" &
            WATCHDOG_PID=$!
            echo "   👀 Watchdog app nativa attivo."
        else
            echo "   ⚠️  Watchdog non trovato. Nessun riavvio automatico."
        fi
    else
        echo "   ⚠️  Avvio app nativa fallito. Controlla gli script in /scripts."
    fi
else
    echo "   ⏭️  App nativa non avviata."
fi

# --- 4. Start Next.js App ---
echo ""
echo "🚀 [4/4] Avvio Applicazione Next.js..."
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "🛑 Arresto in corso..."
    # @Codex
    if [ -n "${WATCHDOG_PID:-}" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
        kill "$WATCHDOG_PID" 2>/dev/null
    fi
    # Optional: stop ICD container on exit to save resources
    # docker compose stop icd-api 2>/dev/null
    echo "👋 MediFlow arrestato. A presto!"
    exit
}

trap cleanup SIGINT EXIT

# Open browser after delay
(sleep 5 && open "http://localhost:3000") &

echo "   📍 URL: http://localhost:3000"
echo "   ⏹️  Premi CTRL+C per arrestare."
echo ""

# Start Dev Server
npm run dev
