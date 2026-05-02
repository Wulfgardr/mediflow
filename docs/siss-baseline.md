<!-- Codex: created 2026-03-18 -->
# SISS Baseline Canonica

> Stato documento: `CANONICAL`

Questo documento fissa la baseline SISS di MediFlow per il filone `WUL-43`.
Serve a separare chiaramente lo stato attuale, ancora basato su shortcut web,
dal target certificato che verrà affrontato in modo controllato con i follow-up
`WUL-45`, `WUL-44`, `WUL-178` e `WUL-180`.

Riferimenti canonici:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [PLANS.md](../PLANS.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)
- [docs/walkthrough.md](./walkthrough.md)
- [docs/COMPLIANCE.md](./COMPLIANCE.md)
- [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md)
- [docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md)
- [docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md)
- [docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md)
- [docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md)

## Stato attuale

MediFlow non integra ancora una catena SISS certificata.
Lo stato presente è un comportamento di servizio locale che:

- espone un mediatore backend locale per l'handoff contestuale verso i portali `operatorisiss`
- apre dal paziente i moduli `Menu SISS`, `Ricetta Elettronica`, `Protesica-RL`, `FSE` e `Anagrafe`
- riallinea i launcher contestuali ai percorsi realmente osservati nella sessione operatore locale (`menusiss/#/menusiss`, `prescrizione/`, `assistantrl/home/`, `opefseie/#/app-fascicolo`, `gaia/`)
- mostra nel pannello contestuale un pre-check locale di prontezza FSE per terapie e osservazioni
- mostra nel pannello contestuale un indicatore locale di stato sessione SISS / firma remota osservato dalla cronologia Atlas della macchina, senza dichiarare uno stato certificato del backend regionale
- mantiene un diario locale delle prescrizioni protesiche con campi decodificati per codice ISO, descrizione, misure, motivazione clinico-funzionale e collaudo
- copia il Codice Fiscale negli appunti quando il flusso lo richiede
- scrive un audit locale PHI-safe del launch verso il `Modulo Prescrittivo Regionale`
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
| `Menu SISS` | `Disponibile ora` | Apertura dal paziente via `portal-handoff` sul percorso osservato `menusiss/#/menusiss`, anche senza CF valido. |
| `Ricetta Elettronica` | `Disponibile ora` | Richiama la webapp ufficiale del `Modulo Prescrittivo Regionale` in modalita `portal-handoff`, prepara il CF negli appunti e scrive audit locale PHI-safe del launch. |
| `Protesica-RL` | `Disponibile ora` | Apertura contestuale via `portal-handoff` verso `Assistente RL / Protesica-RL`, con CF pronto da incollare e diario locale delle prescrizioni protesiche. |
| `FSE` | `Disponibile ora` | Apertura contestuale via `portal-handoff` verso `OpeFseIE` con CF pronto da incollare. |
| `Anagrafe Regionale` | `Disponibile ora` | Apertura contestuale via `portal-handoff` verso `Gaia` con CF pronto da incollare; il blueprint read-only e in [docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md). |
| Prontezza FSE locale | `Disponibile ora` | Il pannello paziente mostra il pre-check locale su terapie e osservazioni prima di un eventuale export/filone FSE. |
| Stato sessione SISS / firma remota | `Disponibile ora` | Il pannello paziente legge in locale la cronologia Atlas della macchina e mostra segnali osservati di `LoginRemoteSign`, selezione ruolo e ultimo modulo SISS raggiunto, inclusa `Protesica-RL` quando osservata. |
| Prescrittivo nativo dentro MediFlow | `Non disponibile` | Richiede un filone dedicato `SSI qualificata + A2A/canale certificato`. |
| Protesica nativa/certificata dentro MediFlow | `Non disponibile` | Il diario locale non sostituisce l'applicativo regionale e non invia prescrizioni verso SISS. |
| FSE embedded / feed nel gestionale | `Non disponibile` | Richiede stack certificato, consenso, ruolo operatore, audit e scenario approvato; la mappa dedicata e in [docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md). |
| SGDT contestuale dal paziente | `Non disponibile` | Oggi SGDT è trattato come applicativo regionale centralizzato; i soli casi utili emersi sono SGDT/PAI con `SSI-MMG` e COT/transizioni, documentati in [docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md). |
| Certificati di malattia contestuali | `Non disponibile` | Il path piu prudente e una futura Web Application handoff guard; UI custom/backend restano bloccati come documentato in [docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md). |

## Documenti protesici prodotti dal portale

Il pacchetto documentale `Protesica-RL` puo alimentare solo il diario locale
reviewable. Le fonti operative sono trattate cosi:

- `PRESCRIZIONE DI PROTESICA`: fonte primaria per analisi funzionale, diagnosi,
  razionale clinico-funzionale, presidi ISO e tempi d'impiego;
- `MODELLO 03`: fonte primaria per numero pratica/domanda, data presentazione,
  requisito di collaudo e dati di fornitura quando compilati;
- `SchedaTecnica`: fonte di conferma per codice ISO, quantita, descrizione del
  presidio, data prescrizione, prescrittore e struttura.

MediFlow conserva una riga locale per ciascun presidio ISO documentato e usa il
numero pratica/prescrizione come riferimento regionale. `Collaudo: NO` o
formulazioni equivalenti non significano `collaudato`: lo stato `tested` richiede
una data o un esito di collaudo esplicito. In caso di divergenze tra documenti su
identita paziente, numero pratica o data, la trasformazione resta in revisione e
non deve essere applicata automaticamente.

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
- audit SISS esteso agli altri flussi contestuali e ai futuri scenari certificati
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
5. `WUL-180`: mappa di fattibilita ufficiale per separare `portal-handoff`,
   `webapp ufficiale`, `A2A`, `SSI qualificata` e capability realmente
   perseguibili
6. note scenario-specific dedicate prima del runtime: Modulo Prescrittivo
   Regionale, FSE consultazione/consenso, NAR/Anagrafe read-only, SGDT/PAI e
   Certificati di malattia
7. filone runtime successivo dedicato a `SSI qualificata / A2A / canale
   certificato`, se e solo se la documentazione tecnica disponibile e
   l'onboarding regionale lo rendono concretamente perseguibile

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
passare da `docs/README.md`, da
[docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md) e da un ADR
dedicato al comportamento runtime.
