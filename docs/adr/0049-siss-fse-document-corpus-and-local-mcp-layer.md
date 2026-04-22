<!-- Codex: created 2026-04-14 -->
# ADR 0049: corpus documentale SISS/FSE locale e layer MCP solo sopra corpus approvato

Date: 2026-04-14  
Status: Accepted

## Problema

Per portare MediFlow verso integrazioni SISS/FSE piu profonde serve una base
documentale affidabile, locale e interrogabile.

Oggi la conoscenza tecnica e dispersa tra:

- portali pubblici SISS con URL legacy e stabilita variabile
- repository/documentazione nazionali FSE 2.0
- documenti riservati o autenticati non fetchabili in modo robusto
- memoria operativa e note sparse

Senza un corpus locale versionato, ogni decisione rischia drift, dipendenza da
scraping fragile e perdita di contesto tra sessioni/agenti.

## Contesto

- [docs/siss-baseline.md](../siss-baseline.md) chiarisce che MediFlow oggi non
  ha ancora una catena SISS certificata.
- [docs/fse-gtw-baseline-alignment.md](../fse-gtw-baseline-alignment.md)
  distingue gia il baseline ufficiale FSE 2.0 dai gap reali del prodotto.
- [AGENTS.md](../../AGENTS.md) richiede diff piccoli, branch per workstream e
  decisioni persistenti scritte su disco.
- Il repository possiede gia un pattern utile per MCP documentali di sviluppo:
  [docs/apple-docs-mcp.md](../apple-docs-mcp.md).

## Opzioni

1. Continuare con fetch live ad hoc da web search/portali durante ogni task.
2. Salvare nel repository l intero corpus scaricato.
3. Versionare in repo solo catalogo sorgenti, decisioni e tooling, mantenendo il
   corpus reale in storage locale ignorato da Git; introdurre un MCP solo dopo.

## Trade-off

- Opzione 1:
  - Pro: zero setup iniziale.
  - Contro: massima fragilita, scarsa ripetibilita, nessuna governance su fonti
    riservate o versioni.
- Opzione 2:
  - Pro: massima portabilita del corpus.
  - Contro: repository pesante, rischio licenze/redistribuzione, conflitto con
    documenti autenticati o non pubblicabili.
- Opzione 3:
  - Pro: separa bene tooling, sorgenti approvate e storage reale; supporta sia
    fetch pubblico sia import manuale controllato; evita di confondere il repo
    applicativo con un archivio documentale.
  - Contro: richiede una disciplina esplicita su output locale e refresh del
    corpus; l MCP non e immediato.

## Decisione

Adottiamo l opzione 3.

MediFlow introduce:

- un manifest versionato in repo con le sorgenti SISS/FSE approvate
- un fetcher locale che salva snapshot in una directory ignorata da Git
- placeholder espliciti per i documenti solo `manual-import` o `auth-gated`
- un runbook canonico per mantenere il corpus

Il layer MCP locale e ammesso solo dopo che esiste gia un corpus utile,
approvato e versionato a livello di manifest. L MCP non fara scraping live dei
portali regionali come sorgente primaria.

## Conseguenze

Positive:

- le fonti ufficiali diventano tracciabili e ripetibili
- la documentazione riservata puo essere referenziata senza essere committata
- Codex/agent futuri possono lavorare su un catalogo stabile prima ancora dell
  MCP

Negative:

- il primo slice non offre ancora una ricerca semantica avanzata
- serve manutenzione intenzionale del manifest quando cambiano URL o versioni

## First Thin Slice

1. Aggiungere ADR e runbook del corpus documentale SISS/FSE.
2. Versionare un manifest iniziale delle sorgenti ufficiali e dei placeholder
   manuali.
3. Aggiungere comandi `validate` e `fetch` che popolano `tmp/siss-docs-corpus`.
4. Rimandare il server MCP locale a una slice successiva, sopra il corpus gia
   approvato.

## Fuori Scope

- integrazione runtime SISS/FSE nel prodotto
- scraping aggressivo o bypass di autenticazioni regionali
- redistribuzione in Git di documenti riservati
- indicizzazione full-text avanzata o embedding del corpus
- MCP server vero e proprio
