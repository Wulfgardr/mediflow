# ADR 0201: cancellare o svuotare una sede dal Web solo con il comando confermato

Date: 2026-11-25
Status: Accepted (decisione di Leonardo del 25/11/2026: si corregge dentro la 0.9.1)

Refs: WUL-961
Estende: [ADR 0169](./0169-gpui-ambulatory-destructive-commands.md). Contesto: [ADR 0200](./0200-web-standard-launcher-e-ritiro-app-desktop.md), PR #1114 (WUL-946).

## Problema

Dopo la PR #1114 un dispositivo abbinato cancella o svuota una sede solo con il comando confermato dell'ADR 0169. Il browser sul computer invece aveva ancora `DELETE /api/ambulatories/[id]` e `POST /api/ambulatories/clear`: bastava la sessione Web aperta, senza nuova autenticazione e senza mostrare prima che cosa sarebbe stato tolto. Con il Web come applicazione unica (ADR 0200) quella diventava la via principale per un'operazione che manda pazienti nel Cestino.

## Decisione

1. Da qualunque superficie una sede si cancella (`ambulatory.delete.v1`) o si svuota (`ambulatory.clear-test.v1`) solo con un comando confermato. Le due rotte host sono tolte; `db.ambulatories` non espone più `delete`, `bulkDelete` né `clear`.
2. Sul Web il comando ha due passi, entrambi con la sessione Web amministratore locale (loopback attestato, richiesta same-origin, generazione dell'archivio corrente):
   - `POST /api/ambulatories/commands/prepare` calcola nella stessa transazione IMMEDIATE il piano canonico dell'ADR 0169 e restituisce sede, conteggi (pazienti nel Cestino, pazienti che restano nelle altre sedi), sede predefinita successiva e un riferimento monouso valido 5 minuti. Un piano non ammissibile (pazienti o reparti collegati, ultima sede, predefinita ambigua, sede non di test, versione cambiata) è rifiutato con un codice e non lascia nulla in memoria.
   - `POST /api/ambulatories/commands/execute` riceve riferimento e PIN di conferma. Il server verifica il PIN dell'account della sessione (blocco dopo i tentativi falliti come all'accesso), poi nella stessa transazione IMMEDIATE ricontrolla sessione, ruolo, archivio e impronta del piano, esegue lo stesso core sincrono dell'ADR 0169 e pretende l'evento d'audit terminale con il proprio `requestId`. Senza audit la transazione non si chiude.
3. Il riferimento vale una volta e solo per la sessione che l'ha preparato. Un secondo invio, anche contemporaneo, è rifiutato senza effetti. Un PIN sbagliato non consuma il riferimento.
4. Scadenza: la verifica del PIN avviene nella stessa richiesta dell'esecuzione, quindi non c'è una sfida separata da far scadere. Se scade la preparazione, il piano cambia o il riferimento non esiste più, il server risponde senza scrivere e la pagina prepara di nuovo il piano e lo mostra: una nuova autorizzazione, mai uno stato bloccato (lezione di WUL-854).
5. Il Web non scrive nel registro terminale `ambulatory_destructive_commands`. Il registro serve al dispositivo abbinato per conoscere l'esito di un comando partito dalla rete; sul computer l'esito si legge ricaricando l'elenco delle sedi, e l'audit con `requestId` uguale all'identificativo del comando resta la traccia. Il formato dei backup non cambia.

## Conseguenze

- Una sola via distruttiva per le sedi. Il guard `scripts/ambulatory-audit-guard.test.mjs` fa fallire ogni nuovo chiamante dei core `deleteAmbulatoryInTransaction` e `clearAmbulatoryInTransaction` fuori dai due comandi confermati e ogni nuova rotta host di cancellazione o svuotamento.
- Prova nel repository: `lib/web-ambulatory-destructive-boundary.test.ts` fallisce su main (la sessione Web amministratore cancella e svuota con le rotte vecchie) e passa con la modifica; copre PIN sbagliato, sessione altrui, utente non amministratore, richiesta cross-site, archivio diverso, piano bloccato o cambiato, preparazione scaduta anche durante la verifica del PIN, doppio invio contemporaneo e audit che fallisce.
- Cancellare una sede richiede ora il ruolo amministratore anche sul Web, come per lo svuotamento e per il comando dell'ADR 0169.
- Se l'ADR 0200 ritira GPUI, il comando con login WebP3 dell'ADR 0169 resta per i dispositivi abbinati finché esistono client che lo usano; la via Web di questo ADR non dipende da GPUI.
