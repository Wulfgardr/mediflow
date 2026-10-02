---
summary: "Indice dei rapporti pubblici e sanitizzati di audit di sicurezza MediFlow."
read_when:
  - "Valutare una correzione di sicurezza o risalire alla revisione esatta esaminata."
  - "Pubblicare un audit senza esporre materiale operativo sensibile."
---

# Audit di sicurezza pubblici

Questa directory raccoglie rapporti sanitizzati riferiti a revisioni Git
esatte.

[SECURITY.md](../../SECURITY.md) resta la policy canonica del progetto. I
rapporti registrano perimetro, metodo, finding, correzioni, prove e limiti di
una specifica revisione; non certificano la sicurezza generale di MediFlow,
la conformità normativa, il deployment clinico o revisioni successive.

Per segnalare una nuova vulnerabilità usare il canale riservato indicato in
[SECURITY.md](../../SECURITY.md). Questo archivio non sostituisce la
coordinated disclosure.

## Regole editoriali

Ogni rapporto pubblico deve:

- indicare data, revisione esatta e stato di pubblicazione;
- distinguere finding validato, correzione verificata e consegna;
- descrivere il metodo senza pubblicare una procedura di sfruttamento;
- riportare test e build con runtime, dipendenze e limiti pertinenti;
- distinguere il modello richiesto dal modello effettivamente attestato;
- non includere dati clinici, credenziali, segreti, percorsi privati, log
  grezzi, probe eseguibili o dettagli operativi non ancora distribuibili.

`FIX_VERIFIED` significa che la correzione è stata verificata sulla revisione
indicata. Non implica merge, distribuzione o verifica del tree composto.

## Rapporti

| Data | Rapporto | Revisione esaminata | Stato |
| --- | --- | --- | --- |
| 2026-10-01 | [Correzione dell’autorità nelle scritture paziente di rete](./2026-10-01-network-patient-authority-fix.md) | `9f522a872af93711daa98a0c20bc6fe38d47390d` | `FIX_VERIFIED`; `LOCAL_COMPOSITION_VERIFIED`; `HOLD_PUBLICATION` |

## Rapporti storici collegati

- [Review di sicurezza Daybreak 0.8.6](../analysis/2026-09-07-086-daybreak-security-review.md):
  audit storico di una revisione differente, con provenienza propria. Non
  costituisce evidenza per il candidato del 2026-10-01.
