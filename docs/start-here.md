# Inizia qui

MediFlow è un gestionale aperto e gratuito per cartelle cliniche, documenti
e attività ambulatoriali. Funziona anche senza intelligenza artificiale (AI).

## Il lavoro in cartella

Diario, diagnosi, terapie e misure raccolgono la storia del paziente.
I documenti originali permettono di consultare le fonti; checkup,
appuntamenti e attività aperte aiutano a organizzare i controlli successivi.

Il [README](../README.md) presenta le funzioni e l'avvio dai sorgenti.
Il [manuale](./MANUALE.md) descrive l'uso; il
[contratto di prodotto](../PRODUCT.md) ne precisa finalità e limiti.

## La versione disponibile

La [0.9.0](https://github.com/Wulfgardr/mediflow/releases/tag/v0.9.0) è
pubblicata come codice sorgente per l'applicazione Web locale e l'accesso
per agenti (Headless), con Node 24. App native e installer firmati non sono
inclusi. I profili supportati e le condizioni di avvio sono nel
[README del tag](https://github.com/Wulfgardr/mediflow/blob/v0.9.0/README.md#provalo) e nelle note della release.
Le prove su dati sintetici non autorizzano l'uso clinico: l'ammissione
spetta al professionista o all'organizzazione responsabile.

Lo [stato del sistema](./STATE_OF_THE_SYSTEM.md) descrive l'implementazione;
il [CHANGELOG](../CHANGELOG.md) distingue la versione pubblicata dalle
modifiche successive.

## Le funzioni AI

Le funzioni AI sono facoltative: preparano sintesi e proposte da rivedere,
senza modificare automaticamente la cartella. Si usano solo modelli ammessi
dal sistema locale. I servizi esterni sono spenti per impostazione predefinita
e richiedono configurazione, consenso e controlli sui dati da inviare.

La [matrice AI](./ai-runtime-serving-matrix.md) riporta funzioni, prove e
limiti; [privacy e governance AI](./privacy-and-ai-governance.md) descrivono
le responsabilità d'uso.

## Per chi sviluppa

Il computer principale conserva il database e ospita i servizi. I client
agente usano comandi autenticati con permessi specifici, senza aprire
direttamente il database.

Per contribuire, consulta [architettura](../ARCHITECTURE.md),
[sicurezza](../SECURITY.md), [guida ai contributi](../CONTRIBUTING.md) e
contratto del componente. La [mappa della documentazione](./README.md)
indica il riferimento per ogni tema; le topologie dei
[dati](./topologia-dati-flussi.md) e della [repository](./repository-topology.md)
descrivono flussi e organizzazione del codice.
