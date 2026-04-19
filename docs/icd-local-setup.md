# Setup locale ICD-11

Per usare ICD-11 in MediFlow (e ridurre l'uso di ICD-9 legacy), avvia il container OMS in locale.

Riferimenti correlati:
- [docs/walkthrough.md](./walkthrough.md)
- [docs/system_architecture.md](./system_architecture.md)
- [docs/README.md](./README.md)

## Requisiti

- **Docker Desktop** installato e in esecuzione.

  - [Scarica Docker Desktop (Apple Silicon / Intel)](https://www.docker.com/products/docker-desktop/)
  - *Importante: Dopo l'installazione, apri l'app "Docker" e attendi che si avvii.*

## Avvio rapido

1. **Avvia il container**
    Esegui questo comando nel terminale. Al primo avvio scarica circa 500MB+ di dati.

    ```bash
    docker run -d --name icd-api -p 8888:80 --restart unless-stopped whoicd/icd-api
    ```

    *Nota: verifica che la porta `8888` sia libera.*

2. **Verifica**
    Apri [http://localhost:8888](http://localhost:8888). Dovresti vedere la pagina di benvenuto dell'API ICD.

3. **Uso in app**

    MediFlow prova automaticamente a connettersi a `http://localhost:8888`.
    - Se il container è attivo: vedi i codici **ICD-11**.
    - Se il container è spento: restano disponibili solo i codici **ICD-9** legacy.

## Risoluzione problemi

- **Errore CORS**: se la web app non si connette, verifica la configurazione CORS del container (di solito il deployment locale è già permissivo).

- **Porta occupata**: se `8888` è già usata, cambia mapping (`-p 8889:80`) e aggiorna `lib/icd-service.ts`.
