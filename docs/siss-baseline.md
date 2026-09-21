# SISS Baseline Canonica

> Stato documento: `CANONICAL`

Nel lavoro con i servizi regionali, aprire il portale dal paziente selezionato
può ridurre i passaggi manuali, ma non equivale a integrare un servizio
certificato. Questa baseline, riferita al filone `WUL-43`, mantiene distinti i
due piani: ciò che MediFlow offre attraverso collegamenti web contestuali e
il percorso verso un’integrazione qualificata, articolato nei lavori
`WUL-45`, `WUL-44`, `WUL-178` e `WUL-180`.

Riferimenti canonici:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
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

MediFlow non integra ancora una catena SISS certificata. Offre un servizio
locale che prepara il passaggio dell’operatore al portale, senza sostituirne
l’autenticazione o le operazioni. In concreto:

- espone un mediatore backend locale per il passaggio contestuale verso i portali `operatorisiss`
- apre dal paziente i moduli `Menu SISS`, `Ricetta Elettronica`, `Protesica-RL`, `FSE` e `Anagrafe`
- indirizza i comandi di apertura contestuale ai percorsi realmente osservati nella sessione operatore locale (`menusiss/#/menusiss`, `prescrittivoRegionale/` per il Prescrittivo Regionale PRREG, `prescrizione/` come root legacy in transizione, `assistantrl/home/`, `opefseie/#/app-fascicolo`, `gaia/`)
- mostra nel pannello contestuale un controllo preliminare locale di prontezza FSE per terapie e osservazioni
- mostra nel pannello contestuale un indicatore locale di stato sessione SISS / firma remota osservato dalla cronologia Atlas della macchina, senza dichiarare uno stato certificato del backend regionale
- mantiene un diario locale delle prescrizioni protesiche con campi decodificati per codice ISO, descrizione, misure, motivazione clinico-funzionale e collaudo
- copia il Codice Fiscale negli appunti quando il flusso lo richiede
- registra un audit locale privo di PHI per l’apertura del `Modulo Prescrittivo Regionale`
- delega comunque all'operatore il completamento manuale nel portale esterno

Il backend locale è quindi limitato al `portal-handoff`, cioè al passaggio
verso il portale ufficiale. Non esistono né un canale certificato locale di
autenticazione o prescrizione né certificati o adapter SISS gestiti dall’app.
La base tecnica locale comprende una classificazione degli errori,
identificativi di correlazione e nuovi tentativi per gli errori transitori,
ma non ancora un audit certificato dell’intero percorso verso i servizi
regionali.

## Allineamento con le fonti ufficiali

La ricognizione delle fonti ufficiali al 15 aprile 2026 registra i seguenti
elementi:

- il SISS espone tra i principali servizi `Anagrafe Regionale`, `Fascicolo Sanitario Elettronico` e `Ricetta Elettronica`, e pubblica anche una sezione dedicata all'`Integrazione Application to Application (A2A)`:
  [Servizi per il Territorio](https://www.siss.regione.lombardia.it/wps/portal/site/siss/DettaglioRedazionale/servizi-per-il-territorio/servizi-per-il-territorio),
  [Integrazione Application to Application (A2A)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/integrazione-application-to-application)
- per MMG/PDF Regione Lombardia / ARIA prevedono una `Procedura di Qualificazione Scheda Sanitaria Informatica (SSI)` e specificano che solo i prodotti positivamente qualificati possono essere usati dai MMG/PDF; le Linee Guida SSI includono requisiti funzionali, non funzionali e di interoperabilità SISS:
  [Procedura di Qualificazione Scheda Sanitaria Informatica (SSI)](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/procedure-di-verifica-e-qualificazione/procedura-di-qualificazione-scheda-sanitaria-informatica-ssi),
  [Linee Guida Regionali](https://www.siss.regione.lombardia.it/wps/portal/site/siss/servizi-per-il-territorio/linee-guida-regionali)
- la documentazione pubblica SISS include una classificazione dedicata a `Certificati di Malattia`, quindi il filone esiste a livello documentale, ma non è ancora presente in MediFlow:
  [FAQ SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.jsp),
  [Email alert documentazione SISS](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/emailAlert.jsp)
- SGDT viene descritto da ARIA come una nuova soluzione applicativa unica e centralizzata a livello regionale per i processi sociosanitari territoriali; la ricognizione non individua ancora un’integrazione riferita al singolo paziente o un canale adottabile nel prototipo MediFlow:
  [ARIA - news SGDT](https://www.ariaspa.it/wps/portal/Aria/Home/chi-siamo/comunicazione/notizie-ed-eventi/DettaglioNews/news2022/nws-23-nov-premio-sistema-digitale),
  [PPA ARIA 2024-2026 - SGDT](https://www.trasparenza.ariaspa.it/wps/wcm/connect/687c8b76-c4b6-489d-837a-66d04988892d/ARIA%2BPPA_2024_2026.pdf?CACHEID=ROOTWORKSPACE-687c8b76-c4b6-489d-837a-66d04988892d-oOg.-9L&CONVERT_TO=URL&MOD=AJPERES)

## Matrice del prototipo contestuale attuale

| Capacità | Stato | Note |
| --- | --- | --- |
| `Menu SISS` | `Disponibile ora` | Apertura dal paziente via `portal-handoff` sul percorso osservato `menusiss/#/menusiss`, anche senza CF valido. |
| `Ricetta Elettronica` | `Disponibile ora` | Richiama la webapp ufficiale del `Modulo Prescrittivo Regionale` in modalità `portal-handoff`, prepara il CF negli appunti e registra un audit locale dell’apertura, privo di PHI. |
| `Protesica-RL` | `Disponibile ora` | Apertura contestuale via `portal-handoff` verso `Assistente RL / Protesica-RL`, con CF pronto da incollare e diario locale delle prescrizioni protesiche. |
| `FSE` | `Disponibile ora` | Apertura contestuale via `portal-handoff` verso `OpeFseIE` con CF pronto da incollare. |
| `Anagrafe Regionale` | `Disponibile ora` | Apertura contestuale via `portal-handoff` verso `Gaia` con CF pronto da incollare; il progetto di accesso in sola lettura è in [docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md). |
| Prontezza FSE locale | `Disponibile ora` | Il pannello paziente mostra il pre-check locale su terapie e osservazioni prima di un eventuale export/filone FSE. |
| Stato sessione SISS / firma remota | `Disponibile ora` | Il pannello paziente legge in locale la cronologia Atlas della macchina e mostra segnali osservati di `LoginRemoteSign`, selezione ruolo e ultimo modulo SISS raggiunto, inclusa `Protesica-RL` quando osservata. |
| Prescrittivo nativo dentro MediFlow | `Non disponibile` | Richiede un filone dedicato `SSI qualificata + A2A/canale certificato`. |
| Protesica nativa/certificata dentro MediFlow | `Non disponibile` | Il diario locale non sostituisce l'applicativo regionale e non invia prescrizioni verso SISS. |
| FSE embedded / feed nel gestionale | `Non disponibile` | Richiede stack certificato, consenso, ruolo operatore, audit e scenario approvato; la mappa dedicata è in [docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md). |
| SGDT contestuale dal paziente | `Non disponibile` | Oggi SGDT è trattato come applicativo regionale centralizzato; i soli casi utili emersi sono SGDT/PAI con `SSI-MMG` e COT/transizioni, documentati in [docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md). |
| Certificati di malattia contestuali | `Non disponibile` | Il percorso più prudente è una futura apertura assistita e controllata della Web Application; UI custom/backend restano bloccati come documentato in [docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md). |

## Documenti protesici prodotti dal portale

I documenti di `Protesica-RL` possono alimentare solo il diario locale, con
revisione del contenuto. Per evitare di attribuire a una fonte informazioni
che appartengono a un’altra, i documenti hanno ruoli distinti:

- `PRESCRIZIONE DI PROTESICA`: fonte primaria per analisi funzionale, diagnosi,
  razionale clinico-funzionale, presidi ISO e tempi d'impiego;
- `MODELLO 03`: fonte primaria per numero pratica/domanda, data presentazione,
  requisito di collaudo e dati di fornitura quando compilati;
- `SchedaTecnica`: fonte di conferma per codice ISO, quantità, descrizione del
  presidio, data prescrizione, prescrittore e struttura.

MediFlow conserva una riga locale per ogni presidio ISO documentato e usa il
numero di pratica o prescrizione come riferimento regionale. La lettura dello
stato richiede particolare attenzione: `Collaudo: NO`, o una formula
equivalente, non significa `collaudato`. Per assegnare `tested` serve una data
oppure un esito esplicito di collaudo.

Se i documenti divergono su identità del paziente, numero di pratica o data,
la trasformazione resta in revisione e non deve essere applicata
automaticamente.

## Target certificato

L’obiettivo di lungo periodo è una catena locale nella quale ogni passaggio
sia esplicito e verificabile:

1. identificazione paziente e contesto operatore
2. autenticazione/canale certificato secondo le regole regionali
3. invocazione del servizio prescrittivo o documentale
4. tracciamento audit PHI-safe dell'operazione
5. gestione errori, retry e fallback espliciti

Trasporto e certificati non sono ancora definiti nel dettaglio da questa
baseline. Prima di implementarli nel runtime serve un ADR dedicato: la
sequenza descritta non autorizza a sceglierli implicitamente.

## Prerequisiti minimi

Perché il passaggio al runtime abbia un perimetro verificabile, prima di
qualsiasi integrazione SISS MediFlow deve avere:

- baseline documentale con ambito e lacune espliciti
- catalogo di audit esteso ai nuovi eventi SISS
- strategia sicurezza per canali, certificati e fallimenti
- flusso operatore chiaro e reversibile
- confini netti tra UI, mediator e servizi esterni

## Gap espliciti

Oggi mancano ancora:

- adapter certificato verso SISS
- canale certificato oltre il mediatore locale di `portal-handoff`
- contratto degli errori e regole dei nuovi tentativi SISS
- gestione credenziali/certificati dedicata
- audit SISS esteso agli altri flussi contestuali e ai futuri scenari certificati
- test sintetici del flusso certificato end-to-end

La presenza di `lib/siss.ts` e del pulsante nel profilo paziente va letta entro
questi limiti: sono un collegamento operativo al portale, non un’integrazione
certificata.

## Sequenza consigliata

La sequenza del filone mantiene separate preparazione documentale, mediazione
locale e possibili sviluppi certificati:

1. `WUL-43`: baseline documentale e mappa dei gap
2. `WUL-45`: progettazione dell'adapter/mediator locale con audit, retry e
   mapping errori
3. `WUL-44`: integrazione del flusso prescrittivo nel pannello operativo, solo
   dopo che il mediator e le sue regole sono stati fissati
4. `WUL-178`: launcher contestuale paziente per `Menu SISS`, `Ricetta`, `FSE`
   e `Anagrafe`, mantenendo il confine esplicito del `portal-handoff`
5. `WUL-180`: mappa di fattibilità ufficiale per separare `portal-handoff`,
   `webapp ufficiale`, `A2A`, `SSI qualificata` e funzioni realmente
   perseguibili
6. note dedicate a ciascuno scenario prima del runtime: Modulo Prescrittivo
   Regionale, FSE consultazione/consenso, NAR/Anagrafe in sola lettura, SGDT/PAI
   e Certificati di malattia
7. filone runtime successivo dedicato a `SSI qualificata / A2A / canale
   certificato`, se e solo se la documentazione tecnica disponibile e
   l'onboarding regionale lo rendono concretamente perseguibile

In questo ordine, la UI può accompagnare l’operatore senza dipendere da un
comportamento SISS che non sia ancora certificato.

<a id="out-of-scope"></a>

## Fuori perimetro

Per questa baseline non sono inclusi:

- implementazione runtime SISS
- gestione certificati o PKI
- network discovery o pairing
- cambi al modello dati clinico
- export FSE end-to-end

## Nota operativa

Una modifica sostanziale della baseline deve partire dall’aggiornamento di
`docs/README.md`, di
[docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md) e di un ADR
dedicato al comportamento runtime. Il nuovo confine va definito prima che
l’implementazione lo attraversi.
