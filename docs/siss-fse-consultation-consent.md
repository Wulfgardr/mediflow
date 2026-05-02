# FSE consultazione e consenso: mappa scenario-specific

> Stato documento: `CANONICAL`

Questo documento restringe il filone FSE alla sola consultazione contestuale
dal paziente, distinguendo:

- il `portal-handoff` gia disponibile in MediFlow
- la consultazione dentro UI ufficiale SISS/FSE
- un eventuale viewer/feed embedded in MediFlow
- le integrazioni evento/documentali gestite da scenario, consenso, ruolo e
  audit

Riferimenti canonici:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)
- [docs/siss-baseline.md](./siss-baseline.md)
- [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md)
- [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md)
- [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md)
- [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)

## Executive summary

Stato della ricognizione: 2 maggio 2026.

Le fonti ufficiali pubbliche mostrano che il perimetro FSE non e un singolo
link e non e neppure un feed liberamente interrogabile da un gestionale locale:

1. il catalogo SISS espone uno scenario aggiornato per la gestione del
   Documento Clinico Elettronico, dedicato agli Enti Erogatori e a `MMG/PLS`
   che pubblicano o consultano documenti sul FSE
2. il catalogo SISS espone uno scenario separato per il consenso alla
   consultazione FSE, quindi consenso/accesso sono un flusso proprio e non una
   variabile locale di MediFlow
3. il catalogo SISS espone anche il documento `SEB FSE Gestione Eventi`, con
   interfacce SOAP dedicate ai servizi del SEB FSE
4. il materiale nazionale FSE 2.0 conferma un percorso di integrazione
   documentale con gateway, certificati, provisioning e accreditamento, ma
   quello governa soprattutto pubblicazione/validazione documentale e non
   autorizza da solo un viewer regionale embedded dentro MediFlow

Conclusione operativa:

- il launcher FSE contestuale attuale resta il primo path producibile
- il salto successivo credibile e un `official-session handoff` piu governato:
  readiness locale, contesto paziente, audit PHI-safe e checklist consenso,
  lasciando consultazione e consenso dentro il percorso ufficiale
- un feed o viewer FSE embedded dentro MediFlow resta bloccato finche non
  esistono scenario approvato, onboarding regionale, credenziali, ruoli,
  consenso e audit end-to-end documentati

## Fonti ufficiali rilevanti

| Fonte | Codice/versione | Lettura operativa |
| --- | --- | --- |
| [Gestione del Documento Clinico Elettronico presso gli Enti Erogatori e i MMG/PLS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?categoria=15323489&tipologia=46193753) | `DC-SCEN-REF#01`, versione `10.11`, data `01/12/2025` | Lo scenario copre pubblicazione o consultazione dei Documenti Clinici Elettronici sul FSE da parte di Enti Erogatori e `MMG/PLS`. |
| [Consenso alla consultazione FSE](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?ACT=1&PR=6) | `DC-SCEN-ACCO#03`, versione `2.2`, data `23/09/2025` | Il consenso alla consultazione e l'accesso semplificato al FSE sono governati da regole di integrazione e comunicazione eventi al SISS. |
| [SEB FSE Gestione Eventi](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?categoria=15323237&tipologia=46193594) | `DC-SEBC_FSE-SIAA#02`, versione `08`, data `10/02/2025` | Il perimetro FSE include interfacce SOAP esposte dal SEB FSE; non e solo navigazione web. |
| [Supporto FSE 2.0](https://github.com/ministero-salute/it-fse-support) | repository ministeriale | Il GTW e il punto di ingresso dei documenti nel sistema FSE e richiede materiali di integrazione, provisioning e certificati. |
| [Accreditamento FSE 2.0](https://github.com/ministero-salute/it-fse-accreditamento) | repository ministeriale | L'integrazione FSE 2.0 richiede evidenze di test/accreditamento per software e tipologie documentali, non solo chiamate tecniche. |

## Matrice di fattibilita FSE

| Obiettivo | Stato | Motivo |
| --- | --- | --- |
| Apertura contestuale della UI ufficiale FSE dal paziente | `Disponibile ora` | MediFlow gia apre `OpeFseIE` via `portal-handoff`, prepara il CF e mantiene il completamento dentro la sessione ufficiale. |
| Pre-check locale prima del flusso FSE | `Disponibile ora` | Il pannello paziente mostra readiness locale su terapie/osservazioni; e preparazione clinica locale, non accesso al FSE. |
| `official-session handoff` piu governato | `Fattibile come prossima slice` | Si puo rafforzare il launcher con checklist consenso/ruolo/sessione e audit locale PHI-safe, senza ingerire documenti FSE in MediFlow. |
| Consultazione FSE mediata da scenario SISS | `Fattibile solo con onboarding` | Le fonti ufficiali confermano scenari e consenso dedicati; servono specifiche complete, qualifica/provisioning e ruoli autorizzati. |
| Eventi/servizi SEB FSE da backend MediFlow | `Scenario-specific, non pronto` | Esiste un documento SEB FSE, ma l'accesso operativo richiede credenziali, contratti SOAP, ambienti e audit regionali. |
| Viewer/feed embedded di documenti FSE in MediFlow | `Non disponibile` | Le fonti pubbliche non dimostrano un contratto che permetta a MediFlow di mostrare un feed FSE arbitrario fuori dalla UI/integrazione approvata. |
| Export o pubblicazione documentale FSE 2.0 | `Filone separato` | Il GTW/FSE 2.0 nazionale riguarda validazione/pubblicazione documentale e accreditamento, non la consultazione regionale embedded. |

## Vincoli che bloccano un feed embedded

Un viewer FSE dentro MediFlow non puo essere progettato come semplice lista di
documenti per CF. Prima servono almeno:

1. scenario ufficiale di consultazione applicabile a `MMG/PLS` o al contesto
   operativo scelto
2. modello di consenso consultazione e accesso semplificato realmente
   supportato per il caso d'uso
3. identificazione certa di paziente e operatore dentro sessione/ruolo
   ufficiale
4. credenziali, certificati, endpoint e ambiente autorizzati
5. requisiti di audit SISS/FSE, incluse correlazioni e motivazioni di accesso
6. policy di minimizzazione: quali metadati possono restare localmente e per
   quanto tempo
7. threat model aggiornato per cache, allegati, anteprime e fallback offline

Senza questi punti, l'unico comportamento corretto e aprire la UI ufficiale e
tenere MediFlow sul lato preparazione/audit locale.

## Prima thin slice raccomandata

La prossima implementazione runtime utile dovrebbe essere:

### `FSE official-session handoff guard`

Forma:

- MediFlow resta coordinatore locale del contesto paziente
- la consultazione FSE resta nella UI ufficiale SISS/FSE
- il CF resta supporto operativo, non chiave per bypassare consenso/accesso
- l'audit MediFlow registra solo launch/readiness locale con metadati redatti

Obiettivo minimo:

1. mostrare nel pannello paziente una checklist locale: sessione SISS osservata,
   ruolo operatore, CF valido, consenso da verificare nella UI ufficiale
2. aprire il FSE ufficiale dal contesto paziente senza promettere prefill o
   accesso diretto ai documenti
3. registrare un evento audit locale PHI-safe del solo handoff FSE
4. documentare esplicitamente che il consenso viene verificato/completato nel
   percorso ufficiale

Questa slice migliora l'ergonomia senza spostare MediFlow nel ruolo di viewer
certificato o repository FSE.

## Dipendenze documentali/runtime

Prima di aprire una vera integrazione FSE nativa servono:

- import locale autorizzato dei documenti `DC-SCEN-REF#01`,
  `DC-SCEN-ACCO#03` e `DC-SEBC_FSE-SIAA#02` nel corpus fuori Git
- conferma del percorso `SSI`/qualifica/provisioning coerente con MediFlow
- decisione ADR sul modello di consenso/accesso e audit FSE
- contratto di sicurezza per certificati, cache, retention e logging
- test sintetici che coprano solo metadati non PHI e non usino documenti FSE
  reali

## Decisione operativa

Per MediFlow, oggi, il target giusto per FSE consultazione e:

- `official-session handoff guard`

e non:

- `custom FSE viewer`
- `feed embedded`
- `fetch documentale per CF`
- `cache locale di documenti FSE`

L'integrazione piu profonda resta possibile solo se verra aperta una slice
specifica con onboarding e documentazione ufficiale completa.
