# Modulo Prescrittivo Regionale: boundary ufficiale oltre il `portal-handoff`

> Stato documento: `CANONICAL`

Il filone `WUL-181` riguarda soltanto il `Modulo Prescrittivo Regionale`.
L’esigenza è accompagnare meglio il passaggio dalla cartella alla prescrizione,
senza confondere quattro livelli diversi: il `portal-handoff` già disponibile,
il richiamo della `web application` ufficiale, un’integrazione più profonda con
backend o WS SISS e una UI prescrittiva costruita in MediFlow. Quest’ultima non
è dimostrata dalle sole fonti pubbliche raccolte.

Riferimenti canonici:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)
- [docs/siss-baseline.md](./siss-baseline.md)
- [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md)
- [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md)
- [docs/adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md](./adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md)

<a id="executive-summary"></a>

## Esito della ricognizione

Stato della ricognizione: 15 aprile 2026.

Le fonti raccolte descrivono `Ricetta Elettronica` come un servizio di
piattaforma per prescrizione ed erogazione, non soltanto una pagina del
portale. Il `Modulo Prescrittivo Regionale` è una `web application` ufficiale
censita nel catalogo pubblico SISS; i documenti sulle `Credenziali API SISS`
mostrano inoltre che esiste un percorso verso i WS, ma che l’accesso è regolato.

L’architettura supporta sia `A2A` sia `Web Application`. Attraverso
`API Manager`, una webapp dell’Aderente può accedere ai WS SISS senza integrare
la `Porta Delegata` della postazione dell’operatore. Nessuna di queste evidenze
dimostra però che MediFlow possa ricostruire l’intero prescrittivo con una
propria UI e logica transazionale locale.

Il primo passo credibile oltre il comando di apertura è dunque
`webapp-assisted`: assistenza all’uso del modulo ufficiale, non un
`custom prescribing engine`.

## Fonti ufficiali rilevanti

### 1. Il SISS tratta la prescrizione come servizio di piattaforma

La pagina ufficiale `Ricetta Elettronica` descrive la dematerializzazione del
ciclo prescrittivo, gli strumenti e i servizi di prescrizione ed erogazione e
l’uso del `Numero di Ricetta Elettronico (NRE)` acquisito dal `MEF`.

La prescrizione appartiene quindi a un dominio con regole centrali. Non è un
semplice form locale che MediFlow possa copiare.

<a id="2-laccesso-operatore-e-fondato-su-credenziale-siss"></a>

### 2. L'accesso operatore è fondato su credenziale SISS

La pagina `Modalita di accesso` descrive l’autenticazione dell’operatore
tramite `SSO` centrale e la restituzione di `Credenziale` e
`Certificato di sessione`. Per `A2A` la credenziale passa nell’header `SOAP`;
per `Web Application`, nell’header `HTTP`.

Una vera integrazione prescrittiva deve quindi rispettare `Carta Operatore`,
credenziale e contesto funzionale. Il suo confine tecnico non coincide con la
semplice apertura di una URL.

### 3. Il modello SISS supporta sia `A2A` sia `Web Application`

La pagina `Integrazione Application to Application (A2A)` ammette
l’integrazione diretta tra applicazioni per servizi primari e aggiuntivi del
SISS. La modalità nominale resta quella predefinita; la `Procedura Automatica`
consente invece a un server di operare per conto dell’operatore autorizzato.
Tramite `API Manager`, gli Aderenti possono implementare `Web Application`
che accedano ai WS senza integrare la `Porta Delegata` della postazione.

Una webapp MediFlow integrata è perciò concepibile sul piano architetturale.
Questo non rende il `Modulo Prescrittivo Regionale` liberamente richiamabile
o reimplementabile senza scenario e credenziali.

### 4. Il catalogo pubblico SISS espone il Modulo Prescrittivo Regionale

La ricerca pubblica del portale documentale SISS mostra, al 15 aprile 2026:

| Titolo | Codice | Versione | Data | Lettura operativa |
| --- | --- | --- | --- | --- |
| `Specifiche di integrazione Modulo Prescrittivo Regionale` | `ARIA-PRREG-SIAA@01` | `1.0` | `02/12/2025` | il documento descrive come richiamare la `web application` del Modulo Prescrittivo Regionale che consente a operatori abilitati di produrre ricette farmaceutiche, specialistico-ambulatoriali e di ricovero |
| `Manuale Utente Modulo Prescrittivo Regionale` | `CRS-FORM-MES#884` | `3.1` | `03/12/2025` | esiste manualistica utente/configuratore del nuovo modulo prescrittivo regionale |
| `Credenziali API SISS` | `DC-CREDENZIALI-API-...` | `5.8` | `11/11/2024` | il modulo serve a ottenere le credenziali `API Manager` per l'accesso ai `WS` del SISS |

La traccia pubblica più solida combina quindi `web application ufficiale` e
`credenziali API Manager`. Il punto decisivo è ciò che la documentazione
descrive: `richiamo della web application`, non `replica completa del modulo`
all’interno di un’altra UI.

<a id="5-il-portale-siss-documenta-un-precedente-tecnico-regionale-per-i-moduli"></a>

### 5. Un precedente tecnico regionale per i moduli prescrittivi

Le fonti pubbliche sulla `Piattaforma Regionale di Integrazione (PRI)` e il
catalogo documentale mostrano che `SISS-Way Modulo Prescrittivo` era già una
componente regionale documentata (`AS-PS_R-MES#08`). Nella `NPRI` compare
inoltre il riferimento pubblico a `NPRI: Modulo Prescrittivo`.

La Regione ha dunque supportato storicamente moduli prescrittivi più
strutturati del portale generalista. Questo rafforza la scelta di lavorare
sul rapporto con un modulo ufficiale, non su un semplice inventario di link.

<a id="6-le-faq-pubbliche-confermano-che-il-prescrittivo-puo-fare-da-front-end-a"></a>

### 6. Il prescrittivo come interfaccia dei servizi SISS di cittadino ed esenzione

Le FAQ pubbliche SISS sulle esenzioni descrivono le `SSII` usate dai `MMG/PDF`
per allineare l’anagrafe locale ai dati regionali. Lo specialista può usare
un `modulo prescrittivo integrato con il SISS` oppure i servizi
`Identifica Cittadino` e `Classe di Esenzione`. È indicata anche una
`Web Application`, accessibile ai prescrittori con `Carta Operatore`, per
verificare le esenzioni del singolo cittadino.

Il `Modulo Prescrittivo Regionale` non serve quindi soltanto a compilare
ricette: è anche un punto di accesso a servizi contestuali ufficiali.
MediFlow può ragionevolmente assisterne l’uso, non assumerlo come modello da
ricostruire in proprio.

<a id="boundary-tecnico-risultante"></a>

## Confine tecnico risultante

| Opzione | Stato | Motivo |
| --- | --- | --- |
| `portal-handoff` attuale verso prescrizione | `Disponibile ora` | già presente nel percorso della preview SISS, senza qualifica prescrittiva |
| Richiamo esplicito della `web application` ufficiale del Modulo Prescrittivo Regionale | `Fattibile con onboarding regionale` | esiste documentazione pubblica scenario-specific sul richiamo della webapp |
| Uso di `API Manager` / WS SISS a supporto della webapp dell'Aderente | `Architetturalmente plausibile ma da qualificare` | il modello SISS lo supporta, ma servono credenziali e scenario coerente |
| Re-implementazione completa del modulo prescrittivo dentro UI MediFlow | `Non dimostrata` | le fonti raccolte non bastano a provare che logica, firme, controlli, NRE e flussi possano essere ricreati localmente in modo conforme |
| Prefill completo di paziente/ricetta dal gestionale alla webapp regionale | `Non dimostrato` | il documento pubblico raccolto parla di `come richiamare` la webapp, non ancora di quali parametri strutturati siano supportati |

<a id="prima-thin-slice-raccomandata"></a>

## Primo intervento raccomandato

La raccomandazione che ha guidato il primo intervento runtime è:

### `Modulo Prescrittivo Regionale - webapp-assisted`

MediFlow coordina localmente il contesto del paziente, mentre l’atto
prescrittivo resta nel `Modulo Prescrittivo Regionale` ufficiale e l’operatore
continua a usare credenziale e sessione SISS ufficiali.

L’obiettivo minimo è verificare i prerequisiti runtime ufficiali, aprire la
webapp dal contesto paziente con il massimo grado di continuità consentito
dai documenti e non duplicare in MediFlow la logica clinico-amministrativa
del modulo.

## Aggiornamento runtime `WUL-184`

Il primo intervento runtime coerente con questa decisione richiama la root
ufficiale della webapp del `Modulo Prescrittivo Regionale`, senza deep-link
non necessari alla compilazione interna. Prepara localmente il `CF` del
paziente e registra un audit `PHI-safe` dell’apertura da MediFlow, così da
ridurre i passaggi manuali senza dichiarare un’integrazione prescrittiva
nativa o certificata.

L’implementazione resta quindi un `webapp-assisted official path`. Non
introduce una `UI prescrittiva custom`, un `prefill clinico-amministrativo`
non dimostrato o un `consumo diretto dei WS SISS` privo di onboarding e
coerenza con lo scenario.

## Aggiornamento 2026-07-11: percorso osservato verso PRREG

Nella sessione operatore locale osservata il 10 luglio 2026 è stato raggiunto
il Prescrittivo Regionale (PRREG), con root `/prescrittivoRegionale` e una
dashboard di ingresso con le azioni Nuova Prescrizione e Ricerca Prescrizioni.
La superficie osservata riunisce farmaci e specialistica in una ricerca a
campo libero: rende meno oneroso il passaggio al portale, senza cambiarne la
natura. La root legacy `/prescrizione/` resta il riferimento in transizione.
L’osservazione documenta quella navigazione, non un contratto API né una
distribuzione universale del modulo.

L’aggiornamento del launcher MediFlow apre la dashboard PRREG mantenendo lo
stesso comportamento: copia locale del CF negli appunti, nessun dato personale
nella URL e audit locale privo di PHI. Il pannello accanto al comando di
apertura mostra in sola lettura terapie attive, prescrizioni specialistiche
recenti, esenzioni e diagnosi, con copia rapida dei singoli valori. Serve a
ridurre gli andirivieni durante la compilazione manuale; il client nativo
Apple offre la stessa apertura assistita.

L’atto prescrittivo rimane nel portale e usa l’autenticazione personale del
medico. I criteri della sezione seguente restano obbligatori per qualsiasi
passo ulteriore.

<a id="acceptance-criteria-per-una-futura-issue-runtime"></a>

## Criteri di accettazione per un futuro intervento runtime

Ogni futura implementazione runtime dovrà dimostrare almeno quanto segue:

1. usa solo percorsi ufficiali documentati per il richiamo del modulo
2. non richiede reverse engineering del frontend regionale
3. non assume prefill di dati non esplicitamente supportato dalla
   documentazione/scenario raccolti
4. preserva il confine della credenziale operatore e del contesto funzionale
5. mantiene audit locale PHI-safe del solo handoff/coordinamento MediFlow
6. non dichiara `prescrittivo nativo MediFlow` se l'atto prescrittivo resta
   dentro la webapp regionale

## Cosa non sappiamo ancora

Per decidere un passo ulteriore, il corpus sincronizzato e le specifiche di
scenario devono ancora chiarire:

- quali parametri il `Modulo Prescrittivo Regionale` accetti davvero al
  richiamo
- se sia ammesso un pre-posizionamento sul paziente
- se i servizi `Identifica Cittadino` / `Classe di Esenzione` siano utili a
  una slice MediFlow separata o già assorbiti dal modulo
- se esistano flussi ufficiali per `procedura automatica` coerenti col
  prescrittivo territoriale

## Decisione operativa

Il percorso scelto per il prescrittivo è `webapp-assisted official path`:
MediFlow assiste l’uso del modulo ufficiale. Non è un
`custom prescribing engine`, una `UI custom completa` o un
`embedding/prefill spinto` non dimostrato dai documenti raccolti.

## Fonti ufficiali principali

- [Ricetta Elettronica](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/principali-servizi-offerti/ricetta-elettronica)
- [Modalità di accesso](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/modalita-di-accesso)
- [Integrazione Application to Application (A2A)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/integrazione-application-to-application)
- [Linee Guida Regionali](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/linee-guida-regionali)
- [Procedura di Qualificazione Scheda Sanitaria Informatica (SSI)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/procedure-di-verifica-e-qualificazione/procedura-di-qualificazione-scheda-sanitaria-informatica-ssi)
- [Di MMG/PDF](https://www.siss.regione.lombardia.it/wps/portal/site/siss/DettaglioRedazionale/servizi-per-il-territorio/service-provider/di-mmg-pdf/red-mmg-pdf/red-mmg-pdf/%21ut/p/z0/fYyxDoIwFAC_hQ94eQhIcGxYFEOMupQuprEFX4S2eTYd_HpZ3Izj5S6HCiUqpxNNOpJ3el55UPXtJLb1vqg2XdPtyvx8LS9tfzg2lcixQ_U_WA8F920_oQo6PoDc6FG-LCd6EwTLQDNEy0zRM33V3UJgn8hYRmkIlmWCYEaUbM1vCE81CJFlH35Jatw%21/)
- [Piattaforma Regionale di Integrazione](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/piattaforma-regionale-di-integrazione)
- [Portale pubblico documentazione SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.jsp)
- [FAQ SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.jsp)
