# WUL-832: protocollo congelato prima della misura

La PR #938 passa se diminuisce il numero di attribuzioni sbagliate e conserva almeno due terzi delle diagnosi nuove proposte da main. Una fonte sbagliata pesa piu di una diagnosi nuova mancata. Il merge resta al coordinatore.

Protocollo fissato il 11 novembre 2026, prima della prima inferenza di questa campagna. Corpus SHA-256: `d1f8d9aab712fc28db48e3ae5abd38f4e7b5af1f5f8f24bd2b54cb8beae515be`.

## Definizioni meccaniche

- **Diagnosi nuova attesa:** uno dei cinque concetti elencati in `corpus.json`, presente nei documenti sintetici e assente da `currentDiagnoses`. I sinonimi ammessi sono espressioni regolari congelate nel corpus. Una diagnosi conta se `label` o `icdQuery` corrisponde al concetto. Ogni concetto conta al massimo una volta per richiesta. Le altre diagnosi sono registrate separatamente e non aumentano il richiamo.
- **Diagnosi nuova proposta:** diagnosi attesa contenuta nella proposta finale accettata dal vero controllo dell host. Un errore, una risposta troncata o una proposta rifiutata valgono zero. Denominatore: 20 opportunita per paziente, 100 totali. Non si condiziona il richiamo al successo della richiesta.
- **Fonte sbagliata:** ogni oggetto di `diagnoses`, `therapies`, `servicePrescriptions` ed ogni item annidato che ha (a) `sourceId` assente dalle fonti, oppure (b) un excerpt `evidence` rintracciabile in un altra fonte ma assente da quella citata, oppure (c) una diagnosi attesa attribuita ad una fonte diversa da quelle ammesse nel corpus, oppure (d) una diagnosi gia in scheda, riconosciuta dai pattern congelati, che non compare nella fonte citata. Per (b) si normalizzano Unicode, accenti, maiuscole, punteggiatura e spazi, senza cambiare parole o numeri. Ogni oggetto conta una sola volta, anche con piu errori.
- **Evidenza non risolta:** excerpt non letterale che non si trova in nessuna fonte e non ricade in (c) o (d). Si riporta separatamente, senza dichiararlo verificato o trasformare automaticamente una parafrasi in una fonte sbagliata. Questa misura delle fonti sbagliate e quindi un limite inferiore meccanico, non una verifica semantica completa.
- **Proposta andata a buon fine:** `preview.status === available`, proposta non nulla, `writesPerformed === 0` e `apply === denied`. Si misura la proposta per la revisione del medico. Non si applica nulla all archivio.

Si contano fonti sbagliate sia in tutte le risposte grezze (compresi i tentativi rifiutati) sia nelle sole proposte finali accettate. La decisione richiede meno errori grezzi a parita di 100 richieste ed errori visibili non superiori a main. Se main ha errori visibili, devono diminuire anche quelli. In questo modo una riduzione degli errori gia bloccati non autorizza ad aumentarli davanti al medico. Un peggioramento delle evidenze non risolte rimane un limite esplicito da sottoporre al coordinatore.

## Esecuzione

Cinque pazienti sintetici: P1 e P2 conservano integralmente il contesto delle catture precedenti, P3-P5 aggiungono anemia sideropenica, bronchiectasie e fibrillazione atriale. Una diagnosi nuova attesa per ciascuno, con controlli negativi anamnestici nei casi aggiunti. Stessi documenti, ordine e semi nei due bracci. Venti richieste per paziente, eseguite in 20 giri P1-P5. Seme: `832000 + indicePaziente * 1000 + giro * 10 + indiceTentativo`, con indici da zero. Il secondo tentativo, quando previsto dall host, ha il seme successivo.

Il banco usa Ollama su `127.0.0.1:64812`, modello `qwen3.5:35b-a3b`, `OLLAMA_MODELS=/Volumes/Vision/ollama-models`, temperatura 0.4 e thinking disattivato come nella misura precedente. Il trasporto della sonda aggiunge solo `options.seed`. Prompt, schema, tetto, retry e controllo sono quelli del codice di ciascun braccio. Nessun servizio sulle porte 11434 o 11435.

Si riusa il rigioco della misura precedente e si invoca direttamente `createPatientSmartImportHostCapability` con il vero registro, adapter Ollama, router e validatore. Kill switch, broker e stato del ciclo di vita ricevono fixture sintetiche, senza aprire un archivio. Questo isola la modifica misurata e permette di ripetere esattamente gli stessi documenti. Non misura cattura dalla UI, abbinamento GPUI, persistenza o applicazione delle proposte. Le risposte grezze conservano il formato della precedente cattura, con l aggiunta di paziente, giro, braccio e seme.

Main e ramo sono revisioni fissate e riportate nel risultato. In caso di mancato superamento si prova una sola alternativa, con lo stesso corpus, semi, controllo e soglia. Errori del banco non vengono eliminati dai conteggi. Un banco non funzionante rende la decisione non provata.

## Preparazione del banco, prima delle misure

Il server installato 0.40.16 e rifiutato dall attestazione di MediFlow. Si usa la release ufficiale 0.40.6, verificata contro `sha256sum.txt`, senza modificare l attestazione. Come nella ricetta precedente: `OLLAMA_GO_TEMPLATE=true` e `OLLAMA_NO_CLOUD=true`. Due avvii preliminari hanno mostrato attese nella gestione della memoria Metal. La terza prova a secco usa `MLX_METAL_RESIDENCY_REFRESH_INTERVAL_MS=0` e `MLX_RESIDENCY_SET_MAX_PCT=0`: la libreria documenta il secondo valore come un unico insieme di residenza, senza cambiare la quantita di memoria o i pesi. La configurazione effettiva e salvata nei grezzi e restera identica nei bracci. Le prove a secco non sono richieste della campagna. Se il provider fallisce durante una campagna, la sonda salva il tentativo e si interrompe: la corsa incompleta non puo passare la regola.

Banco ammesso prima della campagna: cinque richieste a secco, tutte accettate dall host, sei chiamate al modello complessive. Nessuna suite completa in parallelo. Il server Ollama gira con priorita ordinaria, la sonda con `nice -n 10`. Restano attive le due variabili MLX sopra indicate. Node 24.18.0, Ollama 0.40.6. Le due campagne usano questo stesso processo server e lo stesso digest del modello.
