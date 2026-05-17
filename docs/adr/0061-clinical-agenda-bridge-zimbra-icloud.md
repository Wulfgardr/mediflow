<!-- Codex: WUL-275 -->
# ADR 0061: Clinical agenda bridge da Zimbra/iCloud

Date: 2026-05-16
Status: Accepted

Related: [ADR 0060](./0060-kree8-cockpit-live-root-entry.md),
[ADR 0057](./0057-local-evidence-absorption-layer.md)

## Problema

La nuova root Kree8 rende l'agenda clinica una superficie primaria, ma il
contenuto e ancora prevalentemente sintetico. Leonardo ha gia un
`zimbra-mail-assistant` locale con lettura calendario Carbonio/Zimbra e bridge
iCloud/EventKit; il valore prodotto e far emergere in MediFlow gli appuntamenti
clinici o FBF-correlati, senza importare tutto il calendario personale e senza
scansionare automaticamente tutta la posta.

Serve quindi una integrazione che sia utile subito ma rispettosa dei confini:
MediFlow deve vedere candidati reviewable, non creare eventi, non scrivere
schede paziente e non leggere payload email/allegati in modo opaco.

## Opzioni

1. Importare direttamente tutti gli eventi iCloud/Zimbra nella agenda MediFlow.
2. Lasciare Zimbra/iCloud fuori da MediFlow e usare solo export manuali `.ics`.
3. Leggere solo cache evento locali gia materializzate dal mail assistant,
   classificare candidati clinici/FBF e mostrarli come preview da rivedere.

## Trade-off

- Opzione 1:
  - Pro: massima copertura.
  - Contro: importa troppo, mescola personale e clinico, aumenta rischio PHI e
    crea una falsa idea di agenda certificata.
- Opzione 2:
  - Pro: rischio runtime minimo.
  - Contro: non valorizza il bridge gia esistente e lascia fuori dalla cockpit
    una parte operativa importante.
- Opzione 3:
  - Pro: locale, verificabile, review-first, senza scritture cliniche o
    creazione eventi.
  - Contro: nella prima slice dipende da cache aggiornate fuori da MediFlow e
    non fa ancora patient matching o deduplica persistente.

## Decisione

Adottiamo l'opzione 3.

MediFlow espone un bridge interno `clinicalAgendaCandidate.v1` che legge solo
file JSONL evento sotto `zimbra-mail-assistant/data/`:

- `icloud_calendar_events.jsonl` prodotto dal bridge iCloud/EventKit;
- `calendar_events.jsonl` prodotto dalla query read-only Carbonio/Zimbra.

La prima slice non invoca fetch live, non legge `messages.jsonl`, non legge
attachment OCR, non crea eventi iCloud/Zimbra e non scrive record clinici in
SQLite. Ogni elemento resta un candidato da rivedere.

La route e interna alla web app, protetta da sessione operatore e volutamente
non pubblicata come `/api/v1`: non e ancora un contratto per client paired o
terzi. Se in futuro il bridge diventera parte del data-plane home-base andra
promosso in un contratto versionato con OpenAPI, capability e scope espliciti.

Il classifier usa solo metadati evento minimali: titolo/oggetto, orario,
location, calendario/source. Note, frammenti email e corpi allegati restano
fuori da questo passaggio.

## First Thin Slice

1. Aggiungere un helper server-only per normalizzare eventi iCloud/Zimbra da
   cache JSONL locali.
2. Classificare candidati clinici/FBF con punteggio deterministico e motivi
   leggibili.
3. Esporre una route read-only session-protected per la cockpit Kree8.
4. Mostrare nella agenda live una preview compatta di candidati esterni, sempre
   distinta dagli eventi confermati.
5. Verificare con fixture sintetiche, senza dati reali.

## Fuori Scope

- Scansionare corpi email o allegati dal runtime MediFlow.
- Creare eventi in iCloud/Zimbra.
- Importare automaticamente appuntamenti in SQLite.
- Fare patient matching automatico.
- Dichiarare i candidati come ritorno certificato SISS/FSE o calendario
  regionale ufficiale.
