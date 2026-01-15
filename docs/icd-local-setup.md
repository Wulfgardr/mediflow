# Configurazione ICD-11 Local Deployment

Per abilitare la ricerca ICD-11 nell'applicazione (e abbandonare gradualmente ICD-9), è necessario eseguire il container ufficiale dell'OMS in locale.

## Requisiti
- **Docker Desktop** installato e attivo.
  - [Scarica Docker Desktop per Mac (Apple Silicon / Intel)](https://www.docker.com/products/docker-desktop/)
  - *Importante: Dopo l'installazione, apri l'app "Docker" e attendi che si avvii.*

## Istruzioni Rapide

1.  **Scarica e Avvia il Container**:
    Esegui questo comando nel terminale per avviare l'API locale. La prima volta scaricherà circa 500MB+ di dati.
    ```bash
    docker run -d --name icd-api -p 8888:80 --restart unless-stopped whoicd/icd-api
    ```
    *Nota: Assicurati che la porta 8888 sia libera.*

2.  **Verifica**:
    Apri il browser su [http://localhost:8888](http://localhost:8888). Dovresti vedere la pagina di benvenuto dell'API ICD.

3.  **Utilizzo in App**:
    L'applicazione "Medical Record" proverà automaticamente a connettersi a `http://localhost:8888`.
    - Se il container è attivo: Vedrai i codici **ICD-11** (badge blu).
    - Se il container è spento: Vedrai solo i codici **ICD-9** (badge arancioni "Legacy").

## Risoluzione Problemi
- **CORS Error**: Se riscontri errori di connessione dalla web app, potrebbe essere necessario configurare le intestazioni CORS nel container, ma solitamente il deployment locale è permissivo.
- **Porta Occupata**: Se la 8888 è usata, cambia il comando `-p 8889:80` e aggiorna `lib/icd-service.ts`.
