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

Il gate verifica che `lib/domain/documents/document-synthesis-service.ts` scriva solo
`documentInsights`: una scrittura su `patients.diagnoses` da quel modulo fallisce in CI.

## Conseguenze

- La review clinica resta esplicita e verificabile.
- Le diagnosi proposte non diventano dati strutturati senza conferma.
- L'autofill ICD di ADR 0011 non e piu un comportamento runtime valido.
