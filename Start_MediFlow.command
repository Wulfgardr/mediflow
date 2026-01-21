#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Fix PATH for Docker
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"

echo "==================================================="
echo "   Avvio di MediFlow (Docker Edition)"
echo "==================================================="

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker CLI non trovato."
    echo "   ➡️ Devi installare Docker Desktop da: https://www.docker.com/products/docker-desktop/"
    exit 1
fi

if ! docker info > /dev/null 2>&1; then
    echo "⚠️  ERRORE: Docker non sembra attivo."
    echo "   ➡️ Apri l'applicazione 'Docker Desktop' dal Launchpad e attendi che si avvii completamente."
    echo "   (Cerca l'icona della balena nella barra dei menu in alto)"
    exit 1
fi

echo "🚀 Avvio servizi (App, ICD-11, Ollama)..."
echo "   (La prima volta potrebbe richiedere minuti per scaricare tutto)"

# Start services detached
docker-compose up -d

echo ""
echo "✅ Servizi avviati in background!"
echo "   - App: http://localhost:3000"
echo "   - ICD: http://localhost:8888"
echo "   - AI:  http://localhost:11434"
echo ""

# Wait for URL availability
echo "Attesa disponibilità interfaccia..."
for i in {1..30}; do
    if curl -s -I http://localhost:3000 > /dev/null; then
        echo "Apertura browser..."
        open "http://localhost:3000"
        exit 0
    fi
    sleep 1
done

echo "⚠️  L'app ci sta mettendo un po' ad avviarsi. Prova ad aprire manualmente http://localhost:3000"
