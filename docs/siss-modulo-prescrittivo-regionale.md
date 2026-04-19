# Modulo Prescrittivo Regionale: boundary ufficiale oltre il `portal-handoff`

> Stato documento: `CANONICAL`

Questo documento restringe il filone `WUL-181` al solo `Modulo Prescrittivo
Regionale`, separando:

- il `portal-handoff` gia disponibile in MediFlow
- il richiamo della `web application` ufficiale regionale
- l'integrazione piu profonda con backend/WS SISS
- la UI custom MediFlow, che oggi non e ancora dimostrata dalle sole fonti
  pubbliche raccolte

Riferimenti canonici:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)
- [docs/siss-baseline.md](./siss-baseline.md)
- [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md)
- [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md)
- [docs/adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md](./adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md)

## Executive summary

Stato della ricognizione: 15 aprile 2026.

Le fonti ufficiali raccolte fin qui supportano cinque conclusioni operative:

1. `Ricetta Elettronica` nel SISS non e solo una pagina del portale: il
   servizio espone strumenti e servizi di prescrizione/erogazione a livello di
   piattaforma
2. il `Modulo Prescrittivo Regionale` esiste come `web application` ufficiale
   documentata nel catalogo pubblico SISS
3. esistono anche documenti pubblici su `Credenziali API SISS`, quindi il
   percorso verso i WS SISS e reale ma regolato
4. l'architettura SISS supporta sia `A2A` sia `Web Application`; nel contesto
   `API Manager`, una webapp dell'Aderente puo accedere ai WS SISS senza
   integrare la `Porta Delegata` della PdL dell'operatore
5. nessuna delle fonti pubbliche raccolte finora dimostra che MediFlow possa
   gia ricostruire in proprio l'intero modulo prescrittivo con UI custom e
   logica transazionale locale

Conclusione:

- il primo step credibile oltre il launcher attuale e una slice
  `webapp-assisted`, non un `custom prescribing engine`

## Fonti ufficiali rilevanti

### 1. Il SISS tratta la prescrizione come servizio di piattaforma

La pagina ufficiale `Ricetta Elettronica` spiega che il SISS:

- abilita la dematerializzazione del ciclo prescrittivo
- mette a disposizione strumenti e servizi di prescrizione ed erogazione
- usa il `Numero di Ricetta Elettronico (NRE)` acquisito dal `MEF`

Implicazione:

- il dominio prescrittivo ha regole centrali, non e un semplice form locale da
  copiare in MediFlow

### 2. L'accesso operatore e fondato su credenziale SISS

La pagina `Modalita di accesso` chiarisce che:

- l'operatore viene autenticato tramite `SSO` centrale
- il SISS restituisce `Credenziale` e `Certificato di sessione`
- per `A2A` la credenziale va nell'header `SOAP`
- per `Web Application` la credenziale va nell'header `HTTP`

Implicazione:

- una vera integrazione prescrittiva non puo ignorare il tema
  `Carta Operatore` / credenziale / contesto funzionale
- il boundary tecnico non e solo "aprire una URL"

### 3. Il modello SISS supporta sia `A2A` sia `Web Application`

La pagina `Integrazione Application to Application (A2A)` precisa che:

- l'integrazione diretta tra applicazioni e ammessa per servizi primari del
  SISS e servizi aggiuntivi
- la modalita nominale resta il default
- esiste anche la `Procedura Automatica`, che delega un server ad operare per
  conto dell'operatore autorizzato
- tramite `API Manager` si possono implementare `Web Application` presso gli
  Aderenti che accedono ai WS del SISS senza integrare la `Porta Delegata`
  della postazione operatore

Implicazione:

- una futura webapp MediFlow integrata e architetturalmente concepibile
- ma questo non equivale a dire che il `Modulo Prescrittivo Regionale` sia gia
  re-implementabile o chiamabile liberamente senza scenario e credenziali

### 4. Il catalogo pubblico SISS espone il Modulo Prescrittivo Regionale

La ricerca pubblica del portale documentale SISS mostra, al 15 aprile 2026:

| Titolo | Codice | Versione | Data | Lettura operativa |
| --- | --- | --- | --- | --- |
| `Specifiche di integrazione Modulo Prescrittivo Regionale` | `ARIA-PRREG-SIAA@01` | `1.0` | `02/12/2025` | il documento descrive come richiamare la `web application` del Modulo Prescrittivo Regionale che consente a operatori abilitati di produrre ricette farmaceutiche, specialistico-ambulatoriali e di ricovero |
| `Manuale Utente Modulo Prescrittivo Regionale` | `CRS-FORM-MES#884` | `3.1` | `03/12/2025` | esiste manualistica utente/configuratore del nuovo modulo prescrittivo regionale |
| `Credenziali API SISS` | `DC-CREDENZIALI-API-...` | `5.8` | `11/11/2024` | il modulo serve a ottenere le credenziali `API Manager` per l'accesso ai `WS` del SISS |

Implicazione:

- la traccia pubblica piu forte oggi e: `web application ufficiale` +
  `credenziali API Manager`
- la documentazione pubblica raccolta parla esplicitamente di `richiamo della
  web application`, non di `replica completa del modulo` dentro un'altra UI

### 5. Il portale SISS documenta un precedente tecnico regionale per i moduli
 prescrittivi

Le fonti pubbliche su `Piattaforma Regionale di Integrazione (PRI)` e sul
catalogo documentale mostrano che:

- `SISS-Way Modulo Prescrittivo` era gia una componente regionale documentata
  (`AS-PS_R-MES#08`)
- nella `NPRI` esiste ancora un riferimento pubblico a `NPRI: Modulo
  Prescrittivo`

Implicazione:

- il contesto regionale ha storicamente supportato moduli prescrittivi piu
  strutturati del solo portale generalista
- questo rafforza la scelta di trattare la prossima slice come integrazione con
  un modulo ufficiale, non come inventario di link

### 6. Le FAQ pubbliche confermano che il prescrittivo puo fare da front-end a
 servizi SISS di cittadino/esenzione

Nelle FAQ pubbliche SISS sulla gestione delle esenzioni si legge che:

- `MMG/PDF` usano `SSII` integrate che allineano l'anagrafe locale ai dati
  dell'Anagrafe Regionale
- il medico specialista puo operare usando un `modulo prescrittivo integrato
  con il SISS`
- in alternativa puo usare i servizi `Identifica Cittadino` e `Classe di
  Esenzione`
- e indicata anche una `Web Application` accessibile ai medici prescrittori con
  `Carta Operatore` per verificare le esenzioni del singolo cittadino

Implicazione:

- il `Modulo Prescrittivo Regionale` non e solo editor di ricette: e anche
  punto di accesso a servizi contestuali ufficiali
- MediFlow puo ragionevolmente puntare a sfruttare questo modulo come shell
  ufficiale assistita, non come sostituto da ricostruire in proprio

## Boundary tecnico risultante

| Opzione | Stato | Motivo |
| --- | --- | --- |
| `portal-handoff` attuale verso prescrizione | `Disponibile ora` | gia in produzione dentro la preview SISS |
| Richiamo esplicito della `web application` ufficiale del Modulo Prescrittivo Regionale | `Fattibile con onboarding regionale` | esiste documentazione pubblica scenario-specific sul richiamo della webapp |
| Uso di `API Manager` / WS SISS a supporto della webapp dell'Aderente | `Architetturalmente plausibile ma da qualificare` | il modello SISS lo supporta, ma servono credenziali e scenario coerente |
| Re-implementazione completa del modulo prescrittivo dentro UI MediFlow | `Non dimostrata` | le fonti raccolte non bastano a provare che logica, firme, controlli, NRE e flussi possano essere ricreati localmente in modo conforme |
| Prefill completo di paziente/ricetta dal gestionale alla webapp regionale | `Non dimostrato` | il documento pubblico raccolto parla di `come richiamare` la webapp, non ancora di quali parametri strutturati siano supportati |

## Prima thin slice raccomandata

La prossima slice runtime, se e quando verra aperta, dovrebbe essere:

### `Modulo Prescrittivo Regionale - webapp-assisted`

Forma:

- MediFlow resta orchestratore locale del contesto paziente
- l'atto prescrittivo vero avviene nel `Modulo Prescrittivo Regionale`
  ufficiale
- l'operatore continua a usare credenziale/sessione SISS ufficiale

Obiettivo minimo:

1. verificare i prerequisiti runtime ufficiali minimi
2. aprire la webapp ufficiale dal contesto paziente con il massimo grado di
   continuita consentito dai documenti
3. non duplicare in MediFlow la logica clinico-amministrativa del modulo

## Aggiornamento runtime `WUL-184`

La prima slice runtime coerente con questa decisione oggi fa tre cose:

1. richiama la root ufficiale della webapp del `Modulo Prescrittivo
   Regionale`, evitando deep-link non necessari alla compilazione interna
2. prepara in locale il `CF` del paziente per ridurre l'attrito operativo
3. scrive un audit locale `PHI-safe` del launch MediFlow, senza dichiarare una
   integrazione prescrittiva nativa o certificata

Questa implementazione resta quindi dentro il perimetro:

- `webapp-assisted official path`

e non sposta ancora MediFlow verso:

- `UI prescrittiva custom`
- `prefill clinico-amministrativo` non dimostrato
- `consumo diretto dei WS SISS` senza onboarding/coerenza scenario

## Acceptance criteria per una futura issue runtime

Una futura implementazione runtime dovra dimostrare almeno questo:

1. usa solo percorsi ufficiali documentati per il richiamo del modulo
2. non richiede reverse engineering del frontend regionale
3. non assume prefill di dati non esplicitamente supportato dalla
   documentazione/scenario raccolti
4. preserva il boundary della credenziale operatore e del contesto funzionale
5. mantiene audit locale PHI-safe del solo handoff/orchestrazione MediFlow
6. non dichiara `prescrittivo nativo MediFlow` se l'atto prescrittivo resta
   dentro la webapp regionale

## Cosa non sappiamo ancora

Restano da verificare nel corpus sincronizzato e nelle specifiche scenario:

- quali parametri il `Modulo Prescrittivo Regionale` accetti davvero al
  richiamo
- se sia ammesso un pre-posizionamento sul paziente
- se i servizi `Identifica Cittadino` / `Classe di Esenzione` siano utili a
  una slice MediFlow separata o gia assorbiti dal modulo
- se esistano flussi ufficiali per `procedura automatica` coerenti col
  prescrittivo territoriale

## Decisione operativa

Per MediFlow, oggi, il target giusto per il prescrittivo e:

- `webapp-assisted official path`

e non:

- `custom prescribing engine`
- `UI custom completa`
- `embedding/prefill spinto` non dimostrato dai documenti raccolti

## Fonti ufficiali principali

- [Ricetta Elettronica](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/principali-servizi-offerti/ricetta-elettronica)
- [Modalita di accesso](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/modalita-di-accesso)
- [Integrazione Application to Application (A2A)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/integrazione-application-to-application)
- [Linee Guida Regionali](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/linee-guida-regionali)
- [Procedura di Qualificazione Scheda Sanitaria Informatica (SSI)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/procedure-di-verifica-e-qualificazione/procedura-di-qualificazione-scheda-sanitaria-informatica-ssi)
- [Di MMG/PDF](https://www.siss.regione.lombardia.it/wps/portal/site/siss/DettaglioRedazionale/servizi-per-il-territorio/service-provider/di-mmg-pdf/red-mmg-pdf/red-mmg-pdf/%21ut/p/z0/fYyxDoIwFAC_hQ94eQhIcGxYFEOMupQuprEFX4S2eTYd_HpZ3Izj5S6HCiUqpxNNOpJ3el55UPXtJLb1vqg2XdPtyvx8LS9tfzg2lcixQ_U_WA8F920_oQo6PoDc6FG-LCd6EwTLQDNEy0zRM33V3UJgn8hYRmkIlmWCYEaUbM1vCE81CJFlH35Jatw%21/)
- [Piattaforma Regionale di Integrazione](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/piattaforma-regionale-di-integrazione)
- [Portale pubblico documentazione SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.jsp)
- [FAQ SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.jsp)
