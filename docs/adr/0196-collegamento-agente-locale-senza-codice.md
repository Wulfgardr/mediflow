# ADR 0196: Collegamento dell'agente locale sullo stesso Mac senza codice

Data: 2026-11-21

Stato: **Accettato** da Leonardo il 21/11/2026. Riferimenti: WUL-939,
[ADR 0190](0190-mandato-agenti-e-cassetta-della-visita.md),
[ADR 0193](0193-egress-clinico-controllato-dal-server.md),
[ADR 0195](0195-materiale-dell-agente-dopo-il-gesto-del-medico.md).

## Problema

L'[ADR 0190](0190-mandato-agenti-e-cassetta-della-visita.md) prevede che ogni
agente chieda un abbinamento con codice di otto caratteri e che il medico lo
confronti e approvi in Impostazioni → Agenti, per poi completare lo scambio dal
client. Quel confronto serve quando chi richiede l'abbinamento e chi lo approva
operano in processi o su macchine distinte.

Quando Codex e MediFlow girano sullo stesso Mac, sotto lo stesso utente macOS,
il passaggio con codice impone quattro scambi fra chat e browser per un gesto
che il medico compie gia dentro MediFlow sbloccato.

## Decisione

1. **Collegamento diretto sullo stesso Mac senza codice.** In MediFlow
   sbloccato (sessione Web admin su loopback attestato, con conferma PIN e
   intestazioni di mutazione fidata), il medico puo collegare il kit locale
   «Codex · Ambulatorio» con una sola conferma che mostra fornitore, consenso
   all'uscita dei documenti e trascrizioni ed elenco delle operazioni. Il
   confronto del codice di otto caratteri non serve perche la richiesta nasce
   direttamente nella UI fidata dello stesso utente macOS e MediFlow scrive le
   credenziali direttamente nella cartella locale configurata, senza alcuna
   richiesta esterna non autenticata da legare al gesto. Il flusso con codice
   dell'ADR 0190 resta disponibile per client su altre macchine o configurazioni
   manuali.
2. **Destinazione configurabile e confini del filesystem.** Il percorso della
   cartella del kit e salvato nell'impostazione `agent.localKitPath` (default
   `/Users/<utente>/Antigravity/mf-ambulatorio-kit`), modificabile soltanto
   dalla rotta autenticata `/api/agent-mandates/local-kit` e negata sulla rotta
   generica `/api/settings`. Prima di leggere o scrivere, il server verifica che
   la cartella del kit esista, sia una directory reale di proprieta dell'utente
   corrente, non sia un collegamento simbolico e non ricada in cartelle
   sincronizzate (`Documents`, `Desktop`, `Downloads`, `Library/Mobile Documents`,
   `Library/CloudStorage`). La cartella delle credenziali indicata dal campo
   `credenziali` di `deposito.json` (o `<kit>/.agente` se assente) deve restare
   strettamente dentro la cartella configurata del kit, senza alcun segmento
   simbolico. Nessuna scrittura avviene fuori dalla cartella configurata.
3. **Formato dei file e permessi.**
   - La cartella delle credenziali viene creata o verificata con permessi `0700`,
     di proprieta dell'utente e non collegamento simbolico.
   - MediFlow scrive atomicamente (file temporaneo con
     `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW`, permessi `0600`, `fsync` e
     `rename`) sia `<agentRef>.json` (`agentRef`, `mandateRef`, `token`
     `mfa_...`, `expiresAt`, `origin`) per l'uso immediato, sia
     `<agentRef>.registration.json` (`agentRef`, `token` `mfr_...`, `origin`)
     per il rinnovo automatico allo sblocco. Il formato coincide con quello gia
     letto da `packages/agent-client` e da `visita.py` (`read_agent_access`).
   - `deposito.json` viene letto con `O_NOFOLLOW` e riscritto atomicamente
     aggiornando soltanto il campo `agente` (`agentRef` al collegamento, `null`
     allo scollegamento) e preservando invariati tutti gli altri campi.
4. **Mandato, rinnovo e assenza di segreti nei log.** In una sola transazione
   SQLite `IMMEDIATE` il server crea il mandato iniziale di 12 ore, la
   registrazione rinnovabile allo sblocco e il client attivo per l'uso immediato.
   I token `mfa_...` e `mfr_...` non compaiono mai nelle risposte HTTP, nei log
   o nell'audit. Se la scrittura dei file nella cartella del kit fallisce, il
   mandato e la registrazione appena creati vengono revocati prima di rispondere.
   Ad ogni sblocco successivo il rinnovo segue le stesse regole dell'ADR 0190.
   L'ingresso dei contenuti clinici resta vincolato al gesto del medico secondo
   l'[ADR 0195](0195-materiale-dell-agente-dopo-il-gesto-del-medico.md).
5. **Audit.** La creazione registra `agent.mandate.created` e
   `agent.client.registered` nella stessa transazione. La revoca registra
   `agent.client.revoked` e `agent.mandate.revoked` nella stessa transazione.
   L'aggiornamento della cartella del kit registra `settings.updated`.
6. **Revoca («Scollega»).** Lo scollegamento revoca in transazione la
   registrazione, il client attivo e i mandati associati (iniziale e corrente),
   rendendo immediatamente inutilizzabili sia il token di accesso sia la
   credenziale di rinnovo anche se copiati altrove prima della revoca. Rimuove
   inoltre `<agentRef>.json` e `<agentRef>.registration.json` dalla cartella
   configurata (senza seguire collegamenti simbolici) e imposta `agente: null`
   in `deposito.json`.

## Prove

`lib/security/agent-local-kit-files.test.ts` (permessi `0700`/`0600`,
preservazione dei campi di `deposito.json`, compatibilita con
`packages/agent-client`, rifiuto di cartella inesistente, collegamenti
simbolici, cartelle sincronizzate e `credenziali` fuori dal kit) e
`lib/security/agent-local-kit-http.test.ts` (sessione bloccata, PIN errato,
assenza di token in risposta, audit di creazione e revoca, rinnovo allo sblocco,
revoca che invalida le credenziali).
