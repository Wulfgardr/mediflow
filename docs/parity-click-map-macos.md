<!-- Codex: created 2026-02-20 -->
# Checklist Click-Map macOS (Parity Sweep)

Stato documento: SECONDARY (checklist operativa)  
Ultimo aggiornamento: 2026-05-02

---

## Obiettivo

Validare i click-path principali macOS durante i parity sweep, con focus su:

1. raggiungibilita funzioni da UI
2. coerenza comportamento rispetto a web
3. assenza di blocchi operativi nei flussi core

Riferimenti:
- [docs/parity-matrix.md](./parity-matrix.md)
- [docs/native-testing.md](./native-testing.md)
- [PLANS.md](../PLANS.md) (`P0b`, `P1..P6`)

---

## Prerequisiti run

1. Backend locale avviato (`./Start_MediFlow.command`) oppure stack equivalente.
2. App macOS avviata (`./scripts/Launch_MediFlowMac.command`).
3. Sessione sbloccata con PIN.
4. Dataset test sintetico disponibile (almeno 1 paziente attivo + 1 archiviato).

---

## Pazienti - Lista e toolbar

- [ ] `patients-ambulatory-picker`: cambio ambulatorio e refresh lista coerente.
- [ ] `patients-status-filter`: switch `Attivi/Archiviati` coerente.
- [ ] `patients-search-field`: ricerca per nome/cognome/codice fiscale.
- [ ] `patients-sort-picker`: ordinamento `Recenti` e `A-Z`.
- [ ] `patients-new-button`: apertura form nuovo paziente.
- [ ] `patients-refresh-button`: ricarica senza errori.
- [ ] `patients-edit-button`: apre sheet modifica paziente selezionato.
- [ ] `patients-archive-button`: archivia/riattiva paziente selezionato.
- [ ] `patients-delete-button`: apre conferma elimina.

---

## Pazienti - Riga/context menu

- [ ] `patient-row-<id>`: selezione riga apre detail corretto.
- [ ] Context menu `Modifica`: apre editor paziente.
- [ ] Context menu `Archivia/Riattiva`: aggiorna stato e visibilita filtro.
- [ ] Context menu `Elimina`: conferma + rimozione dalla lista.

---

## Detail paziente - Azioni chiave

- [ ] `patient-detail-new-entry-button`: apertura nuova voce clinica.
- [ ] `patient-detail-new-therapy-button`: apertura nuova terapia.
- [ ] `patient-detail-new-checkup-button`: apertura nuovo appuntamento.
- [ ] `patient-detail-ai-studio-button`: apertura AI Studio.
- [ ] `patient-detail-entry-filter`: filtro diario funziona.
- [ ] `patient-detail-entry-show-deleted-toggle`: mostra/nasconde le voci diario eliminate.
- [ ] `patient-detail-entry-soft-delete-reason-field`: richiede motivo non vuoto per archiviazione voce diario.
- [ ] `patient-detail-entry-soft-delete-confirm-button`: archivia la voce diario senza hard delete.
- [ ] `patient-detail-entry-restore-action`: ripristina una voce diario tombstoned.
- [ ] `patient-detail-therapy-filter`: filtro terapie funziona.
- [ ] `patient-detail-checkup-filter`: filtro appuntamenti funziona.

---

## Scenario mirato WUL-22 - Esenzioni paziente

Stato codice: chiuso in `WUL-22` come selector/search/save nativo per esenzioni
in create/edit paziente via `/api/v1/exemptions`. Questa checklist resta
evidenza manuale `P6`; il catalogo Settings resta separato in `WUL-25`.

- [ ] Nuovo paziente: sezione `Esenzioni` visibile nel form.
- [ ] Nuovo paziente: ricerca per codice o descrizione restituisce opzioni dal catalogo.
- [ ] Nuovo paziente: selezione codice mostra chip e salva la scheda.
- [ ] Modifica paziente: codici esenzione esistenti vengono caricati correttamente.
- [ ] Modifica paziente: rimozione di tutti i codici persiste come lista vuota.
- [ ] Detail paziente: i codici salvati sono visibili dopo reload.

---

## Scenario mirato WUL-23 - Osservazioni LOINC/UCUM

Stato codice: chiuso in `WUL-23` come CRUD nativo LOINC/UCUM gia esposto e
coperto da test nativi. Questa checklist resta evidenza manuale `P6` da
rieseguire sul nuovo shell nativo prima della chiusura parity completa.

- [ ] `patient-detail-new-observation-button`: apre la sheet nuova osservazione.
- [ ] `observation-editor-loinc-picker`: selezione parametro LOINC coerente.
- [ ] `observation-editor-ucum-picker`: selezione unità UCUM coerente.
- [ ] `observation-editor-value-field`: inserimento valore senza errori UI.
- [ ] `observation-editor-date-picker`: data/ora modificabile.
- [ ] `observation-editor-notes-field`: note modificabili.
- [ ] `observation-editor-save-button`: create salva e ricarica la lista.
- [ ] `observation-row-<id>`: riga osservazione visibile nel detail.
- [ ] Menu riga osservazione `Modifica`: update persiste e riappare dopo reload detail.
- [ ] Menu riga osservazione `Elimina`: delete rimuove la riga dopo conferma/reload.

---

## Scenario mirato WUL-85 - Insight AI salvato da client native

- [ ] `patient-detail-ai-studio-button`: apre AI Studio.
- [ ] `patient-detail-ai-prompt-editor`: prompt clinico visibile e rigenerabile.
- [ ] `patient-detail-ai-save-button`: `Genera e salva insight` parte senza errore.
- [ ] `patient-detail-ai-response-output`: risposta generata visibile in studio.
- [ ] `patient-detail-ai-saved-summary`: summary salvato visibile nell'inline block dopo reload detail.
- [ ] `patient-detail-ai-error-message` / `patient-detail-ai-studio-error-message`: assenti nel percorso nominale.

---

## Esito run (da compilare)

- Data run:
- Operatore:
- Build/commit:
- Esito complessivo: `PASS` / `FAIL`
- Blocchi trovati:
- Note:

## Esito WUL-26

Closeout documentale eseguito il 2026-05-02.

- Run strict automatizzato post `WUL-25`/`WUL-76`/`WUL-77`: `PASS`
  (`tmp-parity-smoke/wul-26-20260502-post-module-closeout-rerun/summary.md`).
- Probe AX read-only: non applicabile alla vecchia shell clinica. Il probe cerca
  identificativi legacy (`patients-ambulatory-picker` ecc.), mentre `WUL-192`
  sposta l'entrypoint compilato verso Apple Foundation/home-base.
- Esito P6: non dichiarare `FULL` UI parity sul vecchio bundle macOS. I gap
  modulo-specifici legacy sono chiusi come code-satisfied; la verifica
  capability-by-capability va spostata sul nuovo filone Apple-native/home-base
  (`WUL-187`/`WUL-194`) invece di riaprire lo snapshot macOS congelato.
