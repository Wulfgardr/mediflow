<!-- Codex: created 2026-03-18 -->
# Benchmark Clinical Facts: osservazioni `LOINC/UCUM`

Date: 2026-03-18  
Status: Accepted as first thin slice for `WUL-83`

## Obiettivo

Estendere il metodo di benchmark dei clinical facts a osservazioni/vital signs
codificabili in `LOINC + UCUM`, senza toccare il path di produzione web/native.

## Corpus sintetico

Artifact sorgente:
- `scripts/fixtures/clinical-facts-observation-corpus.json`

Il corpus v1 contiene `6` casi sintetici:
- pressione + frequenza + SpO2 con unita esplicite
- temperatura + peso
- glicemia
- pressione con unita mancante ma caso `reviewable`
- frequenza cardiaca con alias unitario (`bpm`)
- rumore senza osservazioni

## Lane benchmarkate

- `rules`: regex e mapping diretto, senza normalizzazione UCUM
- `hybrid`: stessa estrazione deterministica + normalizzazione alias unita e fill controllato dei casi reviewable
- `ai`: lane mantenuta esplicita ma `not-run` in questa thin slice, perche il repo non ha ancora un runner benchmark headless verso il modello locale

Comando:

```bash
npm run benchmark:clinical-facts:observations
```

## Risultato v1

Metriche sul corpus corrente:

| Lane | Precision | Recall | Coding accuracy | Reviewability accuracy | Avg latency ms |
| --- | --- | --- | --- | --- | --- |
| `rules` | `0.3` | `0.3` | `0.3` | `1.0` | `0.118` |
| `hybrid` | `1.0` | `1.0` | `1.0` | `1.0` | `0.012` |
| `ai` | `not-run` | `not-run` | `not-run` | `not-run` | `n/a` |

## Decisione

- `default`: `hybrid`
- `fallback`: `rules`
- `rejected`: `ai` per questa thin slice

Razionale:
- `hybrid` conserva l'estrazione deterministica e reviewable
- normalizza alias reali (`mmHg -> mm[Hg]`, `bpm -> /min`, `°C -> Cel`)
- mantiene i casi con unita mancanti come `reviewable`, senza nascondere l'incertezza
- la lane `rules` da sola resta utile come baseline/fallback ma fallisce il gate di interoperabilita per le unita non canoniche

## Limiti espliciti

- Nessun cambio di produzione su web/native.
- Nessun benchmark AI end-to-end nel repo in questa slice.
- Corpus piccolo e sintetico: non generalizza da solo a documenti reali o note molto rumorose.

## Next

1. aggiungere un runner headless opzionale per la lane `ai`
2. estendere il corpus a lab-like mentions e casi piu ambigui
3. riusare questo benchmark quando il path osservazioni/documenti verra esteso
