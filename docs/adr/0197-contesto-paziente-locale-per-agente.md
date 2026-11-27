# ADR 0197 · Contesto clinico locale temporaneo per l'agente

- Stato: accettato
- Data: 2026-11-23
- Collega: ADR 0190 (deposito clinico agente), ADR 0196 (collegamento locale in un clic)
- Aggiornato: 2026-11-27, riferimento del paziente con segreto del collegamento (WUL-967)

## Contesto

Con ADR 0190 e ADR 0196 l'agente locale (oggi Codex con il kit `mf-ambulatorio-kit`, domani qualunque client locale autorizzato) deposita cassette cifrate in MediFlow senza mai aprire il database clinico né leggere la chiave maestra.

Durante una visita o la preparazione di un artefatto clinico (lettera al collega, promemoria per il paziente, relazione, quesito specialistico, certificato anamnestico), il medico può però voler mettere a disposizione dell'agente il quadro essenziale già presente nella scheda aperta di MediFlow (diagnosi, terapie, esenzioni, allergie, ultimi parametri, ultime note, checkup aperti), senza dover dettare tutto a mano e senza aprire una lettura arbitraria dell'archivio da parte dell'agente.

## Decisione

1. **Esportazione esplicita, avviata dal medico dalla scheda paziente.**
   - Dal menu azioni della scheda paziente Web sbloccata il medico può scegliere **Invia a Codex**.
   - Il browser già in possesso dei record decifrati costruisce un riassunto strutturato minimo (`mediflow.agent_patient_context.v2`) privo di nome, cognome, indirizzo, telefono, anno di nascita e codice fiscale in chiaro. Del paziente il browser manda solo le ultime 4 cifre del codice fiscale (`taxCodeLast4`), per il riscontro visivo, e l'indicatore ADI.
   - I testi che il medico ha scritto nella scheda (titoli e testi delle note, descrizioni delle diagnosi, farmaci e posologie, allergie e reazioni, parametri, esenzioni, titoli e stati dei controlli aperti) passano, prima di essere scritti nel file del kit, dalla stessa redazione deterministica dell'ADR 0194 (`createRedactionSession` con i valori noti di `identityKnowledge`): nome, cognome, codice fiscale, data di nascita, indirizzo, telefono e caregiver dell'anagrafica diventano segnaposto `[[MF_…]]`, insieme ai codici fiscali, ai telefoni e alle email che la redazione riconosce dalla forma. Le date cliniche restano in chiaro, come nei campi strutturati: il kit non ha la sessione per ricostruire gli scostamenti. La redazione gira nella rotta `POST` (usa `node:crypto`, non il browser): il browser manda accanto al contesto i soli valori dell'anagrafica, che la rotta usa per la redazione e non scrive. La rotta rifiuta un contesto senza anagrafica, con ultime 4 cifre diverse dal codice fiscale dell'anagrafica, o con un riferimento o un anno di nascita portati dal browser.
   - **Riferimento del paziente.** Il campo `patient.cfHash` lo scrive la rotta: `HMAC-SHA256(segreto, codice fiscale normalizzato)`, 64 caratteri esadecimali, che danno anche il nome del file. Il segreto (32 byte casuali) sta nell'impostazione `agent.localKitPatientReferenceKey` e nel kit in `riferimento-pazienti.json` accanto a `deposito.json`, con permessi `0600`. Nasce al «Collega» dell'ADR 0196; per un kit già collegato senza segreto nasce al primo «Invia a Codex». Una sola funzione calcola il riferimento (`patientReference` dello store del kit locale): in una transazione `IMMEDIATE` verifica che il kit sia collegato e attivo, crea il segreto se manca, lo salva e lo scrive nel kit (svuotando i contesti se il file nel kit è assente o diverso). Se la scrittura nel kit fallisce la transazione si annulla, non resta un segreto a metà, il contesto non esce e la rotta risponde `409 LOCAL_KIT_RECONNECT`; il medico legge «Impossibile scrivere nella cartella del kit di Codex.». Il browser non calcola riferimenti. Non c'è ripiego sullo SHA-256. Il nome del campo resta `cfHash` per non cambiare i lettori del kit; lo schema passa a `v2` perché il significato cambia, e un kit che conosce solo `v1` ignora i file `v2` invece di confrontarli con lo SHA-256. Non c'è migrazione: i contesti scadono in 24 ore e il cambio di segreto svuota i contesti.
   - Le note restano nel contesto, ripulite (decisione di Leonardo del 26/11/2026). L'avviso che conferma il gesto dice il limite: «Contesto pronto in Codex per 24 ore. Nelle note restano i nomi di chi non è in anagrafica.»
2. **Boundary server loopback con stessi controlli del kit locale.**
   - `GET /api/agent-mandates/local-kit/context`: loopback attestato, sessione Web admin attiva, risposta con solo conteggio e metadati (`taxCodeLast4`, `exportedAt`, `expiresAt`), mai `cfHash` né testo clinico.
   - `POST /api/agent-mandates/local-kit/context`: loopback attestato, Web mutation headers, `x-mediflow-archive-generation` corrente, nessuna intestazione `Authorization`, collegamento kit locale attivo (`status.connected && status.active`). Verifica lo schema (`<= 128 KiB`), appone `exportedAt` e `expiresAt` (`+24 ore`), scrive atomicamente `0600` (`O_NOFOLLOW`) in `<kitPath>/contesto-pazienti/<cfHash>.json` dentro cartella `0700` fuori da cartelle sincronizzate (iCloud/Documents/Desktop/Downloads), e registra `agent.context.exported` nell'audit append-only con il riferimento come `subject_ref`. Se l'audit fallisce, il file appena scritto viene rimosso.
   - `DELETE /api/agent-mandates/local-kit/context`: svuota tutti i file di contesto nel kit e registra `agent.context.cleared`.
3. **Scadenza automatica e pulizia alla revoca.**
   - Ogni file scade dopo 24 ore ed è rimosso automaticamente sia in lettura/scrittura lato MediFlow sia lato kit.
   - Scollegare il kit locale (`DELETE /api/agent-mandates/local-kit`) elimina anche tutti i contesti paziente esportati e il segreto, nel kit e in MediFlow. Collegarlo di nuovo crea un segreto nuovo e svuota i contesti. Scollegare revoca anche l'agente: le visite che aveva depositato e non ancora applicate restano bloccate («L'accesso dell'agente che ha depositato la visita è stato revocato.»). Per questo l'aggiornamento al riferimento con segreto non chiede di ricollegare il kit.
   - Il segreto è una chiave riservata della politica delle impostazioni (`isServerOnlySetting`): `GET /api/settings/[key]` risponde `404`, la rotta generica non ha lettura di elenco e nessuna scrittura HTTP generica lo può impostare.
4. **Portabilità verso altri agenti.**
   - Il formato `mediflow.agent_patient_context.v1` è un contratto JSON locale documentato, non legato a un singolo provider: qualsiasi client autorizzato che condivida la cartella locale del kit può leggere il contesto del singolo paziente inviato dal medico e comporre artefatti o preparare visite cifrate per MediFlow.

## Conseguenze

Prova del riferimento: `lib/security/agent-local-kit-context-http.test.ts`, i tre casi «Invia a Codex: the kit file, its name and the audit carry the keyed reference...», «...without the secret no context is written...» e «...disconnecting and reconnecting the kit changes the secret...». Su main il kit non riceve alcun segreto e la rotta scrive il file con lo SHA-256 anche quando il segreto manca; qui il file, il suo nome e l'audit portano solo l'HMAC, lo stesso codice fiscale (anche in minuscolo o con spazi) dà lo stesso riferimento, un segreto nuovo ne dà uno diverso.

Prove del segreto creato al primo invio, nello stesso file: «a kit connected before the secret existed gets it on the first export...», «two concurrent first exports create one secret», «if the secret cannot be written in the kit, no secret is kept...». `lib/security/agent-local-kit-pending-visits.test.ts`: una visita depositata dal kit collegato resta applicabile dopo che il primo invio crea il segreto; dopo scollega e ricollega non lo è più. `lib/security/agent-local-kit-reference-secret-read.test.ts`: dopo un collegamento nessuna lettura per chiave delle impostazioni restituisce il segreto.

Prova della redazione: `lib/security/agent-local-kit-context-http.test.ts`, «Invia a Codex: identity written in notes...», costruisce il contesto con il builder e il client veri, lo spedisce alla rotta su loopback e legge i byte del file nel kit. Su main escono nome, cognome, codice fiscale, indirizzo, telefono e caregiver; con la redazione nessuno, in maiuscolo, minuscolo, con spazi doppi o con la punteggiatura.

Limiti che restano:

- Il nome di un terzo che non è in anagrafica (un familiare, una vicina, un collega citati in una nota) esce in chiaro: qui non c'è il livello neurale, come per la chat dell'ADR 0194. Esce anche un recapito del terzo che la redazione non riconosce dalla forma.
- È pseudonimizzazione, non anonimizzazione: il contesto clinico e le date possono bastare a riconoscere la persona.
- Il segreto sta nella stessa cartella del kit che contiene i contesti: chi copia l'intera cartella può confermare un codice fiscale che già conosce. Il riferimento protegge il singolo file letto dal modello o da un altro client, non la cartella intera.
- Il segreto sta nel backup di recupero, che copia l'intero archivio con le impostazioni. Non sta nel backup portabile `.mediflow` né in quello pianificato, che esportano le collezioni cliniche senza la tabella `settings`. Un archivio ripristinato ha un'altra generazione: il kit risulta scollegato e il nuovo collegamento crea un segreto nuovo.

- L'agente non acquisisce mai accesso in lettura a `medical.db` né può enumerare l'archivio: vede soltanto il singolo paziente che il medico ha scelto di inviare in quella giornata.
- Il medico può svuotare in un clic tutti i contesti esportati da `Impostazioni · Agenti`.
- Il kit locale usa il contesto in automatico quando il medico apre una visita per lo stesso codice fiscale (senza mai esporre dati di altri pazienti) e consente di generare artefatti clinici anche a visita non aperta (`--da-contesto`).
