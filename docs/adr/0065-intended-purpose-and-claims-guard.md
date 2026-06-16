# ADR 0065: Intended purpose e claims guard clinico

Date: 2026-05-24
Status: Accepted

[SECURITY.md](../../SECURITY.md),
[ARCHITECTURE.md](../../ARCHITECTURE.md),
ADR 0033 (private),
ADR 0039 (private),
[ADR 0045](./0045-siss-native-integration-boundary-requires-qualified-ssi.md),
[ADR 0046](./0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md),
[ADR 0051](./0051-patient-import-decision-contract-between-review-and-persistence.md),
[ADR 0057](./0057-local-evidence-absorption-layer.md)

## Problema

Le parole usate in documentazione, UI e copy pubblica possono spostare il
perimetro percepito di MediFlow prima ancora che cambi il codice. Claim ambigui
su AI, SISS/FSE, cloud, diagnosi, triage, prescrizione o automazione rischiano
di far sembrare il prodotto un motore autonomo, un prescrittore o una
integrazione regionale certificata.

## Intended purpose

MediFlow e una cartella clinica e workbench locale che aiuta il medico a
raccogliere, consultare, preparare e rivedere dati/documenti clinici cifrati sul
dispositivo. AI, Smart Import e Document Intelligence restano assistivi, locali
e review-first; i percorsi SISS/FSE restano handoff o webapp-assisted finche non
esiste un canale qualificato e documentato.

MediFlow non sostituisce il giudizio medico, non automatizza diagnosi o terapia,
non prescrive, non triagia in modo autonomo, non invia dati clinici a cloud di
default e non dichiara integrazione nativa SISS/FSE certificata fuori dal
perimetro ADR esistente.

## Claim consentiti

Sono consentiti, quando veri nello stato corrente del repo:

- `local-first`, `no cloud di default`, `dati locali`, `SQLite cifrato`,
  `zero-knowledge a riposo`;
- `supporto`, `workbench`, `reviewable`, `draft`, `candidate`, `fonte`,
  `provenance`, `handoff`, `webapp-assisted`;
- AI locale come supporto a sintesi, recupero fonti, Smart Import reviewable e
  benchmark, con limiti espliciti e kill-switch;
- SISS/FSE come contesto, corpus documentale, feasibility, handoff o percorso
  ufficiale aperto dall'operatore;
- export/preparazione documentale quando resta sotto controllo del medico e
  con validazione locale dichiarata.

## Claim esclusi

Sono vietati in copy di prodotto, UI/help, documentazione pubblica e README,
salvo citazione esplicita in un documento di policy o test negativo:

- diagnosi automatica, diagnostica autonoma o decisione clinica autonoma;
- triage automatico o decision support presentato come sostitutivo del medico;
- prescrizione automatica, invio ricette, NRE, writeback regionale o emissione
  ufficiale di prescrizioni da MediFlow;
- `SISS integrato`, `FSE sync`, `writeback FSE/SISS`, accesso diretto o
  integrazione certificata quando non formalizzati da ADR, canale qualificato e
  verifica;
- cloud AI, cloud sync, telemetry o upload di PHI/PII come default;
- auto-import clinico, auto-apply strutturato o accettazione silenziosa di
  output AI/documentali senza review, attore e audit trail.

## Frasi ambigue

`triage`, `diagnostico`, `prescrizione`, `integrazione SISS/FSE` e
`automazione` richiedono contesto preciso quando possono sembrare diagnosi,
invio regionale, sostituzione del medico o scrittura clinica autonoma.

## Decisione

Adottiamo un guard testuale repo-local, senza dipendenze nuove:

- comando: `npm run check:claims`;
- script: `scripts/check-claims-guard.mjs`;
- scope: documentazione prodotto/canonica, copy UI, help/onboarding e copy
  pubblica tenuti nel repo;
- metodo: regole mirate su frasi ad alto rischio, non parser semantico e non
  modello remoto;
- allowlist: esplicita, per file/rule/snippet, con rationale;
- fallimento: stampa `CLAIM-*`, file, riga, categoria e snippet.

Il guard non sostituisce review umana o valutazione regolatoria. Serve come
freno deterministico contro claim drift evidenti.

## Verifica

- `npm run check:claims`
- `npm run check:claims -- --self-test`

La verifica usa solo file del repo e stringhe sintetiche. Non legge database,
mail, allegati o materiale clinico privato.
