#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "==================================================="
echo "   🏥 MediFlow - Avvio Completo"
echo "==================================================="
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

# --- 3. Start Next.js App ---
echo ""
echo "🚀 [3/3] Avvio Applicazione Next.js..."
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "🛑 Arresto in corso..."
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
