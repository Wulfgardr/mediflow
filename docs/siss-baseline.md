<!-- Codex: created 2026-03-18 -->
# SISS Baseline Canonica

> Stato documento: `CANONICAL`

Questo documento fissa la baseline SISS di MediFlow per il filone `WUL-43`.
Serve a separare chiaramente lo stato attuale, ancora basato su shortcut web,
dal target certificato che verrà affrontato in modo controllato con i follow-up
`WUL-45`, `WUL-44` e `WUL-178`.

Riferimenti canonici:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [PLANS.md](../PLANS.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)
- [docs/walkthrough.md](./walkthrough.md)
- [docs/COMPLIANCE.md](./COMPLIANCE.md)

## Stato attuale

MediFlow non integra ancora una catena SISS certificata.
Lo stato presente è un comportamento di servizio locale che:

- espone un mediatore backend locale per l'handoff contestuale verso i portali `operatorisiss`
- apre dal paziente i moduli `Menu SISS`, `Ricetta Elettronica`, `FSE` e `Anagrafe`
- copia il Codice Fiscale negli appunti quando il flusso lo richiede
- delega comunque all'operatore il completamento manuale nel portale esterno

Questo significa che:

- esiste un backend locale mediato da MediFlow, ma limitato al `portal-handoff`
- non esiste un canale certificato locale per autenticazione o prescrizione
- non esistono certificati o adapter SISS gestiti dall'app
- esiste un foundation layer locale con error taxonomy, correlation id e retry sui transienti, ma non ancora un audit certificato end-to-end verso i servizi regionali

## Allineamento con le fonti ufficiali

Al 15 aprile 2026 le fonti ufficiali disponibili confermano che:

- il SISS espone tra i principali servizi `Anagrafe Regionale`, `Fascicolo Sanitario Elettronico` e `Ricetta Elettronica`, e pubblica anche una sezione dedicata all'`Integrazione Application to Application (A2A)`:
  [Servizi per il Territorio](https://www.siss.regione.lombardia.it/wps/portal/site/siss/DettaglioRedazionale/servizi-per-il-territorio/servizi-per-il-territorio),
  [Integrazione Application to Application (A2A)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/integrazione-application-to-application)
- per MMG/PDF Regione Lombardia / ARIA prevedono una `Procedura di Qualificazione Scheda Sanitaria Informatica (SSI)` e specificano che solo i prodotti positivamente qualificati possono essere usati dai MMG/PDF; le Linee Guida SSI includono requisiti funzionali, non funzionali e di interoperabilità SISS:
  [Procedura di Qualificazione Scheda Sanitaria Informatica (SSI)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/procedure-di-verifica-e-qualificazione/procedura-di-qualificazione-scheda-sanitaria-informatica-ssi),
  [Linee Guida Regionali](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/linee-guida-regionali)
- la documentazione pubblica SISS include una classificazione dedicata a `Certificati di Malattia`, quindi il filone esiste a livello documentale, ma non e ancora stato portato dentro MediFlow:
  [FAQ SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.jsp),
  [Email alert documentazione SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/emailAlert.jsp)
- SGDT viene descritto da ARIA come una nuova soluzione applicativa unica e centralizzata a livello regionale per i processi sociosanitari territoriali; oggi non abbiamo ancora una integrazione paziente-scoped o un canale adottabile nel prototipo MediFlow:
  [ARIA - news SGDT](https://www.ariaspa.it/wps/portal/Aria/Home/chi-siamo/comunicazione/notizie-ed-eventi/DettaglioNews/news2022/nws-23-nov-premio-sistema-digitale),
  [PPA ARIA 2024-2026 - SGDT](https://www.trasparenza.ariaspa.it/wps/wcm/connect/687c8b76-c4b6-489d-837a-66d04988892d/ARIA%2BPPA_2024_2026.pdf?CACHEID=ROOTWORKSPACE-687c8b76-c4b6-489d-837a-66d04988892d-oOg.-9L&CONVERT_TO=URL&MOD=AJPERES)

## Matrice del prototipo contestuale attuale

| Capacità | Stato | Note |
| --- | --- | --- |
| `Menu SISS` | `Disponibile ora` | Apertura dal paziente via `portal-handoff`, anche senza CF valido. |
| `Ricetta Elettronica` | `Disponibile ora` | Apre la compilazione prescrittiva e prepara il CF negli appunti. |
| `FSE` | `Disponibile ora` | Apertura contestuale via `portal-handoff` con CF pronto da incollare. |
| `Anagrafe Regionale` | `Disponibile ora` | Apertura contestuale via `portal-handoff` con CF pronto da incollare. |
| Prescrittivo nativo dentro MediFlow | `Non disponibile` | Richiede un filone dedicato `SSI qualificata + A2A/canale certificato`. |
| FSE embedded / feed nel gestionale | `Non disponibile` | Richiede stack certificato, regole privacy e contratti regionali ulteriori. |
| SGDT contestuale dal paziente | `Non disponibile` | Oggi SGDT è trattato come applicativo regionale centralizzato, non come route pronta nel prototipo. |
| Certificati di malattia contestuali | `Non disponibile` | La documentazione esiste, ma MediFlow non ha ancora un adapter/scenario dedicato. |

## Target certificato

Il target di lungo periodo è una catena locale esplicita, con step separati:

1. identificazione paziente e contesto operatore
2. autenticazione/canale certificato secondo le regole regionali
3. invocazione del servizio prescrittivo o documentale
4. tracciamento audit PHI-safe dell'operazione
5. gestione errori, retry e fallback espliciti

La baseline non definisce ancora il dettaglio tecnico del trasporto o dei
certificati; quello richiederà un ADR dedicato prima del runtime.

## Prerequisiti minimi

Prima di qualsiasi integrazione runtime SISS, MediFlow deve avere:

- baseline documentale con ambito e gap espliciti
- audit taxonomy estesa ai nuovi eventi SISS
- strategia sicurezza per canali, certificati e fallimenti
- flusso operatore chiaro e reversibile
- confini netti tra UI, mediator e servizi esterni

## Gap espliciti

Oggi mancano ancora:

- adapter certificato verso SISS
- canale certificato oltre il mediatore locale di `portal-handoff`
- contratto errori e retry policy SISS
- gestione credenziali/certificati dedicata
- audit SISS con correlazione di richiesta
- test sintetici del flusso certificato end-to-end

Il file `lib/siss.ts` e il pulsante nel profilo paziente restano quindi un
collegamento operativo al portale, non una integrazione certificata.

## Sequenza consigliata

La sequenza di lavoro per questo stream è:

1. `WUL-43`: baseline documentale e mappa dei gap
2. `WUL-45`: progettazione dell'adapter/mediator locale con audit, retry e
   mapping errori
3. `WUL-44`: integrazione del flow prescrittivo nel pannello operativo, solo
   dopo che il mediator e le sue regole sono stati fissati
4. `WUL-178`: launcher contestuale paziente per `Menu SISS`, `Ricetta`, `FSE`
   e `Anagrafe`, mantenendo il confine esplicito del `portal-handoff`
5. filone successivo dedicato a `SSI qualificata / A2A / canale certificato`
   se e solo se la documentazione tecnica disponibile e l'onboarding regionale
   lo rendono concretamente perseguibile

Questa sequenza evita di legare l'UI a un comportamento SISS non ancora
certificato.

## Out of scope

Per questa baseline non sono inclusi:

- implementazione runtime SISS
- gestione certificati o PKI
- network discovery o pairing
- cambi al modello dati clinico
- export FSE end-to-end

## Nota operativa

Se questa baseline cambia in modo sostanziale, il primo aggiornamento deve
passare da `docs/README.md` e da un ADR dedicato al comportamento runtime.
