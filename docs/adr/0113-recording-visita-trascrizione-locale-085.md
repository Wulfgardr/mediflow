# ADR 0113: recording visita e trascrizione locale nella 0.8.5

Date: 2026-09-01
Status: Accepted

Issue: [GitHub #280](https://github.com/Wulfgardr/mediflow/issues/280)

Program line: candidata `0.8.5`

Related: [ADR 0065](./0065-intended-purpose-and-claims-guard.md),
[ADR 0072](./0072-voice-visit-capture-fluid-boundary.md),
[ADR 0110](./0110-riapertura-governata-programma-intelligente-085.md),
[ARCHITECTURE.md](../../ARCHITECTURE.md) e
[SECURITY.md](../../SECURITY.md).

## Problema

ADR 0072 ha fissato il boundary review-first della registrazione visita, ma ha
rinviato ogni runtime. ADR 0110 ha riaperto la capability per la `0.8.5` senza
autorizzare implicitamente microfono, storage audio, trascrizione cloud o
scritture cliniche.

Serve ora scegliere il primo percorso Apple implementabile e verificabile,
preservando il deployment macOS 14 dell'app, il default local-first e il
legame univoco tra registrazione, paziente corrente e bozza revisionata.

## Contesto e vincoli invariati

- Il solo target iniziale e `MediFlowMacApp`; i client paired non catturano e
  non trasportano audio.
- Il deployment target generale resta macOS 14. Le API Speech di nuova
  generazione sono disponibili soltanto dietro un gate runtime macOS 26 o
  successivo.
- Audio, transcript, segmenti e draft prodotti da una visita reale sono PHI.
  Non entrano in Git, log, telemetria, crash breadcrumb o benchmark.
- Il raw audio non viene mai persistito. Non esistono file temporanei, colonne
  database, backup, upload o endpoint audio.
- La trascrizione e una proposta fallibile. Non costituisce authority clinica
  e non applica diagnosi, terapie, prescrizioni o diario.
- Il medico conserva l'ultima decisione: ogni append usa un writer nominato,
  una review corrente e una conferma distinta dalla cattura.

## Opzioni

1. Cattura browser con `MediaRecorder` e invio al nodo home-base.
2. SDK o applicazioni Fluid, oppure `SFSpeechRecognizer` con percorso di
   servizio non controllabile.
3. Pipeline Apple on-device nel target macOS, con buffer effimero e
   `SpeechAnalyzer`/`SpeechTranscriber` gated.

## Trade-off

- L'opzione 1 estende la superficie paired e trasporta raw audio sulla rete.
- L'opzione 2 riapre licenze, processi e possibili percorsi cloud non necessari
  alla prima slice.
- L'opzione 3 mantiene acquisizione e inferenza nello stesso processo Apple,
  ma richiede macOS 26+, asset speech locali, permessi espliciti e test su
  hardware reale.

## Decisione

Adottiamo l'opzione 3 come contratto accettato per la `0.8.5`.

Questo ADR rende implementabile la decisione generale di ADR 0072 e ne
sostituisce soltanto il rinvio del runtime. Restano validi local-first,
review-first, assenza di raw audio persistito, divieto di cloud implicito e
separazione dalla scrittura clinica.

La pipeline ammessa e:

```text
consenso informato MediFlow
  -> permesso microfono del sistema
  -> AVAudioApplication
  -> AVAudioEngine input tap
  -> coda PCM bounded in RAM
  -> SpeechAnalyzer + SpeechTranscriber(locale: it-IT)
  -> soli segmenti finali
  -> transcript editabile in review
  -> bozza revisionabile
  -> eventuale writer nominato con nuova conferma
```

Non appartengono alla lane `SFSpeechRecognizer`, trascrizione cloud, FluidVoice,
FluidAudio, Fluid Intelligence, `MediaRecorder`, upload audio o fallback verso
provider testuali.

## Disponibilita e packaging

- `MediFlowMacApp` continua a compilare per macOS 14.
- La capability e costruita dietro `if #available(macOS 26.0, *)`; sulle
  versioni precedenti la UI mostra `non disponibile su questo Mac` e non
  richiede permessi ne asset.
- Il target dichiara `NSMicrophoneUsageDescription`; la sua assenza e un errore
  di build o di contract test, non una degradazione silenziosa. Il target
  corrente non abilita App Sandbox e quindi non dichiara
  `com.apple.security.device.audio-input`. Un'eventuale sandbox futura richiede
  una decisione separata, l'entitlement audio-input e una nuova verifica.
- Non viene richiesta l'autorizzazione di `SFSpeechRecognizer` e non viene
  introdotto un entitlement di rete per la trascrizione.

## Consenso e stato della sessione

La UI presenta prima un'informativa MediFlow che spiega acquisizione locale,
assenza di salvataggio audio, uso della trascrizione e modalita di annullamento.
Solo il gesto esplicito `Consenti microfono e continua` puo invocare il prompt
del sistema. Aprire la pagina o mostrare il controllo non richiede permessi.
La callback di `AVAudioApplication.requestRecordPermission` puo arrivare fuori
dal main thread; ogni transizione UI viene riportata sul `MainActor`.

La macchina a stati minima e:

```text
unavailable -> disclosure -> permissionRequired -> preparingAssets
            -> ready -> recording -> finalizing -> transcriptReview
            -> draftReview -> completed
```

`denied`, `interrupted`, `assetUnavailable`, `bufferExceeded`, `staleBinding`,
`cancelled` e `failed` sono stati terminali fail-closed. Un denial mostra il
percorso di recupero verso le impostazioni di sistema, senza retry automatico.
Durante `recording` un indicatore persistente e accessibile e il controllo Stop
restano visibili nella shell Lume. Sleep, perdita input, cambio paziente,
revoca del permesso o uscita dalla vista arrestano l'engine e svuotano i
buffer.

## Asset speech locali

Prima del primo avvio la capability risolve `it-IT` tramite
`SpeechTranscriber.supportedLocale(equivalentTo:)`, costruisce il transcriber
con la locale restituita e interroga `AssetInventory.status(forModules:)`.
Se necessario, crea `assetInstallationRequest`, mostra il `Progress` esposto
dal framework e avvia `downloadAndInstall()` soltanto dopo un'azione separata
ed esplicita. Completata l'installazione, riserva la locale con
`AssetInventory.reserve(locale:)`. Il download contiene soltanto asset vendor
e non payload clinici; non avviene mentre una sessione visita e attiva.

`AssetInventory` non espone digest, versione o byte-size degli asset. La
receipt registra quindi build del sistema, locale risolta, `isAvailable`,
`installedLocales`, stato e risultato della reservation, senza inventare una
provenienza per-artifact. Asset assente, locale non supportata, installazione o
reservation fallita, richiesta `nil`, limite `maximumReservedLocales`
raggiunto o ritorno `false` lasciano la capability disabilitata. La reservation
ha lifetime esplicito nel controller e viene rilasciata quando la capability
viene dismessa. Non esiste fallback cloud o verso un'altra lingua.

## Memoria, backpressure e cancellazione

L'input tap produce buffer PCM. Il controller sceglie prima
`SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith:considering:)`, prepara
l'analyzer con `prepareToAnalyze(in:)` e converte in RAM i buffer hardware
quando il formato non coincide; nessun buffer convertito viene persistito. Il
callback del tap copia immediatamente i frame in memoria owned e non blocca il
thread audio. MediFlow mantiene una coda propria limitata al minore tra quattro
secondi di audio e 8 MiB. Non conserva l'intera sessione. Se il consumer non
tiene il passo, la registrazione termina con `bufferExceeded`; non vengono
scartati frame per produrre una trascrizione apparentemente completa.

La sessione ha durata massima proposta di 90 minuti e transcript massimo di
256 KiB UTF-8. Questi limiti sono costanti host-owned e vengono mostrati prima
della cattura. L'eventuale memoria interna dei framework Apple resta opaca e
deve essere misurata nel benchmark; non viene inclusa nel claim sul buffer
MediFlow.

Su Stop il controller rimuove il tap, ferma l'engine, chiude l'input sequence,
chiama `finalizeAndFinishThroughEndOfInput()`, drena i risultati e accetta solo
quelli con `isFinal`. Su Cancel usa `cancelAndFinishNow()`. In entrambi i casi
azzera la coda PCM e ritira la session reference. Non si usano `AVAudioFile`,
file temporanei, cache audio o serializzazione dei buffer.

## Finalita, currentness e review

All'avvio il controller crea una session reference opaca e process-local,
legata alla selezione host-owned del paziente e alla sua revision corrente.
Identificativi, transcript e testo parziale non vengono registrati nei log.

I risultati parziali possono alimentare soltanto la vista effimera. Un
transcript diventa revisionabile solo dopo che `SpeechAnalyzer` ha terminato e
tutti i segmenti accettati da `SpeechTranscriber` risultano finali. Prima di
pubblicarlo, il controller riconferma la stessa session reference, lo stesso
paziente selezionato e la currentness richiesta. Un binding stale cancella il
risultato anziche riallegarlo al paziente corrente.

La prima slice non persiste il transcript. Il testo vive in memoria fino ad
annullamento o completamento della review. Una bozza derivata conserva il
digest della precisa versione del transcript. Qualsiasi edit del transcript:

1. invalida la bozza derivata;
2. invalida ogni stato di review o conferma precedente;
3. richiede rigenerazione e nuova review esplicita.

La bozza non puo riusare il consenso microfono come proof di scrittura. Un
append successivo attraversa un Application Service e un writer nominati, con
expected revision, conferma monouso e audit PHI-safe. Questo writer non viene
creato da ADR 0113.

## First Thin Slice

1. Aggiungere un contratto Swift puro per stati, limiti, currentness e
   invalidazione transcript-draft, testabile senza microfono.
2. Aggiungere l'adapter macOS 26 per permesso, asset `it-IT`, `AVAudioEngine`
   e analyzer, senza persistenza e senza writer clinico.
3. Aggiungere alla shell Lume disclosure, start/stop, indicatore, denial
   recovery e transcript review effimera.
4. Eseguire test, hardware smoke e benchmark sintetico; soltanto dopo i gate
   collegare la generazione della bozza reviewable.

Ogni passo oltre circa 300 LOC o che introduce un secondo boundary viene
separato in un issue e worktree ulteriori.

## Verifica richiesta

### Test deterministici

- unit test della macchina a stati, di ogni denial e del cleanup idempotente;
- test di coda e backpressure ai due limiti, senza frame drop;
- test di binding corrente, cambio paziente e result non-final;
- test che un edit invalida bozza, digest e review;
- guard contro file audio, logging del transcript, `SFSpeech`, Fluid e route
  audio;
- build e XCTest di `MediFlowMacApp` sia con deployment 14 sia con SDK 26+.

### Hardware smoke

Su un Mac dell'exact candidate: consenso MediFlow, prompt OS, start, indicatore,
stop, finalizzazione `it-IT`, annullamento e denial recovery. Lo smoke usa solo
frasi artificiali e verifica che non compaiano file audio prima, durante o
dopo la sessione.

### Benchmark sintetico

Il corpus contiene almeno 30 clip italiane artificiali e 3.000 parole di
riferimento, generate senza dati reali e con piu voci e velocita. Prima del
run vengono fissati corpus hash, hardware, OS, asset, soglie e comando. Gate
iniziali: WER corpus non superiore al 20%, nessun transcript vuoto, p95 di
finalizzazione dopo Stop non superiore a 3 secondi, real-time factor non
superiore a 1, coda MediFlow mai oltre 8 MiB e delta peak RSS non superiore a
1 GiB. Le metriche restano quality evidence di una bozza, non accuratezza
clinica.

## Conseguenze

La prima implementazione resta interamente locale e isolata nel client macOS,
senza modificare schema, API paired o storage audio. Il deployment generale non
cambia, ma recording e transcript richiedono macOS 26+ e asset `it-IT`.

I principali rischi residui sono consumo memoria/energia del framework,
qualita su lessico clinico, comportamento delle interruzioni hardware e
disponibilita degli asset. Restano misurabili prima dell'enable.

## Stop rule e claim ceiling

Fermare la lane se compare persistenza del raw audio, file temporaneo, egress,
fallback cloud, `SFSpeech`, dipendenza Fluid, avvio senza consenso, risultato
non-final, binding paziente ricostruito dal caller, frame drop silenzioso,
riuso della review dopo un edit o scrittura clinica senza nuovo proof.

Fino a runtime integrato e gate superati, il claim massimo e: **contratto
accettato per recording e trascrizione locale Apple nella 0.8.5;
nessuna capability runtime consegnata o release-ready**.

## Fonti primarie

- [Apple SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer)
- [Apple SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber)
- [Apple AVAudioApplication](https://developer.apple.com/documentation/avfaudio/avaudioapplication)
- [Apple AVAudioEngine](https://developer.apple.com/documentation/avfaudio/avaudioengine)
