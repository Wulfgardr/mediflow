# ADR 0197 · Contesto clinico locale temporaneo per l'agente

- Stato: accettato
- Data: 2026-11-23
- Collega: ADR 0190 (deposito clinico agente), ADR 0196 (collegamento locale in un clic)

## Contesto

Con ADR 0190 e ADR 0196 l'agente locale (oggi Codex con il kit `mf-ambulatorio-kit`, domani qualunque client locale autorizzato) deposita cassette cifrate in MediFlow senza mai aprire il database clinico né leggere la chiave maestra.

Durante una visita o la preparazione di un artefatto clinico (lettera al collega, promemoria per il paziente, relazione, quesito specialistico, certificato anamnestico), il medico può però voler mettere a disposizione dell'agente il quadro essenziale già presente nella scheda aperta di MediFlow (diagnosi, terapie, esenzioni, allergie, ultimi parametri, ultime note, checkup aperti), senza dover dettare tutto a mano e senza aprire una lettura arbitraria dell'archivio da parte dell'agente.

## Decisione

1. **Esportazione esplicita, avviata dal medico dalla scheda paziente.**
   - Dal menu azioni della scheda paziente Web sbloccata il medico può scegliere **Invia a Codex**.
   - Il browser già in possesso dei record decifrati costruisce un riassunto strutturato minimo (`mediflow.agent_patient_context.v1`) privo di nome, cognome, indirizzo, telefono e codice fiscale in chiaro: il paziente è indicizzato dal solo hash SHA-256 del codice fiscale (`cfHash`) e dalle ultime 4 cifre (`taxCodeLast4`) per il riscontro visivo.
2. **Boundary server loopback con stessi controlli del kit locale.**
   - `GET /api/agent-mandates/local-kit/context`: loopback attestato, sessione Web admin attiva, risposta con solo conteggio e metadati (`taxCodeLast4`, `exportedAt`, `expiresAt`), mai `cfHash` né testo clinico.
   - `POST /api/agent-mandates/local-kit/context`: loopback attestato, Web mutation headers, `x-mediflow-archive-generation` corrente, nessuna intestazione `Authorization`, collegamento kit locale attivo (`status.connected && status.active`). Verifica lo schema (`<= 128 KiB`), appone `exportedAt` e `expiresAt` (`+24 ore`), scrive atomicamente `0600` (`O_NOFOLLOW`) in `<kitPath>/contesto-pazienti/<cfHash>.json` dentro cartella `0700` fuori da cartelle sincronizzate (iCloud/Documents/Desktop/Downloads), e registra `agent.context.exported` nell'audit append-only. Se l'audit fallisce, il file appena scritto viene rimosso.
   - `DELETE /api/agent-mandates/local-kit/context`: svuota tutti i file di contesto nel kit e registra `agent.context.cleared`.
3. **Scadenza automatica e pulizia alla revoca.**
   - Ogni file scade dopo 24 ore ed è rimosso automaticamente sia in lettura/scrittura lato MediFlow sia lato kit.
   - Scollegare il kit locale (`DELETE /api/agent-mandates/local-kit`) elimina anche tutti i contesti paziente esportati.
4. **Portabilità verso altri agenti.**
   - Il formato `mediflow.agent_patient_context.v1` è un contratto JSON locale documentato, non legato a un singolo provider: qualsiasi client autorizzato che condivida la cartella locale del kit può leggere il contesto del singolo paziente inviato dal medico e comporre artefatti o preparare visite cifrate per MediFlow.

## Conseguenze

- L'agente non acquisisce mai accesso in lettura a `medical.db` né può enumerare l'archivio: vede soltanto il singolo paziente che il medico ha scelto di inviare in quella giornata.
- Il medico può svuotare in un clic tutti i contesti esportati da `Impostazioni · Agenti`.
- Il kit locale usa il contesto in automatico quando il medico apre una visita per lo stesso codice fiscale (senza mai esporre dati di altri pazienti) e consente di generare artefatti clinici anche a visita non aperta (`--da-contesto`).
