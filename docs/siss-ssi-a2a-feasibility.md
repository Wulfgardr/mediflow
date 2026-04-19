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
| `I documenti clinici sul Fascicolo Sanitario Elettronico` (`DC-SCEN-REF#01`, `03/12/2024`) | esistono regole di integrazione dedicate ai documenti FSE |
| `Consenso alla consultazione FSE` (`DC-SCEN-ACCO#03`, `23/09/2025`) | la consultazione FSE ha uno scenario dedicato di consenso/accesso e non e un semplice fetch libero |
| `SEB FSE Gestione Eventi` (`DC-SEBC_FSE-SIAA#02`) | il perimetro FSE include interfacce SOAP specifiche |
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
| `SGDT` contestuale dal paziente | `Parzialmente documentato` | esiste un caso cooperativo specifico per PAI integrato con `SSI-MMG`, non ancora una prova di shell paziente generica SGDT |
| `Certificati di malattia` contestuali | `Non ancora sufficientemente documentato` | il filone esiste a catalogo e in FAQ/manualistica, ma non abbiamo ancora ricostruito il contratto tecnico utile per MediFlow |

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

1. [WUL-181](https://linear.app/wulfgardr/issue/WUL-181/modulo-prescrittivo-regionale-boundary-ufficiale-e-first-slice-oltre):
   `Modulo Prescrittivo Regionale`
   - e il target con il valore clinico piu diretto
   - ha gia una traccia pubblica documentale chiara nel portale SISS
   - e il candidato migliore per una first slice `webapp-assisted`
   - nota canonica dedicata:
     [docs/siss-modulo-prescrittivo-regionale.md](./siss-modulo-prescrittivo-regionale.md)
2. [WUL-182](https://linear.app/wulfgardr/issue/WUL-182/fse-consultazione-e-consenso-mappa-scenario-specific-per-integrazione):
   `FSE consultazione e consenso`
   - richiede un boundary piu delicato su consenso, ruoli e audit
   - va affrontato solo dopo aver chiarito meglio il prescrittivo
3. [WUL-183](https://linear.app/wulfgardr/issue/WUL-183/sgdt-pai-per-mmgssi-verifica-del-perimetro-cooperativo-realmente-utile):
   `SGDT/PAI`
   - resta un filone piu verticale e specifico
   - oggi non e il candidato migliore per la prima integrazione ampia dentro
     MediFlow

`Certificati di malattia` restano per ora fuori da questa priorita, non perche
irrilevanti, ma perche il materiale pubblico raccolto fin qui non basta ancora a
tagliare una first slice seria come per prescrittivo/FSE/SGDT.

## Sequenza consigliata dopo `WUL-178`

1. `WUL-180`: fissare il boundary ufficiale `SSI/A2A` e la mappa di
   fattibilita
2. `WUL-177` / `WUL-179`: trasformare i riferimenti pubblici in corpus
   sincronizzato e interrogabile
3. aprire la prima capability target in ordine di priorita:
   - [WUL-181](https://linear.app/wulfgardr/issue/WUL-181/modulo-prescrittivo-regionale-boundary-ufficiale-e-first-slice-oltre)
   - poi [WUL-182](https://linear.app/wulfgardr/issue/WUL-182/fse-consultazione-e-consenso-mappa-scenario-specific-per-integrazione)
   - poi [WUL-183](https://linear.app/wulfgardr/issue/WUL-183/sgdt-pai-per-mmgssi-verifica-del-perimetro-cooperativo-realmente-utile)
4. solo dopo, aprire il workstream runtime che gestisca credenziali,
   qualifica, audit, fallback e UI

## Fonti ufficiali principali

- [Modello Architetturale SISS](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/Modello-architetturale)
- [Integrazione Application to Application (A2A)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/integrazione-application-to-application)
- [Scenari di Integrazione](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/scenari-di-integrazione)
- [Linee Guida Regionali](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/linee-guida-regionali)
- [Procedura di Qualificazione Scheda Sanitaria Informatica (SSI)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/procedure-di-verifica-e-qualificazione/procedura-di-qualificazione-scheda-sanitaria-informatica-ssi)
- [Service Provider di MMG/PDF](https://www.siss.regione.lombardia.it/wps/portal/site/siss/DettaglioRedazionale/servizi-per-il-territorio/service-provider/di-mmg-pdf/red-mmg-pdf/red-mmg-pdf/%21ut/p/z0/fYyxDoIwFAC_hQ94eQhIcGxYFEOMupQuprEFX4S2eTYd_HpZ3Izj5S6HCiUqpxNNOpJ3el55UPXtJLb1vqg2XdPtyvx8LS9tfzg2lcixQ_U_WA8F920_oQo6PoDc6FG-LCd6EwTLQDNEy0zRM33V3UJgn8hYRmkIlmWCYEaUbM1vCE81CJFlH35Jatw%21/)
- [Portale pubblico documentazione SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.jsp)
- [FAQ SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.jsp)
