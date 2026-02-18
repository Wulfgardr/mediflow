<!-- Codex: created 2026-02-18 -->
# Roadmap Codifiche Cliniche per FSE 2.0 / EDS (Italia)

## Scopo

Allineare MediFlow a un modello di codifiche cliniche estendibile, locale e verificabile,
coerente con il percorso di compliance verso Fascicolo Sanitario Elettronico 2.0 (EDS).

Questa roadmap non sostituisce la normativa nazionale/regionale: definisce il piano
tecnico di MediFlow per supportare i requisiti documentali in modo incrementale.

---

## Vincoli non negoziabili (già decisi)

- Local-first: nessuna dipendenza cloud di default.
- Zero-knowledge at rest: nessuna decifratura lato server.
- Contratto stabile via API versionate (`/api/v1/*`).
- Diff piccoli e reversibili, con migrazioni esplicite.

Riferimenti interni:
- `ARCHITECTURE.md`
- `SECURITY.md`
- `docs/adr/0005-web-native-functional-parity.md`

---

## Stato attuale (baseline)

- Diagnosi: `ICD-11` (provider WHO via API locale).
- Farmaci: `AIC` (catalogo AIFA locale).
- Farmaci (classificazione): `ATC` presente nel modello dati, da rendere first-class nei flussi.
- Esenzioni: catalogo locale dedicato già operativo.

---

## Modello target: "plugin di terminologia" unificato

Invece di gestire ogni standard con logica dedicata nel form, ogni sistema di codifica
deve implementare lo stesso contratto locale:

1. `search(query, context)`
2. `validate(system, code)`
3. `resolve(system, code) -> display + metadata + version`
4. `mapTo(targetSystem)` (quando disponibile)

Ogni valore codificato salvato in MediFlow deve usare un payload canonico:

```json
{
  "system": "http://loinc.org",
  "code": "8480-6",
  "display": "Systolic blood pressure",
  "version": "2.78",
  "source": "local-catalog",
  "mappedCodes": []
}
```

---

## Matrice pratica (documento -> codifiche)

Questa matrice e' guida tecnica di prodotto; i vincoli puntuali dipendono dal profilo
documentale FSE/EDS specifico (nazionale o regionale).

| Area clinica/documento | Codifica primaria | Codifiche utili aggiuntive | Note implementative |
| --- | --- | --- | --- |
| Diagnosi / problemi clinici | ICD-11 | SNOMED CT (mapping) | ICD resta asse portante; SNOMED aumenta granularita clinica |
| Terapie farmacologiche | AIC | ATC | AIC identifica confezione; ATC abilita classi terapeutiche e analytics |
| Osservazioni (vitali/lab) | LOINC | UCUM | LOINC per "cosa misuro", UCUM per unita di misura |
| Allergie / intolleranze | SNOMED CT | ICD-11 (se necessario per report) | Dominio semantico migliore con SNOMED |
| Procedure / atti | SNOMED CT | ICD-11 (quando usato localmente) | Iniziare da subset ad alto valore |
| Dispositivi medici | CND | UDI (quando disponibile nel flusso) | Prioritario solo se modulo dispositivi entra nel core |
| Esenzioni | Codici esenzione nazionali/regionali | AIC/ATC (filtri farmaceutici) | Catalogo gia presente in MediFlow |

---

## Fasi di rollout proposte

### Fase 0 - Governance (subito)

- Definire un "catalog registry" locale (sistemi supportati, versione, data aggiornamento).
- Introdurre regole di validazione profilo-driven per export documentale.

Output: bozza profili FSE/EDS per almeno 2 documenti prioritari.

### Fase 1 - Consolidamento farmaci

- Rendere `ATC` first-class in terapia, ricerca e report.
- Aggiungere controlli coerenza `AIC <-> ATC` nei dati importati.

Output: filtri terapia per classe ATC e metadati affidabili.

### Fase 2 - Osservazioni strutturate

- Introdurre `LOINC + UCUM` per parametri e referti numerici.
- Aggiungere widget guidato per inserimento misura codificata.

Output: osservazioni esportabili in modo interoperabile senza testo libero.

### Fase 3 - Semantica clinica avanzata

- Integrare subset `SNOMED CT` per allergie/procedure/problemi clinici.
- Aggiungere mapping progressivo verso ICD quando richiesto dai flussi.

Output: migliore precisione semantica senza rompere i flussi attuali ICD.

### Fase 4 - Dispositivi e tracciabilita

- Integrare `CND` se e quando il modulo dispositivi diventa requisito.

Output: codifica coerente di dispositivi/impianti nel dossier clinico.

---

## Backlog API (non vincolante, proposto)

- `GET /api/v1/terminology/systems`
- `GET /api/v1/terminology/search?system=...&q=...`
- `GET /api/v1/terminology/resolve?system=...&code=...`
- `POST /api/v1/terminology/validate`
- `POST /api/v1/fse/validate-document`

Nota: nuovi endpoint solo dopo ADR accettata e thin slice approvato.

---

## Criteri di done per ogni fase

- Nessuna regressione su cifratura/local-first.
- Contratto `/api/v1` documentato e stabile.
- Validazione documentale esplicita (errori bloccanti + warning).
- Test con fixture sintetiche, senza PHI/PII.

---

## Rischi principali

- Deriva tra web e native se le regole restano nel frontend.
- Over-engineering se si tenta un terminology server completo troppo presto.
- Ambiguita normativa se i profili documentali non sono espliciti per documento.

Mitigazione: profili minimi, thin slice verticale, ADR aggiornate.
