# Broker sintetico della singola scheda

Unità 2b di [ADR 0160](./adr/0160-mediflow-in-desktop-chat.md), parte di
WUL-788. Il broker è una libreria locale senza trasporto: non è ancora un
tool MCP, una vista, un flusso di consenso autenticato o un accesso clinico.

`lib/chat-card/synthetic-card-broker.ts` compone il nucleo comune
`ai-preparation/preparation-core.ts`, il runner GLiNER esistente e
`evaluateRedactionRuntimeEvidence`. Non importa database, servizi clinici,
impostazioni ChatGPT o adapter ordinari. I dati provengono esclusivamente dal
corpus sintetico importato staticamente; nessun argomento seleziona un file,
un archivio, una query o contenuto paziente. I percorsi del runner sono
configurazione dell'installazione locale fidata, non argomenti del lettore.

Il profilo v1 include al massimo una voce di storia, due terapie e due misure.
Ogni foglia è classificata in `CARD_FIELD_CLASSIFICATION`; campi non previsti
sono rifiutati a ogni livello. Si omettono nascita ed età; la cronologia usa
intervalli relativi. Selezione e riduzione precedono la redazione. Paziente e
fonti ricevono riferimenti casuali: le corrispondenze con documento, revisione
e filename rimangono accessibili solo all'owner locale del tentativo corrente.
Il paziente riceve un nuovo pseudonimo a ogni selezione locale.

## Autorità locale e consegna dei byte

La composizione restituisce due oggetti separati:

- `owner`: seleziona soltanto una fixture, prepara una selezione bounded,
  mostra i byte da revisionare, approva il loro SHA-256, risolve le fonti
  localmente e revoca/chiude la sessione;
- `reader`: `takeApprovedBytes(prepared, consent)` consegna una sola volta la
  stringa JSON esatta approvata. Non riceve contenuto, callback, destinazioni,
  flag di consenso o identificativi paziente.

Preparazione e consenso sono handle privati per istanza. Il consenso lega
sessione, paziente, generazione della selezione, tentativo e payload; dura due
minuti, entro una sessione di dieci minuti. Una nuova preparazione ritira il
tentativo precedente; cambio paziente, anche tornando indietro, revoca,
chiusura, scadenza e arretramento dell'orologio negano l'uscita. Il cambio
paziente invalida anche una preparazione neurale ancora in attesa. La chiusura
ritira i mapping del nucleo e conserva un eventuale errore di cleanup. Il
timer di sessione ritira anche un tentativo lasciato inattivo.

`review()` è destinato alla futura conferma **locale fidata**. Il solo possesso
del modulo o dei due oggetti non autentica un medico. L'unità 2c dovrà trattenere
`owner` nel processo MediFlow e passare al trasporto solo `reader` e handle.
Il trasporto dovrà usare la stringa restituita senza aggiungere dati in
metadati, messaggi o altri canali. Qui il confine provato termina alla stringa
serializzata: frame MCP e client desktop restano all'unità successiva.

## Controllo finale ed evidenze

Preparazione, revisione, consenso e consegna verificano schema chiuso,
serializzazione canonica, hash, dimensione, osservazione del runner ed evidenza
ancora valida. I report sono snapshot JSON forniti dall'installazione fidata:
il corpus ammesso è quello incorporato, con digest esatto. Non esiste report
positivo predefinito né un flag per disattivare la valutazione. Un report di
un altro corpus o con un falso negativo viene negato dal valutatore esistente.

Dopo la validazione, ogni uscita ricontrolla sessione e tentativo correnti;
preparazione, revisione, approvazione e consegna verificano anche la scadenza
delle evidenze. Immediatamente prima di consegnare i byte, un unico istante
serve a verificare sessione, evidenze e consenso, insieme a revoca, paziente,
generazione, tentativo e handle ancora presenti. Controllo, consumo del consenso
e ritorno della stringa sono sincroni, senza `await` intermedi.

Il controllo finale del testo libero accetta soltanto la forma sintetica
fissata dal codice, con token autenticati dalla sessione di redazione. Ogni
residuo o forma diversa blocca; non viene ripulito in uscita. I dati clinici
devono coincidere esattamente con la proiezione selezionata: anche una
redazione eccessiva che cambia farmaci, dosi, condizioni o misure blocca.
Questo controllo non è un rilevatore universale di identificativi e non
ammette testo clinico arbitrario. Nessun valore annotato del corpus viene
usato dal broker per produrre span o sostituire il runner.

`scripts/fixtures/chat-card-corpus.json` contiene otto schede interamente
inventate e annotazioni critiche: terzi, Unicode, OCR, iniziali, luogo,
nascita completa e parziale, filename, CF strutturali anche con checksum
errato e un omonimo di condizione clinica. È utilizzabile anche dal benchmark
di redazione esistente tramite `--corpus`, senza introdurre un secondo runner.

La suite `lib/chat-card/synthetic-card-broker.test.ts` confronta valori clinici
indipendenti prima e dopo la trasformazione; ogni token vietato reiniettato
nei byte serializzati deve negare l'uscita. Copre inoltre report scaduto,
runner discordante, campi ignoti, cambio paziente, replay, revoca e token di
altre sessioni. Gli span neurali, l'identità osservata e i report dei test
sono simulati: questi esiti non attestano recall GLiNER reale, qualifica del
modello installato, anonimizzazione, Touch ID o ammissione di dati reali.

Per eseguirla con Node 24 e un archivio temporaneo sintetico:

```sh
MEDIFLOW_DATA_DIR=$(mktemp -d) node scripts/run-strip-types.mjs --test lib/chat-card/synthetic-card-broker.test.ts
```

L'intera suite `npm run test:unit` include automaticamente il nuovo test.
