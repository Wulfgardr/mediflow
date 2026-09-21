# FSE consultazione e consenso: mappa scenario-specific

> Stato documento: `CANONICAL`

La consultazione del FSE dal paziente selezionato può indicare operazioni molto
diverse. Questa nota delimita il filone: distingue il `portal-handoff` già
disponibile in MediFlow dalla consultazione nella UI ufficiale SISS/FSE, da un
eventuale visualizzatore o flusso documentale incorporato nel gestionale e
dalle integrazioni di eventi e documenti. Per queste ultime servono scenario,
consenso, ruolo e audit specifici; non basta il collegamento al portale.

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

<a id="executive-summary"></a>

## Esito della ricognizione

Stato della ricognizione: 2 maggio 2026.

Le fonti pubbliche descrivono il FSE come un insieme di percorsi regolati,
non come un singolo link o un flusso di documenti liberamente interrogabile.
Il catalogo SISS distingue lo scenario di gestione del Documento Clinico
Elettronico per Enti Erogatori e `MMG/PLS`, che pubblicano o consultano documenti,
da quello del consenso alla consultazione. Consenso e accesso sono quindi
un flusso proprio, non una variabile locale di MediFlow. A questi si aggiunge
`SEB FSE Gestione Eventi`, con interfacce SOAP dedicate.

Il materiale nazionale FSE 2.0 descrive gateway, certificati, provisioning e
accreditamento soprattutto per pubblicazione e validazione documentale.
Non autorizza, da solo, un visualizzatore regionale incorporato in MediFlow.

Il comando di apertura FSE contestuale resta dunque il primo percorso
producibile. Il passo successivo credibile è un `official-session handoff`
più controllato: verifiche preliminari locali, contesto paziente, audit privo
di PHI e checklist del consenso, lasciando consultazione e consenso nel
percorso ufficiale. Un flusso o visualizzatore FSE incorporato rimane bloccato
finché non siano documentati scenario approvato, onboarding regionale,
credenziali, ruoli, consenso e audit dell’intero percorso.

## Fonti ufficiali rilevanti

| Fonte | Codice/versione | Lettura operativa |
| --- | --- | --- |
| [Gestione del Documento Clinico Elettronico presso gli Enti Erogatori e i MMG/PLS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?categoria=15323489&tipologia=46193753) | `DC-SCEN-REF#01`, versione `10.11`, data `01/12/2025` | Lo scenario copre pubblicazione o consultazione dei Documenti Clinici Elettronici sul FSE da parte di Enti Erogatori e `MMG/PLS`. |
| [Consenso alla consultazione FSE](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?ACT=1&PR=6) | `DC-SCEN-ACCO#03`, versione `2.2`, data `23/09/2025` | Il consenso alla consultazione e l'accesso semplificato al FSE sono governati da regole di integrazione e comunicazione eventi al SISS. |
| [SEB FSE Gestione Eventi](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?categoria=15323237&tipologia=46193594) | `DC-SEBC_FSE-SIAA#02`, versione `08`, data `10/02/2025` | Il perimetro FSE include interfacce SOAP esposte dal SEB FSE; non è soltanto navigazione web. |
| [Supporto FSE 2.0](https://github.com/ministero-salute/it-fse-support) | repository ministeriale | Il GTW è il punto di ingresso dei documenti nel sistema FSE e richiede materiali di integrazione, provisioning e certificati. |
| [Accreditamento FSE 2.0](https://github.com/ministero-salute/it-fse-accreditamento) | repository ministeriale | L'integrazione FSE 2.0 richiede evidenze di test/accreditamento per software e tipologie documentali, non solo chiamate tecniche. |

<a id="matrice-di-fattibilita-fse"></a>

## Matrice di fattibilità FSE

| Obiettivo | Stato | Motivo |
| --- | --- | --- |
| Apertura contestuale della UI ufficiale FSE dal paziente | `Disponibile ora` | MediFlow già apre `OpeFseIE` via `portal-handoff`, prepara il CF e mantiene il completamento dentro la sessione ufficiale. |
| Pre-check locale prima del flusso FSE | `Disponibile ora` | Il pannello paziente mostra verifiche preliminari locali su terapie/osservazioni; è preparazione clinica locale, non accesso al FSE. |
| `official-session handoff` più governato | `Fattibile come prossima slice` | Si può rafforzare il comando di apertura con checklist consenso/ruolo/sessione e audit locale PHI-safe, senza ingerire documenti FSE in MediFlow. |
| Consultazione FSE mediata da scenario SISS | `Fattibile solo con onboarding` | Le fonti ufficiali confermano scenari e consenso dedicati; servono specifiche complete, qualifica/provisioning e ruoli autorizzati. |
| Eventi/servizi SEB FSE da backend MediFlow | `Scenario-specific, non pronto` | Esiste un documento SEB FSE, ma l'accesso operativo richiede credenziali, contratti SOAP, ambienti e audit regionali. |
| Viewer/feed embedded di documenti FSE in MediFlow | `Non disponibile` | Le fonti pubbliche non dimostrano un contratto che permetta a MediFlow di mostrare un feed FSE arbitrario fuori dalla UI/integrazione approvata. |
| Export o pubblicazione documentale FSE 2.0 | `Filone separato` | Il GTW/FSE 2.0 nazionale riguarda validazione/pubblicazione documentale e accreditamento, non la consultazione regionale embedded. |

## Vincoli che bloccano un feed embedded

Usare il CF per elencare documenti non risolve le condizioni di accesso al FSE.
Un visualizzatore interno a MediFlow non può quindi essere progettato come
una semplice lista: prima servono almeno i seguenti elementi.

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

Finché questi punti non siano risolti, l’unico comportamento corretto è
aprire la UI ufficiale, lasciando a MediFlow soltanto preparazione e audit
locali.

<a id="prima-thin-slice-raccomandata"></a>

## Primo intervento raccomandato

Il prossimo intervento runtime utile dovrebbe migliorare il passaggio alla
sessione ufficiale, senza acquisirne i documenti:

### `FSE official-session handoff guard`

MediFlow coordina localmente il contesto paziente, mentre la consultazione
resta nella UI ufficiale SISS/FSE. Il CF serve all’operatore, non consente di
aggirare consenso o accesso. L’audit MediFlow registra soltanto apertura e
verifiche preliminari locali, con identificativi oscurati nei metadati.

L’obiettivo minimo comprende quattro passaggi:

1. Mostrare nel pannello paziente una checklist locale con sessione SISS
   osservata, ruolo operatore, CF valido e consenso da verificare nella UI
   ufficiale.
2. Aprire il FSE ufficiale dal contesto paziente, senza promettere
   precompilazione o accesso diretto ai documenti.
3. Registrare un evento di audit locale privo di PHI per il solo passaggio FSE.
4. Documentare esplicitamente che il consenso viene verificato e completato
   nel percorso ufficiale.

L’intervento migliora così l’ergonomia senza fare di MediFlow un
visualizzatore certificato o un archivio FSE.

## Dipendenze documentali/runtime

Un’integrazione FSE nativa richiede invece, prima dell’avvio:

- import locale autorizzato dei documenti `DC-SCEN-REF#01`,
  `DC-SCEN-ACCO#03` e `DC-SEBC_FSE-SIAA#02` nel corpus fuori Git
- conferma del percorso `SSI`/qualifica/provisioning coerente con MediFlow
- decisione ADR sul modello di consenso/accesso e audit FSE
- contratto di sicurezza per certificati, cache, retention e logging
- test sintetici che coprano solo metadati non PHI e non usino documenti FSE
  reali

## Decisione operativa

L’obiettivo per la consultazione FSE è `official-session handoff guard`,
non `custom FSE viewer`, `feed embedded`, `fetch documentale per CF` o
`cache locale di documenti FSE`.

Un’integrazione più profonda resta possibile solo attraverso un intervento
specifico, con onboarding e documentazione ufficiale completa.
