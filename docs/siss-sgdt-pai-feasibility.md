<!-- Codex: created 2026-05-02 -->
# SGDT/PAI per MMG/SSI: fattibilita scenario-specific

> Stato documento: `CANONICAL`

Questo documento restringe il filone `SGDT` al solo caso emerso dalle fonti
ufficiali come potenzialmente utile a MediFlow: cooperazione applicativa tra
SGDT e Cartelle Elettroniche in uso ai `MMG/PLS` per la gestione dei pazienti
cronici e dei `PAI`.

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

Le fonti ufficiali pubbliche supportano quattro conclusioni operative:

1. `SGDT` e una soluzione applicativa regionale centralizzata per processi
   sociosanitari territoriali, non un modulo paziente-scoped gia richiamabile
   da MediFlow
2. esiste pero una fonte SISS scenario-specific per la cooperazione applicativa
   con Cartelle Elettroniche `MMG/PLS` nel contesto `Presa in Carico (PIC)` dei
   pazienti cronici
3. la guida pubblica FHIR Regione Lombardia descrive SGDT come piattaforma che
   supporta scenari di cooperazione applicativa, incluso lo scenario con
   `CE-MMG` per pazienti cronici, tramite messaggistica FHIR
4. questo rende SGDT/PAI potenzialmente utile per MediFlow solo se MediFlow
   viene collocato in un perimetro `SSI-MMG` qualificato e se il caso d'uso PAI
   cronici diventa una priorita esplicita

Decisione:

- `utile piu avanti`, non runtime immediato
- nessun launcher SGDT generico da aggiungere ora
- nessun accesso SGDT dal profilo paziente finche non esiste un path ufficiale
  paziente-scoped verificato
- il primo eventuale thin slice deve essere documentale/contrattuale sul PAI,
  non UI

## Fonti ufficiali rilevanti

| Fonte | Codice/versione | Lettura operativa |
| --- | --- | --- |
| [Specifiche di cooperazione applicativa con Cartelle Elettroniche per MMG/PLS nel contesto Presa in Carico (PIC) dei pazienti cronici](https://siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?ACT=1&PR=35) | `DC-COOP-FHIR_PIC#02`, versione `1.0`, data `02/10/2024` | Il catalogo SISS descrive servizi di cooperazione applicativa SGDT per permettere ai `MMG` di accedere in modo digitalizzato e integrato con le proprie `SSI-MMG` alla redazione dei `PAI` dei pazienti cronici. |
| [Progetto FHIR per Regione Lombardia - panoramica](https://simplifier.net/guide/ig-rlfhir-draft/Home/Contesto/Panoramica-di-progetto?version=3.13.3) | IG draft `3.13.3`, aggiornamento `25/06/2024` | La guida pubblica descrive SGDT come piattaforma per processi assistenziali territoriali e include la cooperazione con `CE-MMG` per pazienti cronici tramite messaggistica FHIR. |
| [ARIA - Sistema di Gestione Digitale del Territorio](https://www.ariaspa.it/wps/portal/Aria/Home/chi-siamo/comunicazione/notizie-ed-eventi/DettaglioNews/news2022/nws-23-nov-premio-sistema-digitale/nws-23-nov-premio-sistema-digitale) | news istituzionale ARIA | SGDT viene presentato come soluzione applicativa unica e centralizzata regionale per supportare operatori sociosanitari nei processi di cura e assistenza ospedale-territorio. |
| [Programma pluriennale ARIA 2024-2026](https://www.trasparenza.ariaspa.it/wps/wcm/connect/687c8b76-c4b6-489d-837a-66d04988892d/ARIA%2BPPA_2024_2026.pdf?CACHEID=ROOTWORKSPACE-687c8b76-c4b6-489d-837a-66d04988892d-oOg.-9L&CONVERT_TO=URL&MOD=AJPERES) | `PPA2024_196` SGDT | Il piano descrive SGDT come applicativo regionale per processi sociosanitari, progetto individuale, monitoraggio e diario multidisciplinare, con integrazioni regionali come NAR, GP++ e FSE. |
| [Modello Architetturale SISS](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/Modello-architetturale) | pagina SISS | Il modello chiarisce che la cooperazione passa da infrastrutture/servizi SISS e canali aderenti, non da integrazioni libere del singolo gestionale. |

## Matrice di fattibilita SGDT/PAI

| Obiettivo | Stato | Motivo |
| --- | --- | --- |
| Aprire SGDT come modulo generico dal profilo paziente | `Non disponibile` | Le fonti raccolte non dimostrano un launcher ufficiale paziente-scoped per MediFlow. |
| Cooperazione applicativa `CE-MMG` per PAI cronici | `Documentata, ma non pronta per MediFlow` | Esiste `DC-COOP-FHIR_PIC#02`, ma richiede perimetro `SSI-MMG`, scenario, onboarding e contratto FHIR completo. |
| Usare MediFlow come supporto locale alla redazione PAI | `Utile piu avanti` | Potrebbe avere senso se MediFlow diventa o affianca una `SSI-MMG` qualificata; oggi mancano contratto, qualifica e priorita prodotto. |
| Importare o sincronizzare PAI SGDT in cartella locale | `Non disponibile` | Non c'e evidenza pubblica sufficiente per un feed PAI o per cache locale autorizzata dentro MediFlow. |
| Mostrare solo stato/readiness PAI locale | `Possibile come studio futuro` | Una checklist locale senza invio dati sarebbe coerente, ma prima va definito se PAI cronici e davvero un target di prodotto. |
| Integrare SGDT cure domiciliari/EEPA | `Fuori scope` | La guida FHIR cita anche scenari EEPA/Cure Domiciliari, ma il filone corrente riguarda solo `MMG/SSI` e pazienti cronici. |

## Confini per MediFlow

Per MediFlow, SGDT/PAI non va trattato come un altro bottone accanto a FSE o
Prescrittivo. Il caso documentato e diverso:

- non e un `portal-handoff` gia osservato
- non e una UI regionale generica pronta al richiamo contestuale
- non e un feed di PAI consultabile per codice fiscale
- e una cooperazione applicativa scenario-specific con `SSI-MMG` e messaggistica
  FHIR

Quindi i vincoli minimi sono:

1. qualifica o integrazione con `SSI-MMG` compatibile con MediFlow
2. accesso completo al documento `DC-COOP-FHIR_PIC#02` e alla guida FHIR
   applicabile
3. chiarimento del ruolo MediFlow: sistema autorevole, companion locale o solo
   preparazione operatore
4. contratto su messaggi FHIR, errori, audit, consenso e retention
5. dati sintetici per test; nessun PAI reale o documento riservato in repo

## Prima thin slice raccomandata

Non aprire ora un runtime SGDT.

La prima slice sensata, se il PAI cronici diventa prioritario, dovrebbe essere:

### `PAI readiness and contract review`

Forma:

- import locale autorizzato fuori Git del documento `DC-COOP-FHIR_PIC#02`
- lettura della guida FHIR Regione Lombardia per profili e messaggi `CE-MMG`
- matrice campi MediFlow -> requisiti PAI, solo su dati sintetici
- ADR dedicata se emerge un ruolo concreto per MediFlow

Exit criteria prima di qualunque runtime:

1. contratto FHIR applicabile identificato
2. ruoli `MMG/SSI` e responsabilita applicativa chiariti
3. audit e retention definiti
4. nessuna pretesa di accesso generico a SGDT
5. decisione prodotto esplicita: `PAI cronici` e parte della roadmap oppure no

## Decisione operativa

Per MediFlow, oggi, il target SGDT corretto e:

- `PAI readiness and contract review`, solo se diventa prioritario

e non:

- `SGDT launcher`
- `SGDT embedded UI`
- `PAI feed`
- `sync locale di PAI`
- `runtime SGDT` senza perimetro `SSI-MMG`

Questa nota chiude quindi la verifica scenario-specific senza aprire una issue
runtime automatica.
