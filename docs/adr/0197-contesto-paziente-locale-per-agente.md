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
   - I testi che il medico ha scritto nella scheda (titoli e testi delle note, descrizioni delle diagnosi, farmaci e posologie, allergie e reazioni, parametri, esenzioni, titoli e stati dei controlli aperti) passano, prima di essere scritti nel file del kit, dalla stessa redazione deterministica dell'ADR 0194 (`createRedactionSession` con i valori noti di `identityKnowledge`): nome, cognome, codice fiscale, data di nascita, indirizzo, telefono e caregiver dell'anagrafica diventano segnaposto `[[MF_…]]`, insieme ai codici fiscali, ai telefoni e alle email che la redazione riconosce dalla forma. Le date cliniche restano in chiaro, come nei campi strutturati: il kit non ha la sessione per ricostruire gli scostamenti. La redazione gira nella rotta `POST` (usa `node:crypto`, non il browser): il browser manda accanto al contesto i soli valori dell'anagrafica, che la rotta usa per la redazione e non scrive. La rotta rifiuta un contesto senza anagrafica, o con un codice fiscale il cui hash non è `cfHash`. Il file del kit non cambia forma.
   - Le note restano nel contesto, ripulite (decisione di Leonardo del 26/11/2026). L'avviso che conferma il gesto dice il limite: «Contesto pronto in Codex per 24 ore. Nelle note restano i nomi di chi non è in anagrafica.»
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

Prova: `lib/security/agent-local-kit-context-http.test.ts`, «Invia a Codex: identity written in notes...», costruisce il contesto con il builder e il client veri, lo spedisce alla rotta su loopback e legge i byte del file nel kit. Su main escono nome, cognome, codice fiscale, indirizzo, telefono e caregiver; con la redazione nessuno, in maiuscolo, minuscolo, con spazi doppi o con la punteggiatura.

Limiti che restano:

- Il nome di un terzo che non è in anagrafica (un familiare, una vicina, un collega citati in una nota) esce in chiaro: qui non c'è il livello neurale, come per la chat dell'ADR 0194. Esce anche un recapito del terzo che la redazione non riconosce dalla forma.
- È pseudonimizzazione, non anonimizzazione: il contesto clinico, le date e `cfHash` possono bastare a riconoscere la persona.
- `cfHash` è lo SHA-256 del codice fiscale senza segreto: con `taxCodeLast4` e `birthYear` si ricostruisce per tentativi. Va sostituito con un riferimento che chi legge il file non può invertire (WUL-967).

- L'agente non acquisisce mai accesso in lettura a `medical.db` né può enumerare l'archivio: vede soltanto il singolo paziente che il medico ha scelto di inviare in quella giornata.
- Il medico può svuotare in un clic tutti i contesti esportati da `Impostazioni · Agenti`.
- Il kit locale usa il contesto in automatico quando il medico apre una visita per lo stesso codice fiscale (senza mai esporre dati di altri pazienti) e consente di generare artefatti clinici anche a visita non aperta (`--da-contesto`).
