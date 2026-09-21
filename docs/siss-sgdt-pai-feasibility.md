<a id="sgdtpai-per-mmgssi-fattibilita-scenario-specific"></a>

# SGDT/PAI per MMG/SSI: fattibilità scenario-specific

> Stato documento: `CANONICAL`

Per valutare l’utilità di `SGDT` in MediFlow occorre partire dai casi
documentati, non dall’idea di un modulo regionale generico. Questa nota
considera soltanto la cooperazione con le Cartelle Elettroniche dei `MMG/PLS`
per pazienti cronici e `PAI`, e il flusso `COT` delle richieste di transizione
registrate dai `MMG/PLS`. Quest’ultimo resta un processo organizzativo SGDT,
non una funzione runtime di MediFlow.

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

`SGDT` è descritto come una soluzione regionale centralizzata per i processi
sociosanitari territoriali, non come un modulo già richiamabile da MediFlow
per il singolo paziente. Esiste però una fonte SISS specifica sulla
cooperazione con le Cartelle Elettroniche `MMG/PLS` nel contesto
`Presa in Carico (PIC)` dei pazienti cronici. La guida pubblica FHIR di Regione
Lombardia comprende a sua volta lo scenario con `CE-MMG`, attraverso
messaggistica FHIR.

Il catalogo SISS indicizza inoltre manuali COT che descrivono come le
richieste di transizione inserite dal `MMG/PLS` in SGDT siano gestite dalle
Centrali Operative Territoriali. Sono processi con attori e responsabilità
organizzative, non semplici dati clinici da leggere o scrivere in cartella.

L’interesse per MediFlow resta quindi subordinato a un perimetro `SSI-MMG`
qualificato e a una scelta esplicita di prodotto sul PAI dei pazienti cronici.
L’esito è `utile piu avanti`, non runtime immediato: nessun launcher SGDT
generico e nessun accesso dal profilo paziente finché non esista un percorso
ufficiale verificato per quel contesto. Il filone COT resta `defer`. Il primo
eventuale intervento deve riguardare documenti e contratti PAI o COT, non la UI.

## Fonti ufficiali rilevanti

| Fonte | Codice/versione | Lettura operativa |
| --- | --- | --- |
| [Specifiche di cooperazione applicativa con Cartelle Elettroniche per MMG/PLS nel contesto Presa in Carico (PIC) dei pazienti cronici](https://siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?ACT=1&PR=35) | `DC-COOP-FHIR_PIC#02`, versione `1.0`, data `02/10/2024` | Il catalogo SISS descrive servizi di cooperazione applicativa SGDT per permettere ai `MMG` di accedere in modo digitalizzato e integrato con le proprie `SSI-MMG` alla redazione dei `PAI` dei pazienti cronici. |
| `Coinvolgimento dei MMG/PLS nel modello di Interconnessione delle Centrali Operative Territoriali` | `CRS-FORMS-MRS#899`, versione `1.1`, data `19/12/2025` | Il catalogo SISS descrive come le richieste di transizione registrate dal `MMG/PLS` in SGDT vengono gestite tramite `COT`, che attivano i soggetti erogatori dei servizi socio-assistenziali richiesti. |
| `Vademecum operativo per la figura professionale del Medico di Medicina Generale` | `CRS-FORM-MES#896`, versione `2.0`, data `19/12/2025` | Il catalogo SISS cita l'uso di SGDT per attivare Cure Domiciliari e Presa in Carico dei pazienti cronici da parte di `MMG/PLS`. |
| [Progetto FHIR per Regione Lombardia - panoramica](https://simplifier.net/guide/ig-rlfhir-draft/Home/Contesto/Panoramica-di-progetto?version=3.13.3) | IG draft `3.13.3`, aggiornamento `25/06/2024` | La guida pubblica descrive SGDT come piattaforma per processi assistenziali territoriali e include la cooperazione con `CE-MMG` per pazienti cronici tramite messaggistica FHIR. |
| [ARIA - Sistema di Gestione Digitale del Territorio](https://www.ariaspa.it/wps/portal/Aria/Home/chi-siamo/comunicazione/notizie-ed-eventi/DettaglioNews/news2022/nws-23-nov-premio-sistema-digitale/nws-23-nov-premio-sistema-digitale) | news istituzionale ARIA | SGDT viene presentato come soluzione applicativa unica e centralizzata regionale per supportare operatori sociosanitari nei processi di cura e assistenza ospedale-territorio. |
| [Programma pluriennale ARIA 2024-2026](https://www.trasparenza.ariaspa.it/wps/wcm/connect/687c8b76-c4b6-489d-837a-66d04988892d/ARIA%2BPPA_2024_2026.pdf?CACHEID=ROOTWORKSPACE-687c8b76-c4b6-489d-837a-66d04988892d-oOg.-9L&CONVERT_TO=URL&MOD=AJPERES) | `PPA2024_196` SGDT | Il piano descrive SGDT come applicativo regionale per processi sociosanitari, progetto individuale, monitoraggio e diario multidisciplinare, con integrazioni regionali come NAR, GP++ e FSE. |
| [Modello Architetturale SISS](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/Modello-architetturale) | pagina SISS | Il modello chiarisce che la cooperazione passa da infrastrutture/servizi SISS e canali aderenti, non da integrazioni libere del singolo gestionale. |

<a id="matrice-di-fattibilita-sgdtpai"></a>

## Matrice di fattibilità SGDT/PAI

| Obiettivo | Stato | Motivo |
| --- | --- | --- |
| Aprire SGDT come modulo generico dal profilo paziente | `Non disponibile` | Le fonti raccolte non dimostrano un launcher ufficiale paziente-scoped per MediFlow. |
| Cooperazione applicativa `CE-MMG` per PAI cronici | `Documentata, ma non pronta per MediFlow` | Esiste `DC-COOP-FHIR_PIC#02`, ma richiede perimetro `SSI-MMG`, scenario, onboarding e contratto FHIR completo. |
| Usare MediFlow come supporto locale alla redazione PAI | `Utile piu avanti` | Potrebbe avere senso se MediFlow diventa o affianca una `SSI-MMG` qualificata; mancano ancora contratto, qualifica e priorità di prodotto. |
| Importare o sincronizzare PAI SGDT in cartella locale | `Non disponibile` | Non c’è evidenza pubblica sufficiente per un feed PAI o per cache locale autorizzata dentro MediFlow. |
| Mostrare solo stato/readiness PAI locale | `Possibile come studio futuro` | Una checklist locale senza invio dati sarebbe coerente, ma prima va definito se il PAI dei pazienti cronici sia davvero un obiettivo di prodotto. |
| Richieste di transizione SGDT -> COT | `Defer` | Le fonti pubbliche confermano workflow e attori, ma non un contratto MediFlow né un punto paziente-scoped riusabile senza documenti ufficiali completi. |
| Attivazione soggetti erogatori tramite COT | `Fuori scope runtime` | È un flusso organizzativo territoriale gestito da `COT`; MediFlow non deve assumere il ruolo di sistema di dispatch o coordinamento. |
| Integrare SGDT cure domiciliari/EEPA | `Fuori scope` | La guida FHIR cita anche scenari EEPA/Cure Domiciliari, ma il filone corrente riguarda solo `MMG/SSI` e pazienti cronici. |

## Confini per MediFlow

SGDT/PAI non va aggiunto come un altro pulsante accanto a FSE o Prescrittivo.
Il caso documentato non è un `portal-handoff` già osservato, una UI regionale
pronta al richiamo contestuale o un flusso di PAI consultabile per codice
fiscale. È una cooperazione applicativa specifica con `SSI-MMG` e messaggistica
FHIR; per `COT` riguarda invece transizione e attivazione territoriale, con
attori propri.

Prima di procedere servono quindi almeno questi elementi:

1. qualifica o integrazione con `SSI-MMG` compatibile con MediFlow
2. accesso completo al documento `DC-COOP-FHIR_PIC#02` e alla guida FHIR
   applicabile
3. accesso locale autorizzato ai manuali COT/MMG se il filone transizioni
   diventa prioritario
4. chiarimento del ruolo MediFlow: sistema autorevole, companion locale o solo
   preparazione operatore
5. contratto su messaggi FHIR, errori, audit, consenso e retention
6. dati sintetici per test; nessun PAI reale, richiesta COT reale o documento
   riservato in repo

<a id="prima-thin-slice-raccomandata"></a>

## Primo intervento raccomandato

Non aprire ora un runtime SGDT. Se il PAI dei pazienti cronici o il flusso COT
diventano prioritari, il primo intervento raccomandato riguarda requisiti e contratto:

### `PAI/COT readiness and contract review`

Il lavoro parte dall’importazione locale autorizzata, fuori Git, di
`DC-COOP-FHIR_PIC#02` e, se l’obiettivo riguarda le richieste di transizione,
dei manuali COT/MMG. La lettura della guida FHIR di Regione Lombardia sui
profili e messaggi `CE-MMG` deve consentire di confrontare i campi MediFlow
con i requisiti PAI/COT, usando solo dati sintetici. Se emerge un ruolo
concreto per MediFlow, serve un ADR dedicato.

Prima di qualsiasi runtime devono essere soddisfatti questi criteri:

1. contratto FHIR applicabile identificato
2. ruoli `MMG/SSI` e responsabilità applicativa chiariti
3. attori COT, stati di transizione e soggetti erogatori chiariti se il caso
   d'uso riguarda le transizioni
4. audit e retention definiti
5. nessuna pretesa di accesso generico a SGDT
6. decisione prodotto esplicita: `PAI cronici` o `COT/transizioni` sono parte
   della roadmap oppure no

## Decisione operativa

Il lavoro ammesso è `PAI/COT readiness and contract review`, solo se diventa
prioritario. Non comprende `SGDT launcher`, `SGDT embedded UI`, `PAI feed`,
`COT dispatch`, `sync locale di PAI` o `runtime SGDT` senza perimetro
`SSI-MMG`.

La nota conclude la verifica dello scenario, senza aprire automaticamente
una issue runtime.
