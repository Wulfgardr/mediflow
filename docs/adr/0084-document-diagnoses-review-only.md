# ADR 0084: diagnosi da documento solo review-only

Date: 2026-07-24
Status: Accepted

Supersedes: [ADR 0011](./0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md) solo per l'autofill di diagnosi da documento.

---

## Problema

Un output AI strutturato puo essere ambiguo o incompleto. Anche una diagnosi con
codice ICD esplicito resta una proposta clinica finche un operatore non la
conferma.

## Decisione

- La sintesi documentale conserva summary, evidenza e diagnosi proposte in
  `documentInsights`.
- Il servizio non aggiunge o aggiorna `patients.diagnoses` automaticamente.
- Ogni envelope con piu root JSON, oppure con un prefisso JSON ambiguo dopo il
  primo root, non e usabile.
- Un futuro apply richiede una lane contrattuale separata, un gesto esplicito
  dell'operatore e nuovi test di persistenza.

## Presidio

- script: `scripts/check-ai-clinical-write-gate.mjs` (`npm run check:ai-clinical-writes`).

Il gate scansiona il percorso Fabric e i moduli documentali: una scrittura clinica
non dichiarata, anche su `patients.diagnoses` o `therapies`, fallisce in CI.

Dal ritiro dei backend legacy senza caller runtime (WUL-774), la sintesi corrente
passa da `lib/ai-providers/fabric/document-synthesis-production-operation.ts` e
restituisce una proposta `reviewOnly`, `writesPerformed: 0`, `applyPolicy: none`.
Il contratto di output e il binding alle fonti sono verificati da
`document-synthesis-output-contract.test.ts` e
`document-synthesis-contract-regression.test.ts` nella stessa directory.
La prova di produzione conserva diagnosi, terapie e versione del paziente;
la validità corrente delle fonti resta governata dall'owner host.
`documentInsights` resta il formato delle proiezioni storiche, non un'autorizzazione
alla scrittura automatica delle diagnosi.

## Conseguenze

- La review clinica resta esplicita e verificabile.
- Le diagnosi proposte non diventano dati strutturati senza conferma.
- L'autofill ICD di ADR 0011 non e piu un comportamento runtime valido.
