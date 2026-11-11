# ADR 0012: Smart import reviewable da note, diario e documenti nel profilo paziente

Date: 2026-03-17  
Status: Accepted

---

## Problema

MediFlow ha gia una pipeline OCR-first che produce insight e proposte
diagnostiche da revisionare. La sintesi documentale non scrive diagnosi nella
scheda, come stabilito da ADR 0084. Nel profilo paziente manca ancora un
percorso unico e revisionabile per trasformare in dati strutturati:

- patologie citate in testo libero nelle note paziente o nel diario clinico
- terapie menzionate per farmaco, principio attivo o posologia
- informazioni gia presenti nei document insights

Senza questo passaggio, il modello puo solo sintetizzare o riempire casi molto
ristretti, ma non aiuta l'operatore a popolare in modo sicuro diagnosi e terapie.

## Contesto

- `ARCHITECTURE.md` e `SECURITY.md` impongono local-first, nessun egress cloud e
  logging PHI-safe.
- ADR 0006 richiede un uso coerente delle terminologie e dei cataloghi locali.
- ADR 0010 governa `/api/v1` con processo spec-first, ma questa slice non ha
  bisogno di estendere subito il contratto stabile shared.
- ADR 0084 sostituisce l'autofill diagnostico da documento con proposte
  review-only. Nessun codice, anche se esplicito, viene scritto dalla sintesi.

## Opzioni

1. Estendere l'autofill automatico silenzioso a note, diario e documenti.
2. Introdurre uno smart import reviewable, web-first, con suggerimenti
   strutturati e applicazione manuale selettiva.
3. Bloccare la feature finche non esiste un endpoint `/api/v1` dedicato condiviso
   con il client macOS.

## Trade-off

- Opzione 1:
  - Pro: massima automazione percepita.
  - Contro: rischio clinico troppo alto, dedupe opaco, maggiore probabilita di
    introdurre patologie/terapie non confermate.
- Opzione 2:
  - Pro: preserva controllo umano, riusa modelli e cataloghi locali esistenti,
    diff piccolo, nessuna nuova tabella, nessun impatto immediato su OpenAPI.
  - Contro: la feature resta inizialmente web-only e richiede un click esplicito
    dell'operatore.
- Opzione 3:
  - Pro: parita futura piu pulita fin dal primo giorno.
  - Contro: rallenta inutilmente la thin slice e forza lavoro contrattuale `/api/v1`
    prima di validare il flusso clinico.

## Decisione

Adottiamo l'opzione 2.

Regole operative:

- nel profilo paziente compare una CTA persistente solo se esistono fonti utili
  (note, diario clinico, document insights o summary di allegati)
- il modello clinico locale piu capace configurato produce suggerimenti
  strutturati per diagnosi e terapie con evidenze testuali locali
- le diagnosi da free text non vengono applicate in modo silenzioso:
  devono prima ottenere un match ICD-11 locale e poi essere confermate
  dall'operatore
- le terapie possono essere proposte come match catalogato (AIFA/ATC) oppure
  come inserimento manuale reviewable quando il catalogo non risolve
  in modo affidabile
- ADR 0084 resta vincolante: la sintesi documentale produce solo proposte da
  revisionare; l'eventuale scrittura avviene in Smart Import dopo selezione e
  conferma esplicite
- nessun nuovo endpoint `/api/v1` in questa first thin slice; eventuale
  estensione shared web/macOS richiedera update spec/ADR successivo

Decisione approvata dal Lead Architect il 2026-03-17.

## Conseguenze

- Positivo: il profilo paziente guadagna un percorso operativo unico per
  convertire testo clinico locale in dati strutturati.
- Positivo: l'uso di ICD-11 e catalogo farmaci resta governato da match locali
  reviewable, senza introdurre cloud o nuove dipendenze.
- Positivo: il rischio clinico resta piu basso rispetto a un autofill esteso.
- Negativo: nella prima slice la capability resta web-first e non ancora esposta
  come contratto stabile per macOS.

## First Thin Slice

1. Aggiungere una card persistente nel profilo paziente per generare suggerimenti
   da note, diario e documenti gia analizzati.
2. Estrarre suggerimenti strutturati reviewable per diagnosi e terapie usando il
   modello clinico locale e matching locale ICD/AIFA.
3. Applicare in modo selettivo i suggerimenti a `patients.diagnoses` e `therapies`
   con dedupe esplicito.
4. Aggiornare walkthrough, piano attivo e documentazione canonica per riflettere
   il nuovo flusso reviewable.

## Fonte delle sotto-prestazioni e tetto della risposta (misura dell'11 novembre 2026)

### Problema

Con `qwen3.5:35b-a3b` sull'archivio sintetico l'import assistito ha dato una
proposta in 2 richieste su 20 per Persona000002. Il rigioco offline dei
controlli dell'host sulle risposte grezze ha trovato la causa: 32 dei 34
tentativi non troncati sono stati scartati perché le sotto-prestazioni
(`servicePrescriptions[].items[]`) non avevano `sourceId`. Il contratto con il
modello e il controllo dell'host dicevano due cose diverse:

| Campo | Prompt | Schema JSON | Controllo dell'host |
| --- | --- | --- | --- |
| `items[].sourceId` | assente dall'esempio | facoltativo | obbligatorio |
| `diagnoses[].sourceId` | chiesto | facoltativo | obbligatorio |
| `therapies[].sourceId` | chiesto | facoltativo | obbligatorio |
| `servicePrescriptions[].sourceId` | chiesto | facoltativo | obbligatorio |

Il modello segue prompt e schema: una richiesta come «Ultimo fundus oculi
oltre 2 anni fa: da prenotare» diventa un contenitore con un item senza fonte,
e la proposta intera cade.

Nella stessa misura il tetto fisso di 1100 token ha tagliato 8 risposte su 63.
Non erano risposte degeneri: tutte si interrompono a metà di una prestazione.
Le risposte complete arrivavano fino a 1093 token, cioè 0,11 token per
carattere di prompt (prompt di 9645 e 10549 caratteri, 13 fonti su
Persona000001).

### Decisione

Il contratto si allinea in un solo verso, quello del controllo dell'host. Ogni
elemento proposto, sotto-prestazione compresa, dice da quale fonte viene: è
ciò che permette al medico di verificare la proposta contro il testo. Un item
che erediti la fonte del contenitore potrebbe venire da un'altra fonte senza
che nessuno lo veda, perché una richiesta con più atti può riunire testi di
fonti diverse. Il controllo quindi resta com'è, e:

- il prompt mostra `sourceId` anche nell'esempio degli items;
- lo schema JSON rende `sourceId` obbligatorio su diagnosi, terapie,
  prestazioni e sotto-prestazioni. Con Ollama lo schema vincola la
  generazione, quindi il modello non può più omettere il campo; con il
  profilo ordinario remoto il campo smette di poter valere `null`.

Gli altri campi annidati non hanno uno scollamento che scarti la proposta. Le
lunghezze dello schema (240 caratteri, 80 per i riferimenti) superano quelle
del filo (220, 80, 32 per `explicitCode`, 16 per `priority`) ma il parser
accorcia senza scartare; i conteggi dello schema (32) superano quelli del filo
(5 diagnosi, 10 terapie, 10 prestazioni, 20 items) ma il parser taglia. Il
parser eredita ancora la fonte del contenitore per un item che non la porta,
ma nel percorso dell'host il controllo sulla risposta grezza viene prima e
rifiuta l'item.

Il tetto della risposta segue lo schema della sintesi documenti (ADR 0102):
dipende dal prompt, un quarto di token per carattere, mai meno di 2048 e mai
più di 8192. Un quarto è più del doppio del rapporto massimo misurato col
tetto fisso (0,11), e lascia spazio alla riga in più che ogni item ora porta. Il minimo è quasi il
doppio della risposta completa più lunga (1093 token), per un contesto con
poche fonti e molte prestazioni. Il massimo è quello della sintesi: alla
velocità misurata (120 token al secondo) sono circa 70 secondi per tentativo,
due tentativi restano dentro il timeout di 300 secondi della chiamata. Per
Persona000001 il tetto passa da 1100 a 2664 token, per Persona000002 a 2438.

Misura dopo la correzione, con lo stesso metodo (20 richieste per paziente):
proposta in 20 su 20 per Persona000001 e in 16 su 20 per Persona000002,
nessuna risposta troncata su 50 tentativi, nessuna scrittura. Con la fonte su
ogni item le risposte sono più lunghe: 10 superano i 1100 token, la più lunga
ne usa 1695, e il rapporto massimo sale a 0,17 token per carattere. Il tetto
resta sopra la risposta più lunga di almeno il 50%. I 4 scarti rimasti hanno
un'altra causa: il modello cita come fonte di una diagnosi già codificata il
nome della sezione (`currentDiagnoses`) o un id inventato, che il controllo
dell'host rifiuta.

Una risposta che anche all'ultimo tentativo finisce troncata non diventa più
`proposal_invalid`: l'anteprima risponde `response_truncated`, e Web e GPUI lo
dicono con un testo proprio. Decide l'ultimo tentativo, come per
`proposal_unfaithful` del Quadro paziente (ADR 0189).
