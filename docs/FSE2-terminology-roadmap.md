# Roadmap Codifiche Cliniche per FSE 2.0 / EDS (Italia)

## Scopo

Per preparare documenti utilizzabili nel percorso verso il Fascicolo Sanitario
Elettronico 2.0 / EDS, MediFlow ha bisogno di codifiche cliniche che possano essere
estese senza disperdere le regole nei singoli moduli. La scelta è costruire un
modello locale e verificabile, compatibile con il funzionamento local-first e
con la cifratura clinica per campo.

Questa roadmap definisce il piano tecnico per sostenere progressivamente i
requisiti documentali; non sostituisce la normativa nazionale o regionale e
non attesta che il percorso di conformità sia già concluso. Il riferimento
progettuale sono pratiche mature dell’open source, incluso il lavoro su
OpenHospital, adattate ai vincoli di MediFlow.

---

## Vincoli non negoziabili (già decisi)

- Local-first: nessuna dipendenza cloud di default.
- Cifratura per campo a riposo: i campi clinici configurati arrivano al server
  come ciphertext; identificativi e alcuni metadati restano fuori dal mapping.
- Contratto stabile via API versionate (`/api/v1/*`).
- Diff piccoli e reversibili, con migrazioni esplicite.

Riferimenti interni:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/adr/0005-web-native-functional-parity.md](./adr/0005-web-native-functional-parity.md)
- [docs/README.md](./README.md) e [docs/markdown-index.md](./markdown-index.md)

---

## Stato attuale (baseline)

La base da cui parte il piano comprende un provider ICD-11 OMS facoltativo,
accessibile tramite API locale: i record possono contenere ICD-9/10/11 oppure
problemi in testo libero da rivedere. Per i farmaci è disponibile `AIC`, con
catalogo AIFA locale; la classificazione `ATC` è presente nel modello dati, ma
va portata nei flussi come elemento gestito direttamente. Le esenzioni hanno
già un catalogo locale dedicato e operativo.

---

## Modello target: "plugin di terminologia" unificato

Se ogni form gestisse autonomamente il proprio standard, ricerca e validazione
potrebbero divergere tra superfici. Il modello previsto sposta quindi queste
regole in un contratto locale comune, che ogni sistema di codifica deve
implementare:

1. `search(query, context)`
2. `validate(system, code)`
3. `resolve(system, code) -> display + metadata + version`
4. `mapTo(targetSystem)` (quando disponibile)

Anche il dato salvato deve mantenere un significato riconoscibile: ogni valore
codificato in MediFlow deve usare il seguente payload canonico:

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

La matrice orienta le scelte tecniche di prodotto, distinguendo la codifica
principale da quelle utili ad arricchirla. I vincoli puntuali restano quelli
del profilo documentale FSE/EDS nazionale o regionale applicabile: la matrice
non li sostituisce.

| Area clinica/documento | Codifica primaria | Codifiche utili aggiuntive | Note implementative |
| --- | --- | --- | --- |
| Diagnosi / problemi clinici | ICD-11 | SNOMED CT (mapping) | ICD resta asse portante; SNOMED aggiunge dettaglio clinico |
| Terapie farmacologiche | AIC | ATC | AIC identifica la confezione; ATC consente raggruppamenti terapeutici e analisi |
| Osservazioni (vitali/lab) | LOINC | UCUM | LOINC identifica che cosa si misura; UCUM esprime l’unità di misura |
| Allergie / intolleranze | SNOMED CT | ICD-11 (se necessario per report) | Dominio semantico migliore con SNOMED |
| Procedure / atti | SNOMED CT | ICD-11 (quando usato localmente) | Iniziare da sottoinsiemi di maggiore utilità |
| Dispositivi medici | CND | UDI (quando disponibile nel flusso) | Prioritario solo se modulo dispositivi entra nel core |
| Esenzioni | Codici esenzione nazionali/regionali | AIC/ATC (filtri farmaceutici) | Catalogo già presente in MediFlow |

---

<a id="fasi-di-rollout-proposte"></a>

## Fasi di adozione proposte

### Fase 0 - Governance (subito)

Prima di estendere le codifiche, occorre sapere quali sistemi siano supportati
e a quale versione ci si riferisca. La fase propone un registro locale dei
cataloghi, con versione e data di aggiornamento, e regole di validazione
dell’export guidate dal profilo documentale.

Il risultato atteso è una bozza dei profili FSE/EDS per almeno 2 documenti
prioritari.

### Fase 1 - Consolidamento farmaci

La classificazione `ATC` deve diventare utilizzabile direttamente in terapia,
ricerca e report. I controlli di coerenza `AIC <-> ATC` sui dati importati
servono a sostenere questo passaggio, così da ottenere filtri delle terapie
per classe ATC e metadati affidabili.

### Fase 2 - Osservazioni strutturate

Per rappresentare parametri e referti numerici senza affidarsi al solo testo
libero, la fase propone `LOINC + UCUM` e un componente guidato per inserire la
misura codificata. L’obiettivo è rendere le osservazioni esportabili in modo
interoperabile senza testo libero; si tratta del risultato atteso, non di una
conformità già attestata.

### Fase 3 - Semantica clinica avanzata

Allergie, procedure e problemi clinici richiedono un dettaglio che la sola
codifica ICD non sempre esprime. Si propone perciò di integrare sottoinsiemi
`SNOMED CT` e aggiungere progressivamente la corrispondenza verso ICD quando i
flussi la richiedano. L’obiettivo è una maggiore precisione semantica senza
interrompere i percorsi ICD esistenti.

<a id="fase-4---dispositivi-e-tracciabilita"></a>

### Fase 4 - Dispositivi e tracciabilità

L’integrazione di `CND` resta subordinata al fatto che il modulo dispositivi
diventi un requisito. Solo in quel caso il risultato atteso è una codifica
coerente di dispositivi e impianti nel dossier clinico.

---

## Backlog API (non vincolante, proposto)

- `GET /api/v1/terminology/systems`
- `GET /api/v1/terminology/search?system=...&q=...`
- `GET /api/v1/terminology/resolve?system=...&code=...`
- `POST /api/v1/terminology/validate`
- `POST /api/v1/fse/validate-document`

I nuovi endpoint sono ammessi solo dopo l’accettazione dell’ADR e
l’approvazione di un intervento verticale circoscritto, la thin slice.

---

<a id="criteri-di-done-per-ogni-fase"></a>

## Criteri di completamento di ogni fase

- Nessuna regressione su cifratura/local-first.
- Contratto `/api/v1` documentato e stabile.
- Validazione documentale esplicita (errori bloccanti + warning).
- Test con fixture sintetiche, senza PHI/PII.

---

## Rischi principali

Le regole lasciate nei frontend possono far divergere web e client nativi;
all’estremo opposto, costruire troppo presto un server terminologico completo
rischia di aggiungere complessità non necessaria. Rimane inoltre un’ambiguità
normativa se i profili non siano definiti per ciascun documento.

La mitigazione proposta è procedere con profili minimi e interventi verticali
circoscritti, mantenendo aggiornati gli ADR.
