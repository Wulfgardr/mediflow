<a id="fattibilita-ssia2a-siss-oltre-il-portal-handoff"></a>

# Fattibilità SSI/A2A SISS oltre il `portal-handoff`

> Stato documento: `CANONICAL`

Il prototipo di MediFlow apre il portale a partire dal paziente selezionato:
questo è il `portal-handoff` disponibile. Per portare i servizi SISS/FSE dentro
il gestionale servono invece canali e condizioni di accesso specifici. Questa
nota distingue le due possibilità, così che la fattibilità tecnica non venga
scambiata per un’integrazione già autorizzata.

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

<a id="executive-summary"></a>

## Esito della ricognizione

Stato della ricognizione: 15 aprile 2026.

Le fonti ufficiali raccolte mostrano che il SISS non si esaurisce nel Menu SISS:
prevede `A2A`, `Web Application`, servizi su `Porta Delegata`, `Porta Applicativa`
e `API Manager`. Una UI MediFlow più integrata è dunque tecnicamente
immaginabile, ma la presenza di questi canali non li rende liberamente
utilizzabili.

Per il territorio `MMG/PDF`, il software deve rientrare nel perimetro `SSI`,
seguire la procedura di qualificazione e usare scenari e documenti approvati.
Non è quindi legittimo presentare l’integrazione come disponibile sulla sola
base della documentazione pubblica o senza onboarding e provisioning
regionali.

Il `portal-handoff` resta la strada producibile senza attribuirsi una
certificazione non acquisita. Prima di costruire una UI dedicata occorre
scegliere se MediFlow debba diventare un prodotto `SSI` qualificato oppure
collegarsi a un prodotto o contesto già qualificato.

## Cosa dicono le fonti ufficiali

### 1. Il modello SISS prevede sia `A2A` sia `Web Application`

Le pagine ufficiali `Modello Architetturale`, `Integrazione Application to
Application (A2A)` e `Scenari di Integrazione` distinguono la fruizione
cooperativa `A2A` da quella come `Web Application`. Gli scenari separano inoltre
le attività svolte attraverso l’integrazione software, quelle disponibili
nelle GUI del `Menu SISS` e quelle che restano a carico dell’Ente.

Il modello architetturale non esclude quindi una UI dedicata o una webapp più
integrata. Da solo, però, non dimostra che ogni servizio regionale sia già
utilizzabile da un gestionale personalizzato.

### 2. Gli scenari SISS sono vincolanti per la validazione

La pagina ufficiale `Scenari di Integrazione` indica gli scenari come base
della documentazione tecnica e della validazione degli applicativi di terze
parti che usano i servizi SISS. Le modalità alternative a quelle previste e
documentate non sono ammesse senza approvazione esplicita.

Un’idea tecnicamente sensata deve perciò essere allineata a scenario,
specifiche e percorso di validazione. Il frontend di MediFlow non può
inventare un protocollo o un confine di accesso diverso da quelli definiti
nei documenti ufficiali.

<a id="3-per-mmgpdf-la-ssi-qualificata-non-e-opzionale"></a>

### 3. Per MMG/PDF la `SSI` qualificata non è opzionale

Le pagine `Linee Guida Regionali` e `Procedura di Qualificazione Scheda
Sanitaria Informatica (SSI)` descrivono linee guida specifiche per la
`Scheda Sanitaria Informatica`. ARIA accerta compatibilità e integrabilità
con il SISS delle soluzioni SSI; solo i prodotti qualificati positivamente
e iscritti nell’elenco possono essere usati da `MMG` e `PDF`.

La domanda decisiva non è dunque se serva essere genericamente un partner
tecnologico, ma se MediFlow debba rientrare nel percorso SSI qualificato e
nel provisioning ARIA. Sulla base delle fonti pubbliche raccolte, la risposta
operativa è `si`.

### 4. Il territorio MMG/PDF richiede anche provisioning operativo

La pagina `Service Provider -> di MMG/PDF` descrive un ciclo operativo
governato da ARIA: help desk, componenti SISS della postazione,
configurazioni, registrazione del medico nel provisioning, spostamento di
ambulatorio, subentro e cessazione.

Un’integrazione software deve trovare posto in questo ciclo. Credenziali,
componenti di accesso, postazione e identità del medico richiedono un
avvio operativo reale, non soltanto l’adozione di un SDK.

<a id="5-la-documentazione-pubblica-conferma-che-esistono-integrazioni-piu"></a>

### 5. Integrazioni documentate oltre il semplice collegamento

La ricerca per codice o titolo nel portale pubblico di documentazione SISS
restituisce almeno i seguenti riferimenti. Indicano canali specifici da
approfondire, non un’autorizzazione generale a usarli:

| Evidenza pubblica | Lettura operativa |
| --- | --- |
| `Credenziali API SISS` (`v5.8`, `11/11/2024`) | esiste un percorso documentato per ottenere credenziali `API Manager` per l'accesso ai WS SISS |
| `Specifiche di integrazione Modulo Prescrittivo Regionale` (`ARIA-PRREG-SIAA@01`, `02/12/2025`) | esiste documentazione per richiamare la web application del modulo prescrittivo regionale |
| `Gestione del Documento Clinico Elettronico presso gli Enti Erogatori e i MMG/PLS` (`DC-SCEN-REF#01`, versione `10.11`, `01/12/2025`) | esistono regole di integrazione dedicate a pubblicazione e consultazione di documenti FSE |
| `Consenso alla consultazione FSE` (`DC-SCEN-ACCO#03`, versione `2.2`, `23/09/2025`) | la consultazione FSE ha uno scenario dedicato di consenso/accesso e non è un recupero libero di documenti |
| `SEB FSE Gestione Eventi` (`DC-SEBC_FSE-SIAA#02`, versione `08`, `10/02/2025`) | il perimetro FSE include interfacce SOAP specifiche |
| `Anagrafe Regionale degli assistiti e delle strutture` | la NAR è descritta come fonte delle basi dati anagrafiche locali e include funzioni amministrative connesse a esenzioni e ticket |
| `DC-COOP-FHIR_PIC#02` (`02/10/2024`) | esiste almeno un caso SGDT/PAI dove i servizi cooperativi permettono accesso integrato con le `SSI-MMG` |

Il backend regionale va quindi oltre un portale di navigazione. Le prove
pubbliche descrivono però canali ufficiali modellati per singolo scenario,
non un backend aperto a qualunque UI: è da quei contratti specifici che deve
partire MediFlow.

<a id="6-alcuni-servizi-territoriali-lasciano-intuire-integrazioni-applicative"></a>

### 6. Indizi di integrazione nei servizi territoriali, non autorizzazione a una UI dedicata

Una FAQ pubblica SISS sulle esenzioni spiega che i `MMG/PDF` possono usare
`SSII` capaci di allineare l’anagrafe locale del medico ai dati regionali.
Gli specialisti possono usare un modulo prescrittivo integrato con il SISS
oppure servizi come `Identifica Cittadino` e `Classe di Esenzione`.

Ne deriva un’indicazione utile sull’esistenza di servizi applicativi oltre al
portale, non una prova contrattuale completa. Per realizzare un frontend
dedicato in MediFlow servono ancora le specifiche di interfaccia e gli
scenari pertinenti.

<a id="matrice-di-fattibilita"></a>

## Matrice di fattibilità

| Obiettivo | Stato | Motivo |
| --- | --- | --- |
| `Menu SISS` contestuale dal paziente | `Fattibile ora` | già disponibile in MediFlow come `portal-handoff` locale |
| `Ricetta` con apertura guidata del modulo regionale | `Fattibile con onboarding regionale` | esiste documentazione pubblica sul `Modulo Prescrittivo Regionale`, ma il salto oltre l'handoff richiede credenziali, scenario e boundary approvati |
| `Prescrittivo` con UI totalmente custom MediFlow su backend SISS | `Non dimostrato con sole fonti pubbliche raccolte` | abbiamo prove di webapp e WS, non ancora di un contratto pubblico sufficiente a ricostruire in proprio tutto il workflow prescrittivo |
| `FSE` contestuale/embedded nel gestionale | `Fattibile con onboarding regionale e scenari dedicati` | esistono scenari FSE, gestione consenso e interfacce dedicate, ma non un via libera pubblico a un feed embedded arbitrario |
| `Anagrafe Regionale`/esenzioni in UI MediFlow | `Probabile con onboarding regionale, non ancora provato end-to-end` | le FAQ e il modello SISS indicano servizi applicativi; mancano ancora le specifiche raccolte nel corpus corrente |
| `SGDT` contestuale dal paziente | `Non disponibile come launcher generico` | esiste un caso cooperativo specifico per PAI integrato con `SSI-MMG`, ma non una prova di shell paziente generica SGDT |
| `Certificati di malattia` contestuali | `Webapp-mediated, backend custom bloccato` | FAQ e catalogo confermano Web Application e possibili interfacce software, ma non un contratto pubblico sufficiente per UI custom MediFlow |

### Matrice backend-first per UI custom

Per confrontare `Prescrittivo`, `FSE`, `NAR` e `Certificati` bisogna chiedersi
prima quale accesso al backend sia documentato, poi quale UI possa usarlo.
La matrice distingue quattro esiti operativi:

- `custom-ui-plausible`: tecnicamente ipotizzabile, ma solo dopo scenario,
  specifiche, qualifica/provisioning e test ufficiali
- `webapp-mediated`: percorso ufficiale utilizzabile tramite UI regionale o
  Web Application governata
- `handoff-only-for-now`: MediFlow può soltanto preparare il contesto e l’audit locale
- `blocked-by-docs-or-qualification`: mancano documenti, qualifica o canale
  autorizzato per implementare runtime custom

| Dominio | Esito | Canale ufficiale noto | Vincoli principali | Prima slice realistica |
| --- | --- | --- | --- | --- |
| `Prescrittivo` | `webapp-mediated`; `custom-ui-plausible` solo dopo onboarding | Web Application del `Modulo Prescrittivo Regionale`, con indizi di servizi WS/API SISS | `SSI` qualificata, credenziali/canale, scenario approvato, audit e gestione errori regionali | `webapp-assisted` sul modulo ufficiale, già tracciato dalla nota sul prescrittivo |
| `FSE consultazione` | `handoff-only-for-now`; feed/viewer embedded `blocked-by-docs-or-qualification` | UI ufficiale FSE, scenari FSE, consenso consultazione, SEB/eventi | consenso, ruolo operatore, provisioning, audit FSE, policy cache/retention | `official-session handoff guard`, senza ingerire documenti FSE |
| `NAR / Anagrafe Regionale` | `handoff-only-for-now`; lookup read-only `custom-ui-plausible` ma non provato | servizio NAR/Anagrafe, `Identifica Cittadino`, `Classe di Esenzione`, handoff `Gaia` | specifiche non ancora raccolte, minimizzazione dati, ruolo/contesto operatore, autorità del dato regionale | blueprint read-only separato in [docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md), senza runtime custom immediato |
| `Certificati di malattia` | `webapp-mediated`; UI/backend custom `blocked-by-docs-or-qualification` | Web Application Certificati di Malattia e possibili interfacce applicativo medico-SISS | SISS come `SAR`, Carta Operatore, specifiche complete, responsabilità medico-legale, test ufficiale | `official-webapp handoff guard`, solo dopo verifica path ufficiale |

La scelta del primo dominio non deve dipendere da quanto la UI sia
personalizzabile, ma dal valore clinico e dalla maturità delle condizioni di
accesso. La priorità resta il `Modulo Prescrittivo Regionale` in forma
`webapp-assisted`; per `FSE` e `Certificati` si mantiene il passaggio ufficiale
al portale. `NAR` richiede invece un progetto dedicato alla sola lettura prima
di qualsiasi runtime.

## Cosa possiamo implementare adesso senza oltrepassare il perimetro

Il lavoro utile entro il perimetro disponibile non richiede di anticipare
l’integrazione certificata. Comprende:

1. rendere più efficace il `portal-handoff` contestuale paziente
2. aggiungere verifiche preliminari locali, audit privo di PHI e preparazione
   dei dati nel gestionale
3. costruire un corpus documentale pubblico sincronizzato (`WUL-176`,
   `WUL-177`, `WUL-179`) per ridurre il lavoro manuale di ricerca
4. scegliere un target preciso per la prossima integrazione reale:
   - `webapp ufficiale` richiamata meglio
   - `A2A` scenario-specific
   - `FSE` evento/consultazione
   - `SGDT` solo nel perimetro `PAI`

## Cosa resta bloccato

Una vera integrazione nativa SISS/FSE resta bloccata finché non siano risolti
i seguenti punti:

- chiarimento del modello di qualifica MediFlow (`SSI` propria o integrazione
  con SSI già qualificata)
- accesso ordinato ai documenti tecnici scenario-specific che vanno oltre gli
  indizi pubblici
- credenziali/canale `API Manager` o equivalente percorso ufficiale
- requisiti di audit, consenso, ruolo operatore e sicurezza per ogni scenario
- prova che il servizio scelto supporti davvero il grado di customizzazione UI
  desiderato

<a id="priorita-operativa-raccomandata"></a>

## Priorità operativa raccomandata

Alla luce delle fonti raccolte, il `Modulo Prescrittivo Regionale` è il primo
obiettivo: ha il valore clinico più diretto e una traccia documentale pubblica
chiara nel portale SISS. È quindi il candidato migliore per un primo
intervento `webapp-assisted`, descritto in
[docs/siss-modulo-prescrittivo-regionale.md](./siss-modulo-prescrittivo-regionale.md).

`FSE consultazione e consenso` richiede invece condizioni più delicate su
consenso, ruoli e audit e va affrontato solo dopo aver chiarito meglio il
prescrittivo. La nota dedicata è
[docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md).
`SGDT/PAI` rimane un filone più circoscritto e specifico, non il candidato
migliore per la prima integrazione ampia in MediFlow; il riferimento è
[docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md).

I `Certificati di malattia` restano fuori da questa priorità non perché siano
irrilevanti, ma perché il materiale pubblico raccolto sostiene al massimo un
futuro intervento `official-webapp handoff guard`, discusso in
[docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md).

## Sequenza consigliata dopo `WUL-178`

1. `WUL-180`: fissare il perimetro ufficiale `SSI/A2A` e la mappa di
   fattibilità.
2. `WUL-177` / `WUL-179`: trasformare i riferimenti pubblici in un corpus
   sincronizzato e interrogabile.
3. Aprire il primo intervento funzionale secondo l’ordine di priorità sopra
   descritto.
4. Solo dopo, avviare il filone runtime che gestisca credenziali, qualifica,
   audit, percorsi alternativi e UI.

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
