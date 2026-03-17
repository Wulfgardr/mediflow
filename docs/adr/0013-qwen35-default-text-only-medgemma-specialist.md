<!-- Codex: created 2026-03-17 -->
# ADR 0013: Default text-only su qwen3.5:35b-a3b, MedGemma come opzione specialistica

Date: 2026-03-17  
Status: Accepted

Updates: `docs/adr/0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md` (solo scelta default text-only)

---

## Problema

La decisione precedente (ADR 0011) aveva consolidato `qwen2.5:32b` come default
text-only. Serve ora riallineare il default operativo a `qwen3.5:35b-a3b`,
mantenendo `medgemma` disponibile solo come scelta esplicita specialistica
medica e non come fallback/default implicito.

## Contesto

- `ARCHITECTURE.md` e `SECURITY.md` restano invariati: local-first, no egress cloud
  di default, logging PHI-safe.
- La pipeline OCR-first non cambia: OCR separato e task text-only separati.
- Il requisito operativo e ridurre ambiguita tra default runtime e modelli
  specialistici opzionali.

## Opzioni

1. Mantenere `qwen2.5:32b` come default e trattare `qwen3.5:35b-a3b` come preset opzionale.
2. Passare a `qwen3.5:35b-a3b` come default text-only e mantenere `medgemma` come opzione manuale specialistica.
3. Rendere `medgemma` fallback automatico sui task clinici text-only.

## Trade-off

- Opzione 1:
  - Pro: nessun cambiamento operativo.
  - Contro: non recepisce la nuova scelta di default richiesta.
- Opzione 2:
  - Pro: default univoco e aggiornato, `medgemma` resta disponibile per casi specialistici.
  - Contro: richiede riallineamento coerente su resolver/UI/documentazione.
- Opzione 3:
  - Pro: fallback medico sempre disponibile.
  - Contro: reintroduce ambiguita e confligge con la richiesta di default esplicito su Qwen.

## Decisione

Adottiamo l'opzione 2.

Regole operative:

- default text-only (clinico/reasoning) su `qwen3.5:35b-a3b`
- `medgemma` non e default e non e fallback implicito sui task text-only
- `medgemma` resta selezionabile manualmente come opzione specialistica medica
- OCR resta separato e invariato

Decisione approvata dal Lead Architect il 2026-03-17.

## Conseguenze

- Positivo: comportamento di default coerente e facilmente verificabile.
- Positivo: riduzione drift tra policy documentale e configurazioni runtime/UI.
- Positivo: `medgemma` resta disponibile dove utile senza guidare il path standard.
- Negativo: ambienti che dipendevano dal vecchio default devono riallineare eventuali setting legacy.

## First Thin Slice

1. Aggiornare default text-only web/macOS su `qwen3.5:35b-a3b`.
2. Mantenere `medgemma` in elenco modelli come opzione esplicita specialistica.
3. Aggiornare documentazione canonica (`walkthrough`, indice markdown, attribution).
