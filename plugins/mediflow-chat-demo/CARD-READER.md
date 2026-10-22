# Scheda sintetica nella chat — ADR 0160, unità 2c

Questo entrypoint aggiuntivo usa esclusivamente `createSyntheticCardBroker`.
Il demo originale (`src/stdio.mjs`), il suo manifest e le configurazioni esistenti
restano validi. Estendere lo stesso pacchetto evita duplicare SDK, font, token e
lockfile; non introduce pacchetti annidati o eccezioni alla guardia di inventario.
Il telecomando `mediflow-local-ui` non è coinvolto.

## Flusso e confine

Un solo tool, `mediflow_synthetic_card`, con visibilità **app-only** e risorsa
`ui://mediflow-synthetic-card/reader`. L'host deve aprire esplicitamente la vista:
il modello non dispone di un comando di approvazione. La visibilità MCP è una
funzione dell'host, non autenticazione del medico o protezione da un host ostile.
Questa composizione sintetica non concede alcuna autorità clinica.

La vista prepara una selezione fissa della fixture `basic`. L'owner locale
conserva handle e hash dei byte finali in RAM; l'adapter non riceve review,
mapping, fonti locali o configurazione del runner. La preparazione restituisce
testo fisso e una challenge casuale in `_meta`, valida 30 secondi. Dopo il clic autentico su «Condividi questa scheda con la chat»,
l'owner approva quell'hash e consuma una sola volta l'uscita del reader del broker.
Il risultato contiene una ricevuta testuale breve e, in `structuredContent`,
la sola scheda approvata. Nessun dato clinico in `_meta`.

Nessun consenso al caricamento, al focus, all'apertura di un dettaglio o tramite
clic JavaScript. Il gesto è legato alla preparazione corrente e alla vista;
il modello non può chiamare il tool negli host che rispettano app-only.
Il diniego, la scadenza di 30 secondi, una nuova vista o una revoca durante la
preparazione non rilasciano la scheda. Un nuovo turno invalida il tentativo;
una risposta tardiva non ripopola una vista chiusa. La chiusura non cancella i
byte già consegnati alla chat. Non si dichiara revoca retroattiva o retention.

La risorsa non contiene dati clinici: usa asset statici, token Lume e Newsreader,
con una chiave casuale per questa sessione. Il server la emette una sola volta
nel caricamento della risorsa; il bundle importa una chiave HMAC non estraibile
nella closure del controllo e rimuove subito il proprio script dal DOM. Le
risposte `prepare` contengono solo la challenge del tentativo, mai la chiave.
Solo il listener `isTrusted` del pulsante firma la challenge con HMAC-SHA-256
e invia challenge e firma. Un messaggio forgiato dal frame, anche conoscendo
la challenge o una firma precedente, non può approvare un altro tentativo
o rileggere la chiave tramite `resources/read`. La firma è verificata dal
server e il nonce consumato dall’owner prima dell’uscita del broker; la chiave non attraversa i tool.
Dopo la prima lettura, la risorsa non viene emessa di nuovo nella stessa sessione:
per riaprire la vista occorre una nuova sessione MCP (su stdio, riconnettere il
plugin). Questo costo di riapertura è esplicito e resta da qualificare sui desktop.
La chiave protegge il percorso di messaggi dal frame già avviato; non attesta
un renderer ostile. L’host che controlla caricamento e renderer può leggerla
e resta fuori da questo confine, come previsto dall’ADR.

La vista Usa Punto d'inchiostro, altezza interna stabile,
nessun ridimensionamento al clic e nessuna fascia laterale. Le liste sono paginate
in gruppi di dieci, senza dipendere dai limiti attuali del broker. Tutti i valori
clinici, gli pseudonimi e i riferimenti opachi sono conservati dal risultato;
nessuna ricomposizione. Non usa storage, fetch clinici, Touch ID o writer.
Gli errori applicativi e di protocollo usano testo fisso e nessun `error.data`.

## Avvio e prove

Dalla radice, con Node **24.21.0** nel PATH:

```sh
export MEDIFLOW_DATA_DIR=$(mktemp -d)
npm ci --no-audit --no-fund
npm --prefix plugins/mediflow-chat-demo ci --no-audit --no-fund
npm --prefix plugins/mediflow-chat-demo run build
npm --prefix plugins/mediflow-chat-demo test
npm --prefix plugins/mediflow-chat-demo run typecheck
npm --prefix plugins/mediflow-chat-demo run prepare:reference
npm --prefix plugins/mediflow-chat-demo run test:card-reference
npm --prefix plugins/mediflow-chat-demo run test:card-performance-negative
```

Le prove di riferimento e quelle del demo usano le medesime porte 8080, 8081 e
3017: eseguirle in sequenza. La preparazione scarica la revisione ext-apps fissata
nel pacchetto. L'ingresso aggiuntivo usa **senza modifiche** le funzioni di bridge,
caricamento risorsa e sandbox del basic-host; apre direttamente la risorsa
app-only, che il selettore dei tool destinati al modello filtra correttamente.
Non modifica visibilità, CSP o validatori per forzare il rendering.

Il test stdio avvia un processo vero e intercetta frame in entrambe le direzioni,
errori e stderr. Il broker e il nucleo di preparazione sono quelli di produzione;
**solo il runner neurale e la sua osservazione sono simulati** nel supporto di test,
come nelle prove del broker. Le evidenze simulate non vengono salvate come
qualificazione di un'installazione. La sentinella è iniettata nella fixture prima
della preparazione; i byte vengono bloccati prima dell'uscita.

L'entrypoint ordinario `src/card-stdio.mjs` richiede il file locale privato
`.local/card-installation.json`, con la struttura `SyntheticCardInstallation`
del broker: runner locale ed evidenze valide per il corpus della scheda. Non usa
impostazioni ChatGPT, non legge l'archivio e non genera evidenze sostitutive.
In assenza di requisiti risponde soltanto con l'errore fisso.

## Riprova su Codex desktop

Usare una voce MCP **aggiuntiva**, senza cambiare quella del demo. Per riprovare
il medesimo percorso sintetico automatico, impostare come comando il percorso
assoluto del Node 24.21.0 e questi argomenti, sostituendo `CHECKOUT` con la
checkout di questo branch:

```json
["--import", "CHECKOUT/scripts/register-strip-types-loader.mjs",
 "CHECKOUT/plugins/mediflow-chat-demo/test/card-stdio-fixture.mjs"]
```

Impostare `MEDIFLOW_DATA_DIR` su una nuova directory temporanea sintetica.
Questo entrypoint di prova usa il runner simulato: non prova GLiNER reale.
Aprire la vista dall'ingresso app/thread dell'host, non chiedere al modello di
approvare un tool nascosto. Se il client non offre l'ingresso app-only, registrare
il limite del client: non rendere il comando disponibile al modello per aggirarlo.

Prima del clic la scheda deve essere vuota. Provare diniego e riapertura
riconnettendo il plugin per ottenere una nuova sessione MCP; poi
condividere con tastiera, espandere storia/terapie/misure, cambiare Giorno/Grafite,
chiudere e inviare un turno successivo. Verificare assenza di salto della chat,
resize al clic, fasce laterali e JSON nella ricevuta. Controllare separatamente
`tools/call` e `resources/read` del client. **R su Codex e Claude Desktop non è
qualificata da questa PR**, né lo è L. L'esito del reference host non li sostituisce.

## Carico e limiti

Per decisione del coordinatore i budget vincolanti di questa unità riguardano
soltanto la scheda ammessa da #611: 1 evento, fino a 2 terapie e 2 misure.
**Il carico esteso ADR (100 eventi, 30 terapie, 10 documenti) NON è qualificato**,
così come la preparazione GLiNER reale di 10.000 caratteri, import e scritture.
L'estensione del broker è un'unità separata. `test/card-extended-load.mjs` prepara
le cardinalità estese e il test TODO esplicito conserva il requisito: non inietta
mai quella fixture nella vista scavalcando il broker. Quando sarà ammessa dal
broker, si potrà usare lo stesso harness e gli stessi budget.

`test:card-reference` esegue 30 aperture con cache renderer fredda e 30 con cache
calda, con runtime server già avviato. Registra p50/p95/massimo, preparazione del
broker simulato, feedback, espansione/tema e blocchi UI attribuiti al widget.
La vista utile è apertura→scelta più clic→scheda visibile e dipinta (due frame),
escludendo l’attesa umana tra scelta e clic. Registra separatamente `readyMs`,
`shareMs` e il totale `usefulMs`; il gate usa quest’ultimo.
Impone p95 5 s/2 s per vista fredda/calda, 2 s per preparazione della scheda,
100 ms per feedback e 200 ms per interazione; nessun blocco widget oltre 50 ms,
gzip sotto 250 kB, nessun resize o salto al clic. Non misura l'avvio a freddo del
processo server o del modello neurale e non li dichiara qualificati.
Gli asset e il report completo sono in `dist/card-evidence/` e negli artifact CI.

Il reference usa il Chromium completo fornito da Playwright, in modalità
headless nuova (`channel: 'chromium'`), con la versione fissata dal lockfile.
Su macOS il precedente `headless-shell` inizializzava sincronicamente
WindowServer/TCC al primo ricalcolo dell’hover: la profilazione ha individuato
una pausa di 51.6 ms nel renderer, con 1.9 ms di CPU. Non era lavoro HMAC,
parsing o rendering della scheda. Il cambio di browser non cambia host,
sandbox, osservatore o budget. Diagnosi e tre budget consecutivi sono in
[`evidence/card-performance-profile.json`](evidence/card-performance-profile.json)
e [`evidence/card-reference-summary.json`](evidence/card-reference-summary.json).

Il controllo negativo verifica 75 ms di lavoro sincrono al clic, che devono
fallire il gate dei long task oltre 50 ms, oltre a 150 ms di blocco del clic e 2200 ms
aggiunti alla risposta reale `share`: il ritardo di consegna deve fallire il budget caldo
della vista utile dopo tutte le 30 aperture fredde e 30 calde. La suite reference
include messaggi forgiati con challenge nota e nuovi turni/tool call mentre
la risposta di preparazione è trattenuta.
