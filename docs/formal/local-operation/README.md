# Recupero dell'operazione locale: verifica finita

La proprietà da proteggere è: **dopo un possibile effetto esterno si riconcilia la stessa operazione, senza prepararla o inviarla di nuovo**. La violazione potrebbe duplicare un atto o dichiarare un esito non provato. Il [nucleo CU-1a](../../local-operation-core.md) usa un adapter simulato; questo modello non qualifica un portale reale.

## Codice e modello

`coverage.json` identifica base Git e hash dei file coperti. Il comando controlla gli hash prima di TLC: una modifica richiede riesame della mappa, non l'aggiornamento automatico del digest. Gli hash identificano il codice e non provano equivalenza con il modello.

| Modello | Codice | Regione atomica e attese |
| --- | --- | --- |
| `Init`, `Prepare` | `service.ts`: `create`, `prepare`, `observation` | Contesto e guard controllati prima/dopo `observe` e `prepare`; questi `await` consentono invalidazioni. Il writer del journal applica CAS. |
| `Approve` | `service.ts`: `approve` | La conferma fidata è asincrona; contesto e revisione sono riletti dopo la conferma. L'approvazione è locale e monouso. |
| `Begin` | `service.ts`: `execute`; `sqlite-journal.ts`: `mutate` | `attempt_started`, numero del tentativo ed `effectPossible` sono committati con audit in `IMMEDIATE`, prima dell'`await adapter.act`. Il writer esegue CAS sulla revisione approvata. |
| `ExternalEffect`, `Reply`, `LostReply` | `execute`, `acceptReceipt`, `run` | L'effetto esterno non fa parte della transazione SQLite. Può arrivare dopo la perdita della risposta. Il modello lo ammette anche dopo timeout/disattivazione. Le risposte della vecchia autorità non producono conferma. |
| `Handoff`, `ManualEffect` | `prepare`, `reviewManualContent`, `reconcile` | La consegna al medico conserva l'effetto possibile, arresta l'adapter e non invia l'atto. L'intervento manuale è esterno al servizio. |
| `Reconcile`, `Record` | `reconcile`, `correlate`, `registerOutcome` | Riconciliazione distinta dal reinvio. Ricevuta verificata e correlata prima di `confirmed_pending_recording`; conferma e audit in transazione separata. Un writer fallito non ripete l'atto. |
| `Disable`, `Enable`, `SuspendOrCrash`, `Resume` | `invalidate`, `suspend`, `resume`, `check`; `host.ts`: `currentContext` | L'invalidazione revoca prima i permessi ed arresta l'adapter. Il writer del nucleo conserva sospensione/incertezza; i writer territoriali restano negati. Il riavvio non ricrea prove di approvazione. |

`saved` astrae la bozza riletta; il modello non contiene valori clinici. Un errore di compilazione, un campo ignoto, dati cambiati o un rifiuto dell'adapter sono astratti come sospensione. `SuspendOrCrash` revoca l'autorità e conserva la possibilità dell'effetto; nel codice un crash può lasciare `attempt_started`, che `resume` tratta come incerto. La registrazione fallita è rappresentata dall'assenza di `Record`: non viene assunta riuscita.

Il lock in RAM esclude due passi sulla superficie dello stesso servizio. La CAS e la revisione dell'approvazione proteggono anche un'altra istanza sullo stesso journal; la relativa prova runtime è distinta dal modello, che ha un solo esecutore. Il punto di composizione deve possedere in esclusiva la superficie dell'adapter.

## Proprietà e limiti

- `NoRepeatedAct`: al massimo un comando automatico di atto per l'operazione modellata.
- `NoUnreconciledPreparation`: nessuna preparazione dopo `effectPossible`.
- `ConfirmedHasReceipt`: una conferma registrata richiede ricevuta ed effetto del destinatario.
- `NoWitness` e `NoManualWitness` sono invarianti deliberatamente negate: TLC deve produrre una traccia di conferma automatica e una di conferma dopo atto manuale. Il relativo exit 12 è atteso.

Bound: un'operazione, un esecutore, un medico/gestore, due cambi di assetto territoriale, un effetto esterno aggregato e un tentativo automatico ammesso dal contratto. I cicli di sospensione e ripresa restano nello stesso spazio finito. Non sono modellati più archivi, parti di una ricevuta, algoritmi crittografici, quantità di byte, timer numerici o un browser reale. Il destinatario applica al massimo una volta il singolo comando: non è una promessa generale di esecuzione esattamente una volta. I test runtime coprono separatamente ricevute parziali, sessioni, generazioni, timeout e canali di uscita.

La verifica riguarda safety nello spazio finito, non liveness: nessuna fairness presume che un medico, portale o writer completino il lavoro. Un'operazione può restare incerta indefinitamente; il nucleo non reinvia per risolvere questa attesa. La risposta dopo disattivazione non viene trattata come annullamento dell'effetto.

## Riproduzione e falsificazione

Richiede Node 24, `npm ci`, Java e il jar locale della release TLA+ **v1.7.4**, verificatore **TLC 2.19**, SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`. Nessun download automatico o servizio remoto.

```bash
npm run verify:local-operation
```

`TLA_JAR` può indicare lo stesso artefatto in un'altra directory. `MEDIFLOW_FORMAL_OUTPUT`, se assoluta, conserva `result.json`; altrimenti le copie temporanee sono rimosse. Il comando è registrato tra le ricette locali con prerequisiti espliciti.

Il comando esegue baseline, mutante semantico `UnsafePreparation`, i due witness e tre mutazioni in copie isolate del codice:

1. rimuove il blocco di preparazione dopo un effetto possibile: la prova di risposta persa deve fallire per preparazione indebitamente ammessa;
2. rimuove il binding del contesto corrente: lo scambio di sessione deve diventare visibile al test;
3. rimuove la validazione dell'intero risultato MCP: metadati contaminati devono far fallire la prova dell'allowlist.

Le uscite negative devono contenere la violazione semantica attesa, non un errore di parsing. Seguono test sul codice originale e modello ripristinato. Il mutante di preparazione e quello TLA rappresentano lo stesso indebito passaggio; gli altri due qualificano i controlli runtime di sessione e uscita, senza attribuirli al modello TLA. Non si alterano gli originali per costruire i mutanti.

I risultati grezzi rimangono nel dossier locale del run; la PR riporta revisione ed esiti. Questo collegamento qualificato per i casi mutati non dimostra equivalenza generale fra TypeScript e TLA+, né sicurezza dell'intero host o ammissione clinica. L'ADR 0162 resta Proposed e CU-1b rimane necessaria.
