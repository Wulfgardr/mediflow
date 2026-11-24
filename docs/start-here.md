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

La nota dell’ultima release indica i sistemi provati, i file da scaricare e come verificare l’installazione. Per avviare il Web dai sorgenti, usa Git per scaricare il tag indicato e seleziona Node 24. [Ultima release](https://github.com/Wulfgardr/mediflow/releases/latest) · [Avvio dai sorgenti](../README.md#provalo)

Il collaudo usa dati sintetici. Per l’uso clinico, il professionista o l’organizzazione responsabile valuta l’installazione e i flussi di lavoro.

Lo [stato del sistema](./STATE_OF_THE_SYSTEM.md) descrive l'implementazione;
il [CHANGELOG](../CHANGELOG.md) distingue la versione pubblicata dalle
modifiche successive.

## Le funzioni AI

Le funzioni AI sono facoltative: preparano sintesi e proposte da rivedere,
senza modificare automaticamente la cartella. Si usano solo modelli ammessi
dal sistema locale. I servizi esterni sono spenti per impostazione predefinita
e richiedono configurazione, consenso e controlli sui dati da inviare.

La [matrice AI](https://github.com/Wulfgardr/mediflow/blob/cd20934e20afaf37c283a18966ac5ea72b8d1a31/docs/ai-runtime-serving-matrix.md) riporta funzioni, prove e
limiti; [privacy e governance AI](https://github.com/Wulfgardr/mediflow/blob/cd20934e20afaf37c283a18966ac5ea72b8d1a31/docs/privacy-and-ai-governance.md) descrivono
le responsabilità d'uso.

## Per chi sviluppa

Il computer principale conserva il database e ospita i servizi. I client
agente usano comandi autenticati con permessi specifici, senza aprire
direttamente il database.

Per contribuire, consulta [architettura](../ARCHITECTURE.md),
[sicurezza](../SECURITY.md), [guida ai contributi](../CONTRIBUTING.md) e
contratto del componente. La [mappa della documentazione](./README.md)
indica il riferimento per ogni tema; le topologie dei
[dati](https://github.com/Wulfgardr/mediflow/blob/0652419dac144340a9340ee0d75ce89130941cec/docs/topologia-dati-flussi.md) e della [repository](./repository-topology.md)
descrivono flussi e organizzazione del codice.
