# ADR 0194: Profilo pseudonimizzato per la chat esterna

Data: 2026-11-19

Stato: **Accettato** da Leonardo il 19/11/2026. Riferimenti: WUL-904, WUL-905,
[ADR 0146](0146-patient-profile-query-application-boundary.md),
[ADR 0160](0160-mediflow-in-desktop-chat.md),
[ADR 0192](0192-segnaposto-con-ruolo-e-date-relative.md).

## Punto di partenza

Con il consenso del medico nella UI Web, una chat collegata via MCP `stdio`
legge il profilo del paziente selezionato con `patient-profile.read.v1`. I
quindici campi dell'ADR 0146 uscivano con i valori veri: nome, cognome, codice
fiscale, data di nascita, indirizzo, telefono, caregiver e i testi liberi. Se
dietro la chat c'è un modello cloud, l'identità del paziente arrivava al
fornitore senza passare dal rimescolatore, che copriva solo la corsia ChatGPT.

Lo stesso porto serve anche Mini, che gira in locale senza provider e mostra i
dati al medico.

## Decisione

La chat esterna riceve sempre il profilo pseudonimizzato, per costruzione e
senza impostazioni. Decide il canale, non chi interroga: MCP `stdio` riceve i
segnaposto, Mini e le corsie HTTP ricevono i dati veri.

### Dove avviene la sostituzione

Nel proprietario Web (`lib/patient-profile-service.ts`), prima che il risultato
parta sull'IPC privato verso il Supervisor. I valori veri non entrano né nel
Supervisor né nel processo MCP. Il porto host richiede la modalità
(`identified` o `pseudonymized`) a ogni acquisizione e non ha un valore
predefinito.

### Chi sceglie il canale

Il Supervisor sa se ha avviato MCP o Mini (`--mini`) e lo comunica al figlio
Web nell'ambiente con cui lo avvia: `MEDIFLOW_HEADLESS_AGENT_KIND=mini` solo
per Mini. Il Web non eredita l'ambiente del Supervisor, quindi la variabile non
arriva dalla configurazione della chat. Ogni altro valore, compresa l'assenza,
dà il profilo pseudonimizzato. Nessun corpo decodificato e nessun campo scelto
dal chiamante entra nella scelta.

### Come si sostituisce

Solo sostituzione strutturata e livello deterministico, senza livello
neurale: costerebbe secondi su ogni lettura.

- I campi d'identità escono interi come segnaposto con ruolo dell'ADR 0192:
  `firstName` e `lastName` come `PAZ`, `taxCode` come `CF`, `birthDate` come
  `NAS`, `address` come `IND`, `phone` come `TEL`, `caregiver` come `PER`. Un
  valore conteso fra classi (per esempio un caregiver scritto con il suo
  telefono) esce come `ALT`.
- I testi liberi (`diagnoses`, `exemptions`, `notes`, `statusReason`,
  `archiveReason`, `archiveNote`) passano da `createRedactionSession().prepare`
  con gli identificativi dell'anagrafica e senza entità neurali. Lo stesso
  valore riceve lo stesso segnaposto del campo strutturato. Le date cliniche
  diventano scostamenti in giorni come nell'ADR 0192.
- Un testo più lungo di 12.000 caratteri, il limite di una preparazione, si
  prepara a finestre nella stessa sessione. Ogni finestra porta 1024 caratteri
  di contesto a sinistra e a destra e se ne tiene solo il tratto centrale. Il
  taglio cade a fine riga o fra due parole, ma solo in un punto che nessuno
  span della finestra attraversa, altrimenti si sposta all'inizio dello span.
  Se il punto non esiste la lettura viene rifiutata con `query_unavailable`.
  Il motivo è che anche i valori fuori dall'anagrafica (il telefono di un
  familiare, un indirizzo dopo «indirizzo:», un numero dettato dopo
  «telefono») si riconoscono solo interi e con il testo che li precede, e un
  taglio che evita i soli valori noti non basta.

### Durata della corrispondenza

Ogni handle `pph_` ha la sua sessione del rimescolatore. Lo stesso valore ha lo
stesso segnaposto per tutte le letture dell'handle, anche quando la proiezione
si restringe alle note. Un handle nuovo ha un nonce nuovo. Il Supervisor
chiude il porto alla revoca, al blocco ed al cambio di selezione, e con il
porto si chiudono tutte le sessioni. Un handle scaduto o non più valido chiude
la sua sessione alla prima lettura successiva. Le mappe vivono solo in RAM e
una sessione chiusa non risolve più nulla.

### Ritorno

Oggi nessuna operazione MCP porta testo dell'host verso una proposta o una
scrittura:

| Operazione | Livello | Testo dall'host |
|---|---|---|
| `mediflow.patient.open_loops.follow_up.propose.v1` | `proposal_only` | nessuno, l'input è vuoto |
| `mediflow.patient.checkup.status.transition.v1` (anteprima F10) | `proposal_only` | nessuno: riferimento esadecimale, stato da elenco chiuso, revisione intera |
| `mediflow.terminology.search.v1` | `read_only` | `query`, solo ricerca nel catalogo locale |
| `mediflow.semantic_query_plan.execute.v1` | `read_only` | `explanation` e `query` dei passi, non scritte né mostrate |
| `mediflow.patient.open_loops.read.v1`, `patient-profile.read.v1` | `read_only` | nessuno |

Un segnaposto quindi non arriva mai nel database né nella UI fidata, e non
serve ricomporlo. Una prova in `packages/mcp/src/contracts.test.ts` fallisce se
un'operazione oltre la sola lettura accetta testo libero: chi la aggiunge deve
prima portare la ricomposizione dei segnaposto vivi ed il rifiuto tipizzato di
quelli estranei, scaduti o alterati.

### Contratto

I quindici campi e i loro nomi non cambiano, e non c'è nessuna impostazione
nuova. Il tetto di 32 KiB si misura sui byte pseudonimizzati: un profilo che
con i valori veri ci stava può superarlo con i segnaposto, ed allora la lettura
restituisce `output_too_large` senza troncare, come oggi. Lo schema MCP non
vincola la forma dei campi e non cambia. Un testo che contiene già la forma
riservata dei segnaposto fa fallire la lettura con `query_unavailable`.

## Invarianti e prove

| Invariante | Prova nel repository |
|---|---|
| M1. Nessuna identità nei byte serviti dal trasporto MCP `stdio`, per le due proiezioni | `lib/patient-profile-mcp-pseudonymization.test.ts`, M1: porto Web reale, IPC reale e server MCP `stdio` in un processo figlio, sentinella sui byte di stdout |
| M1 per i testi lunghi. Nessun valore che il livello deterministico copre esce, intero o a pezzi, perché cade a cavallo di un taglio | stesso file, M1 sui testi lunghi: tutte le posizioni attorno ai due tagli possibili, per tre valori dell'anagrafica con spazi e tre riconosciuti solo dal livello deterministico, sulle due proiezioni. Sulla versione precedente dava 202 fughe |
| M2. Sostituzione prima dell'IPC | stesso file, M2, sentinella sui frame verso il Supervisor |
| M3. Mini e HTTP invariati | stesso file, M3, `portable-supervisor-child-processes.test.ts`, e con le stesse attese `patient-profile-scoped.test.ts` e `patient-profile-mini-integration.test.ts` |
| M4. Corrispondenza per handle, chiusa al ritiro | stesso file, M4 |
| M5. Nessun testo dell'host verso proposte o scritture | `packages/mcp/src/contracts.test.ts` |
| M6. Tetto e `output_too_large` sui byte pseudonimizzati | stesso file, M6, al byte |
| M7. Tempo aggiunto | stesso file, M7, con mediana e massimo nel resoconto |

## Limiti che restano

- I nomi di terzi che non sono in anagrafica passano nei testi liberi, perché
  qui non c'è il livello neurale. Passa anche una parte del nome del caregiver
  quando il testo non lo riporta come nel campo.
- L'età non esce: aggiungerla cambierebbe il contratto dei quindici campi. È il
  passo successivo, se la chat ne ha bisogno.
- È pseudonimizzazione, non anonimizzazione: il contesto clinico può bastare a
  riconoscere una persona ed il GDPR resta applicabile, come dice l'ADR 0160.
- In un testo lungo la data di riferimento per gli scostamenti è la più
  recente della prima finestra, non dell'intero testo. Può cambiare se una data
  esce come scostamento o come `DAT` opaco, mai se esce in chiaro.
- Uno span più lungo di una finestra (per esempio un indirizzo dopo
  «indirizzo:» senza punto né a capo per migliaia di caratteri) fa rifiutare
  la lettura.
- Un valore del caregiver molto corto o generico (una parola comune) viene
  sostituito ovunque compaia nei testi liberi.

## Fuori da questa decisione

Il rimescolatore stesso, il canale degli agenti e la cassetta, la corsia
ChatGPT, il worker GLiNER e lo schema del database. Il testo del consenso non
cambia: non dice che escono dati identificativi e vale anche per Mini.
