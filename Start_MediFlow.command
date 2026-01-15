#!/bin/bash
# Ottieni la directory dove si trova questo script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Fix PATH for macOS .command execution (Docker is usually in /usr/local/bin or /opt/homebrew/bin)
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"

# Messaggio di benvenuto
echo "==================================================="
echo "   Avvio di MediFlow - Cartella Clinica Personale"
echo "==================================================="
echo "Attendere prego..."

# Controlla se node_modules esiste, altrimenti installa
if [ ! -d "node_modules" ]; then
    echo "Prima esecuzione rilevata. Installazione dipendenze..."
    npm install
fi

# --- Servizio ICD-11 Locale ---

# Tentativo di localizzare il comando Docker in percorsi standard
DOCKER_CMD=""

# Lista di possibili percorsi per Docker su macOS
POSSIBLE_PATHS=(
    "docker"
    "/usr/local/bin/docker"
    "/opt/homebrew/bin/docker"
    "/Applications/Docker.app/Contents/Resources/bin/docker"
    "$HOME/.docker/bin/docker"
)

for path in "${POSSIBLE_PATHS[@]}"; do
    if command -v "$path" &> /dev/null; then
        DOCKER_CMD="$path"
        break
    elif [ -x "$path" ]; then
        DOCKER_CMD="$path"
        break
    fi
done

if [ -n "$DOCKER_CMD" ]; then
    echo "Docker trovato: $DOCKER_CMD"
    echo "Controllo servizio ICD-11 Locale..."
    
    # Verifica che il demone Docker sia raggiungibile
    if ! "$DOCKER_CMD" info > /dev/null 2>&1; then
        echo "⚠️  ATTENZIONE: Docker è installato ma NON sembra attivo!"
        echo "   Per favore apri l'app 'Docker Desktop' e attendi che si avvii."
        echo "   Il servizio ICD-11 verrà saltato per ora."
    else
        # Verifica se il container esistente ha la configurazione corretta (inglese, fallback)
        CONTAINER_CONFIG=$("$DOCKER_CMD" inspect icd-api)
        if [[ "$CONTAINER_CONFIG" != *"include=2024-01_en"* ]]; then
            echo "⚠️  Nota: La versione Italiana di ICD-11 non è attualmente disponibile sui server WHO."
            echo "🔄 Aggiornamento ICD-11 alla versione Inglese (v2024-01)..."
            "$DOCKER_CMD" rm -f icd-api > /dev/null
            
            echo "Avvio servizio ICD-11 EN (Richiederà un nuovo download, porta pazienza)..."
             "$DOCKER_CMD" run -d --name icd-api -p 8888:80 \
                -e acceptLicense=true \
                -e saveAnalytics=false \
                -e include=2024-01_en \
                --restart unless-stopped \
                whoicd/icd-api
        else 
             if [ ! "$("$DOCKER_CMD" ps -q -f name=icd-api)" ]; then
                if [ "$("$DOCKER_CMD" ps -aq -f name=icd-api)" ]; then
                    echo "Aggiornamento clean-up..."
                    "$DOCKER_CMD" rm icd-api > /dev/null
                fi
                echo "Avvio servizio ICD-11 (EN)..."
                 "$DOCKER_CMD" run -d --name icd-api -p 8888:80 -e acceptLicense=true -e saveAnalytics=false -e include=2024-01_en --restart unless-stopped whoicd/icd-api
             else
                echo "Servizio ICD-11 (EN) già attivo."
             fi
        fi


        # Attesa attiva del servizio (max 90 secondi)
        echo "Attesa inizializzazione ICD-11 (potrebbe richiedere circa 1 minuto)..."
        MAX_RETRIES=90
        BAR_SIZE=30
        
        for ((i=1; i<=MAX_RETRIES; i++)); do
            # Check connection using curl to ensure HTTP server is responding
            if curl -s -I http://localhost:8888 > /dev/null; then
                # Fill the rest of the bar to show completion
                PERCENT=100
                FILLED=$BAR_SIZE
                EMPTY=0
                BAR=$(printf "%0.s█" $(seq 1 $FILLED))
                echo -ne "\r[${BAR}] ${PERCENT}% - ✅ ICD-11 API è pronta!      "
                echo "" # Newline
                break
            fi

            # Calculate progress
            PERCENT=$(( i * 100 / MAX_RETRIES ))
            FILLED=$(( i * BAR_SIZE / MAX_RETRIES ))
            EMPTY=$(( BAR_SIZE - FILLED ))
            
            # Construct bar
            BAR=$(printf "%0.s█" $(seq 1 $FILLED))
            SPACES=$(printf "%0.s." $(seq 1 $EMPTY))
            
            echo -ne "\r[${BAR}${SPACES}] ${PERCENT}% - Avvio in corso..."
            sleep 1
        done
        
        if [ $i -gt $MAX_RETRIES ]; then
             echo ""
             echo "⚠️  Timeout: ICD-11 non ha risposto in tempo ($MAX_RETRIES s)."
             echo "    L'applicazione si avvierà comunque, ma la ricerca ICD-11 potrebbe non funzionare subito."
        fi
    fi
else
    echo "❌ ERRORE: Docker non trovato in nessun percorso standard."
    echo "   Percorsi controllati: ${POSSIBLE_PATHS[*]}"
    echo "   Il servizio ICD-11 Locale non sarà disponibile (verrà usato solo ICD-9)."
fi
# ------------------------------

# Apre il browser (dopo un breve ritardo per dare tempo al server)
# Apre il browser quando la porta 3000 è pronta
(
    echo "Attesa avvio interfaccia web..."
    for i in {1..60}; do
        if nc -z localhost 3000 &> /dev/null; then
            echo "✅ MediFlow attivo! Apertura browser..."
            sleep 1
            open "http://localhost:3000"
            exit 0
        fi
        sleep 1
    done
    echo "⚠️ Timeout attesa interfaccia web (apri manualmente http://localhost:3000)"
) &

# Avvia il server Next.js
npm run dev
