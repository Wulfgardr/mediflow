<!-- Codex: created 2026-03-18 -->
# ADR 0021: Terminology registry locale in `settings` JSON

Date: 2026-03-18
Status: Accepted

## Problema

MediFlow espone gia `systems/search/resolve` per alcune terminologie, ma lo
stato dei sistemi e delle versioni vive ancora in costanti statiche. Questo
non rende tracciabile quale versione sia attiva per export, validazione e
client futuri.

## Opzioni

1. Tenere tutto hardcoded nelle route terminologiche.
2. Introdurre subito una tabella SQLite dedicata.
3. Persistire un registry locale versionato nella chiave `settings`.

## Trade-off

- Opzione 1: zero lavoro schema, ma nessuna auditabilita o update controllato.
- Opzione 2: piu rigorosa, ma richiede migrazione e allarga inutilmente la
  first thin slice.
- Opzione 3: local-first, auditabile via `settings.updated`, nessuna migrazione
  e sufficiente per la governance attuale dei sistemi.

## Decisione

Adottiamo l'opzione 3.

- Il registry canonico vive in `settings.key = "terminologyRegistry"`.
- Ogni entry espone `system`, `display`, `version`, `source`, `status`,
  `updatedAt`, `notes`.
- `app/api/v1/terminology/systems` diventa la read surface canonica del
  registry effettivo.
- Gli update amministrativi passano dalla chiave `settings/terminologyRegistry`,
  gia coperta dall'audit `settings.updated`, senza cambiare `/api/v1`.

## Conseguenze

- Positivo: versioni attive leggibili e aggiornabili senza drift tra moduli.
- Positivo: nessuna nuova tabella o migrazione per la first slice.
- Negativo: il registry resta un blob JSON, non una struttura queryable a SQL.

## First Thin Slice

1. Introdurre helper server-side per default, merge, load e save del registry.
2. Far leggere a `systems/search/resolve` la versione attiva dal registry.
3. Riutilizzare `settings.updated` come canale auditabile per gli update.
4. Coprire sanitize/merge/version override con test isolati.
