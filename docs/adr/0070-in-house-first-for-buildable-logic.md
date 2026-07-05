<!-- Claude: direttiva utente 2026-06-29 -->
# ADR 0070: In-house-first per la logica integrabile (ICD, moduli intelligenti)

Date: 2026-06-29
Status: Accepted

Related:
[docs/adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md](./0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md),
[docs/NATIVE.md](../NATIVE.md),
[ARCHITETTURA.md](../ARCHITETTURA.md),
[lib/icd-codes.ts](../../lib/icd-codes.ts),
[lib/scale-definitions.ts](../../lib/scale-definitions.ts)

## Problema

MediFlow e local-first e deve restare funzionante in autonomia, anche
sull'app Apple paired, senza dipendere da servizi esterni opzionali (container
Docker, proxy locali separati, cloud). Alcune capacita clinicamente utili sono
oggi delegate a dipendenze esterne: per esempio la ricerca ICD e stata spostata
"in favore del proxy ICD-11" su container Docker ([lib/icd-codes.ts](../../lib/icd-codes.ts):
`searchICD` ritorna `[]`), quindi sull'app paired la codifica diagnosi non
funziona se quel container non gira. Lo stesso rischio vale per i "moduli
intelligenti" futuri se appoggiati a runtime esterni.

## Decisione

Tutto cio che e integrabile con logica **in-house** dall'app si costruisce
**dentro l'app**, con **filiere 1:1 con le feature di MediFlow**, invece di
dipendere da un servizio esterno.

In concreto:

- **ICD / codifica diagnosi**: una sorgente ICD in-app (tabella di codici
  curata, bundle locale) con ricerca in-house, non il proxy Docker. La forma del
  dato resta 1:1 con MediFlow (`{ code, description, system }`, vedi la
  `Diagnosis` clinica e [lib/scale-definitions.ts](../../lib/scale-definitions.ts)
  per il pattern delle definizioni portate field-for-field).
- **Moduli intelligenti / clinici** (scale, supporto decisionale, regole,
  parsing strutturato e simili): logica pura in-app, testata, che riproduce il
  comportamento web. Pattern gia adottato: `ClinicalScales` (ADL/Katz portato da
  `lib/scale-definitions.ts`), `DiagnosesCodec`, `ObservationTrend`.
- Le dipendenze esterne restano ammesse solo dove la logica NON e replicabile
  in-house in modo onesto (es. modelli AI cloud sotto governance, integrazione
  SISS/FSE governata), e comunque dietro un confine esplicito.

## Vincoli che restano invariati

- **1:1 con MediFlow**: l'implementazione in-house deve combaciare col
  comportamento e con i contratti dati del web, cosi che il dato sia leggibile e
  scrivibile da entrambi i lati senza divergenze.
- **Zero-knowledge e local-first**: nessuna nuova superficie cloud, nessun
  egress di PHI; la logica in-house gira sul dispositivo / home-base.
- **Onesta**: se una capacita non e davvero replicabile in-house (copertura
  parziale di un catalogo, qualita inferiore al servizio esterno), va dichiarato
  esplicitamente, non mascherato.

## Aggiornamento dinamico (in-house base + fetch)

Gli elementi dinamici devono poter restare aggiornati: la logica in-house e la
**base offline** (sempre disponibile, local-first), ma quando esiste una fonte
autorevole il modulo puo **fare fetch degli aggiornamenti** e arricchire/refrescare
la base. Per ICD: la tabella in-app e la base, e l'app puo aggiornarla dalla
**WHO ICD-11 API** (offline base + online refresh + cache), non dipendendo dal
servizio a runtime e degradando con grazia alla base bundle quando offline. Le
credenziali e il fetch non devono rompere zero-knowledge/local-first.

Lo stesso pattern vale per lo "stack intelligente": l'inferenza gira
**on-device** (Apple Foundation Models / MLX) per restare zero-knowledge, con
eventuale refresh dei soli artefatti non sensibili (modelli, cataloghi, regole)
da fonti autorevoli.

## Conseguenze

- A14 (ICD) NON e bloccato: si costruisce una sorgente ICD in-app + ricerca,
  usata per assegnare diagnosi. La base e in-app; il fetch dalla WHO ICD-11 API
  e l'aggiornamento dinamico. Il proxy Docker resta un'opzione facoltativa, non
  una dipendenza.
- Lo stack intelligente (sintesi cliniche, estrazione strutturata) va portato
  on-device (Apple Foundation Models prima, MLX dove serve controllo/modelli
  specifici), 1:1 con i contratti AI del web, preservando zero-knowledge.
- I prossimi "moduli intelligenti" partono in-house per default.
- La copertura di un catalogo in-house (es. ICD) e dichiaratamente un
  sottoinsieme curato dei codici piu comuni, ampliabile + aggiornabile via fetch,
  non l'intero ICD-11 hardcoded.
