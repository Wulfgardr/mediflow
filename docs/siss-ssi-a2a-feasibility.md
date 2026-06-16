# Fattibilita SSI/A2A SISS oltre il `portal-handoff`

> Stato documento: `CANONICAL`

Questo documento separa il prototipo oggi disponibile in MediFlow
(`portal-handoff` contestuale al paziente) dal perimetro della vera
integrazione nativa SISS/FSE dentro il gestionale.

Riferimenti canonici:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)
- [docs/siss-baseline.md](./siss-baseline.md)
- [docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md)
- [docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md)
- [docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md)
- [docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md)
- [docs/adr/0025-siss-local-adapter-contract-and-error-taxonomy.md](./adr/0025-siss-local-adapter-contract-and-error-taxonomy.md)
- [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md)

## Executive summary

Stato della ricognizione: 15 aprile 2026.

Le fonti ufficiali raccolte fin qui mostrano tre fatti distinti:

1. il SISS prevede davvero piu modalita tecniche di integrazione oltre al solo
   Menu SISS: `A2A`, `Web Application`, servizi su `Porta Delegata`,
   `Porta Applicativa`, `API Manager`
2. per il territorio `MMG/PDF`, la sola esistenza di documentazione tecnica non
   basta: il software deve ricadere nel perimetro `SSI`, seguire la procedura
   di qualificazione e usare scenari/documenti approvati
3. quindi una UI MediFlow piu integrata e tecnicamente immaginabile, ma non e
   legittimo trattarla come disponibile "solo con documentazione pubblica" o
   senza onboarding/provisioning regionale

In pratica:

- `portal-handoff` e l'unica strada producibile oggi senza fingere una
  certificazione non ancora acquisita
- il prossimo salto realistico non e "scrivere subito una UI custom", ma
  chiarire se MediFlow voglia:
  - diventare esso stesso un prodotto `SSI` qualificato
  - oppure agganciarsi a un prodotto/contesto gia qualificato

## Cosa dicono le fonti ufficiali

### 1. Il modello SISS prevede sia `A2A` sia `Web Application`

Le pagine ufficiali `Modello Architetturale`, `Integrazione Application to
Application (A2A)` e `Scenari di Integrazione` chiariscono che:

- un servizio SISS puo essere fruito in modalita cooperativa `A2A`
- puo anche essere fruito come `Web Application`
- gli scenari distinguono esplicitamente:
  - attivita supportate via integrazione software
  - attivita supportate dalle GUI del `Menu SISS`
  - attivita che restano in carico all'Ente

Conseguenza per MediFlow:

- una UI dedicata o una webapp piu integrata non e esclusa dal modello
  architetturale
- ma non basta l'architettura astratta per dire che ogni servizio regionale sia
  gia consumabile da un gestionale custom

### 2. Gli scenari SISS sono vincolanti per la validazione

La pagina ufficiale `Scenari di Integrazione` precisa che gli scenari sono la
base della documentazione tecnica e della validazione degli applicativi di
terze parti che usano i servizi SISS. Precisa anche che non sono ammesse
modalita alternative rispetto a quelle previste e documentate, salvo
approvazione esplicita.

Conseguenza per MediFlow:

- anche se esiste un'idea tecnicamente sensata, non e sufficiente se non e
  allineata a scenario, specifiche e percorso di validazione
- un frontend custom non puo inventarsi un protocollo o un boundary diverso
  dalle modalita previste dai documenti ufficiali

### 3. Per MMG/PDF la `SSI` qualificata non e opzionale

Le pagine `Linee Guida Regionali` e `Procedura di Qualificazione Scheda
Sanitaria Informatica (SSI)` stabiliscono che:

- esistono linee guida regionali specifiche per la `Scheda Sanitaria
  Informatica`
- ARIA accerta compatibilita e integrabilita con il SISS delle soluzioni SSI
- solo i prodotti positivamente qualificati e iscritti nell'elenco possono
  essere utilizzati da `MMG` e `PDF`

Conseguenza per MediFlow:

- la domanda corretta non e tanto "serve essere partner tecnologico?" quanto
  "serve ricadere nel percorso SSI qualificato e nel provisioning ARIA?"
- dalle fonti pubbliche raccolte fin qui, la risposta pratica e `si`

### 4. Il territorio MMG/PDF richiede anche provisioning operativo

La pagina `Service Provider -> di MMG/PDF` mostra che per il territorio esiste
un ciclo di vita operativo governato da ARIA: help desk, componenti SISS della
postazione, configurazioni, registrazione del medico nel provisioning,
spostamento di ambulatorio, subentro, cessazione.

Conseguenza per MediFlow:

- anche una futura integrazione software non vive nel vuoto
- credenziali, componenti di accesso, postazione e identita del medico fanno
  parte di un onboarding operativo reale, non solo di un SDK

### 5. La documentazione pubblica conferma che esistono integrazioni piu
 profonde di un semplice link

Il portale pubblico di documentazione SISS espone, tramite ricerca per codice o
titolo, almeno questi segnali utili:

| Evidenza pubblica | Lettura operativa |
| --- | --- |
| `Credenziali API SISS` (`v5.8`, `11/11/2024`) | esiste un percorso documentato per ottenere credenziali `API Manager` per l'accesso ai WS SISS |
| `Specifiche di integrazione Modulo Prescrittivo Regionale` (`ARIA-PRREG-SIAA@01`, `02/12/2025`) | esiste documentazione per richiamare la web application del modulo prescrittivo regionale |
| `Gestione del Documento Clinico Elettronico presso gli Enti Erogatori e i MMG/PLS` (`DC-SCEN-REF#01`, versione `10.11`, `01/12/2025`) | esistono regole di integrazione dedicate a pubblicazione e consultazione di documenti FSE |
| `Consenso alla consultazione FSE` (`DC-SCEN-ACCO#03`, versione `2.2`, `23/09/2025`) | la consultazione FSE ha uno scenario dedicato di consenso/accesso e non e un semplice fetch libero |
| `SEB FSE Gestione Eventi` (`DC-SEBC_FSE-SIAA#02`, versione `08`, `10/02/2025`) | il perimetro FSE include interfacce SOAP specifiche |
| `Anagrafe Regionale degli assistiti e delle strutture` | la NAR e descritta come fonte delle basi dati anagrafiche locali e include funzioni amministrative connesse a esenzioni e ticket |
| `DC-COOP-FHIR_PIC#02` (`02/10/2024`) | esiste almeno un caso SGDT/PAI dove i servizi cooperativi permettono accesso integrato con le `SSI-MMG` |

Conseguenza per MediFlow:

- il backend regionale non e solo "portale rudimentale"
- ma le prove pubbliche raccolte indicano canali ufficiali gia modellati,
  scenario per scenario, e non un backend genericamente aperto a una UI
  arbitraria

### 6. Alcuni servizi territoriali lasciano intuire integrazioni applicative,
 ma non bastano da soli a sdoganare una UI custom

Una FAQ pubblica SISS sulle esenzioni spiega che:

- i `MMG/PDF` possono usare `SSII` che allineano l'anagrafe locale del medico
  ai dati dell'Anagrafe Regionale
- i medici specialisti possono usare un modulo prescrittivo integrato con il
  SISS o, in alternativa, servizi SISS come `Identifica Cittadino` e `Classe
  di Esenzione`

Questa e un'inferenza utile, non una prova contrattuale completa:

- conferma che esistono servizi applicativi oltre al portale
- non sostituisce le specifiche di interfaccia e gli scenari necessari per
  implementare un frontend custom dentro MediFlow

## Matrice di fattibilita

| Obiettivo | Stato | Motivo |
| --- | --- | --- |
| `Menu SISS` contestuale dal paziente | `Fattibile ora` | gia disponibile in MediFlow come `portal-handoff` locale |
| `Ricetta` con apertura guidata del modulo regionale | `Fattibile con onboarding regionale` | esiste documentazione pubblica sul `Modulo Prescrittivo Regionale`, ma il salto oltre l'handoff richiede credenziali, scenario e boundary approvati |
| `Prescrittivo` con UI totalmente custom MediFlow su backend SISS | `Non dimostrato con sole fonti pubbliche raccolte` | abbiamo prove di webapp e WS, non ancora di un contratto pubblico sufficiente a ricostruire in proprio tutto il workflow prescrittivo |
| `FSE` contestuale/embedded nel gestionale | `Fattibile con onboarding regionale e scenari dedicati` | esistono scenari FSE, gestione consenso e interfacce dedicate, ma non un via libera pubblico a un feed embedded arbitrario |
| `Anagrafe Regionale`/esenzioni in UI MediFlow | `Probabile con onboarding regionale, non ancora provato end-to-end` | le FAQ e il modello SISS indicano servizi applicativi; mancano ancora le specifiche raccolte nel corpus corrente |
| `SGDT` contestuale dal paziente | `Non disponibile come launcher generico` | esiste un caso cooperativo specifico per PAI integrato con `SSI-MMG`, ma non una prova di shell paziente generica SGDT |
| `Certificati di malattia` contestuali | `Webapp-mediated, backend custom bloccato` | FAQ e catalogo confermano Web Application e possibili interfacce software, ma non un contratto pubblico sufficiente per UI custom MediFlow |

### Matrice backend-first per UI custom

Questa matrice chiude il confronto richiesto per `Prescrittivo`, `FSE`, `NAR`
e `Certificati`, usando quattro esiti operativi:

- `custom-ui-plausible`: tecnicamente ipotizzabile, ma solo dopo scenario,
  specifiche, qualifica/provisioning e test ufficiali
- `webapp-mediated`: percorso ufficiale utilizzabile tramite UI regionale o
  Web Application governata
- `handoff-only-for-now`: MediFlow puo solo preparare contesto e audit locale
- `blocked-by-docs-or-qualification`: mancano documenti, qualifica o canale
  autorizzato per implementare runtime custom

| Dominio | Esito | Canale ufficiale noto | Vincoli principali | Prima slice realistica |
| --- | --- | --- | --- | --- |
| `Prescrittivo` | `webapp-mediated`; `custom-ui-plausible` solo dopo onboarding | Web Application del `Modulo Prescrittivo Regionale`, con indizi di servizi WS/API SISS | `SSI` qualificata, credenziali/canale, scenario approvato, audit e gestione errori regionali | `webapp-assisted` sul modulo ufficiale, gia tracciato dalla nota prescrittivo |
| `FSE consultazione` | `handoff-only-for-now`; feed/viewer embedded `blocked-by-docs-or-qualification` | UI ufficiale FSE, scenari FSE, consenso consultazione, SEB/eventi | consenso, ruolo operatore, provisioning, audit FSE, policy cache/retention | `official-session handoff guard`, senza ingerire documenti FSE |
| `NAR / Anagrafe Regionale` | `handoff-only-for-now`; lookup read-only `custom-ui-plausible` ma non provato | servizio NAR/Anagrafe, `Identifica Cittadino`, `Classe di Esenzione`, handoff `Gaia` | specifiche non ancora raccolte, minimizzazione dati, ruolo/contesto operatore, source-of-truth regionale | blueprint read-only separato in [docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md), senza runtime custom immediato |
| `Certificati di malattia` | `webapp-mediated`; UI/backend custom `blocked-by-docs-or-qualification` | Web Application Certificati di Malattia e possibili interfacce applicativo medico-SISS | SISS come `SAR`, Carta Operatore, specifiche complete, responsabilita medico-legale, test ufficiale | `official-webapp handoff guard`, solo dopo verifica path ufficiale |

Decisione: il primo dominio backend-first non va scelto perche "piu
customizzabile", ma per valore clinico e maturita del boundary. Oggi la priorita
resta il `Modulo Prescrittivo Regionale` in forma `webapp-assisted`; `FSE` e
`Certificati` restano governati da handoff ufficiale, mentre `NAR` richiede il
blueprint read-only dedicato prima di qualunque runtime.

## Cosa possiamo implementare adesso senza oltrepassare il perimetro

Queste attivita restano coerenti con lo stato reale:

1. rendere piu efficace il `portal-handoff` contestuale paziente
2. aggiungere readiness locali, audit PHI-safe e preparazione dati lato
   gestionale
3. costruire un corpus documentale pubblico sincronizzato (`WUL-176`,
   `WUL-177`, `WUL-179`) per ridurre il lavoro manuale di ricerca
4. scegliere un target preciso per la prossima integrazione reale:
   - `webapp ufficiale` richiamata meglio
   - `A2A` scenario-specific
   - `FSE` evento/consultazione
   - `SGDT` solo nel perimetro `PAI`

## Cosa resta bloccato

Prima di dichiarare una vera integrazione nativa SISS/FSE, ci mancano ancora:

- chiarimento del modello di qualifica MediFlow (`SSI` propria o integrazione
  con SSI gia qualificata)
- accesso ordinato ai documenti tecnici scenario-specific che vanno oltre gli
  indizi pubblici
- credenziali/canale `API Manager` o equivalente percorso ufficiale
- requisiti di audit, consenso, ruolo operatore e sicurezza per ogni scenario
- prova che il servizio scelto supporti davvero il grado di customizzazione UI
  desiderato

## Priorita operativa raccomandata

Alla luce delle fonti ufficiali raccolte fin qui, la sequenza piu sensata e:

   `Modulo Prescrittivo Regionale`
   - e il target con il valore clinico piu diretto
   - ha gia una traccia pubblica documentale chiara nel portale SISS
   - e il candidato migliore per una first slice `webapp-assisted`
   - nota canonica dedicata:
     [docs/siss-modulo-prescrittivo-regionale.md](./siss-modulo-prescrittivo-regionale.md)
   `FSE consultazione e consenso`
   - richiede un boundary piu delicato su consenso, ruoli e audit
   - va affrontato solo dopo aver chiarito meglio il prescrittivo
   - nota canonica dedicata:
     [docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md)
   `SGDT/PAI`
   - resta un filone piu verticale e specifico
   - oggi non e il candidato migliore per la prima integrazione ampia dentro
     MediFlow
   - nota canonica dedicata:
     [docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md)

`Certificati di malattia` restano per ora fuori da questa priorita, non perche
irrilevanti, ma perche il materiale pubblico raccolto supporta al massimo una
futura slice `official-webapp handoff guard`; la nota dedicata e in
[docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md).

## Sequenza consigliata dopo `WUL-178`

1. `WUL-180`: fissare il boundary ufficiale `SSI/A2A` e la mappa di
   fattibilita
2. `WUL-177` / `WUL-179`: trasformare i riferimenti pubblici in corpus
   sincronizzato e interrogabile
3. aprire la prima capability target in ordine di priorita:
4. solo dopo, aprire il workstream runtime che gestisca credenziali,
   qualifica, audit, fallback e UI

## Fonti ufficiali principali

- [Modello Architetturale SISS](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/Modello-architetturale)
- [Integrazione Application to Application (A2A)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/integrazione-application-to-application)
- [Scenari di Integrazione](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/scenari-di-integrazione)
- [Linee Guida Regionali](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/linee-guida-regionali)
- [Procedura di Qualificazione Scheda Sanitaria Informatica (SSI)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/procedure-di-verifica-e-qualificazione/procedura-di-qualificazione-scheda-sanitaria-informatica-ssi)
- [Service Provider di MMG/PDF](https://www.siss.regione.lombardia.it/wps/portal/site/siss/DettaglioRedazionale/servizi-per-il-territorio/service-provider/di-mmg-pdf/red-mmg-pdf/red-mmg-pdf/%21ut/p/z0/fYyxDoIwFAC_hQ94eQhIcGxYFEOMupQuprEFX4S2eTYd_HpZ3Izj5S6HCiUqpxNNOpJ3el55UPXtJLb1vqg2XdPtyvx8LS9tfzg2lcixQ_U_WA8F920_oQo6PoDc6FG-LCd6EwTLQDNEy0zRM33V3UJgn8hYRmkIlmWCYEaUbM1vCE81CJFlH35Jatw%21/)
- [Anagrafe Regionale degli assistiti e delle strutture](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/principali-servizi-offerti/anagrafe-regionale-degli-assistiti-e-delle-strutture)
- [Portale pubblico documentazione SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.jsp)
- [FAQ SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.jsp)
