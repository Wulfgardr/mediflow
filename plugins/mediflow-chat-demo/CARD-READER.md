# Scheda sintetica nella chat — ADR 0160, unità 2c–2d

Questo entrypoint aggiuntivo usa esclusivamente `createSyntheticCardBroker`.
Il demo originale (`src/stdio.mjs`), il suo manifest e le configurazioni esistenti
restano validi. Estendere lo stesso pacchetto evita duplicare SDK, font, token e
lockfile; non introduce pacchetti annidati o eccezioni alla guardia di inventario.
Il telecomando `mediflow-local-ui` non è coinvolto.

## Flusso e confine

`mediflow_synthetic_card_open` è visibile al modello e collega la risorsa
`ui://mediflow-synthetic-card/reader` con `_meta.ui.resourceUri`: apre la carta
inline e restituisce soltanto la frase costante «Apri la vista per scegliere se
condividere la scheda sintetica.», senza dati. `mediflow_synthetic_card` rimane
**app-only** per preparazione, condivisione, conferma di consegna e revoca, con ingresso app/thread
aggiuntivo. Il modello non dispone di un comando di approvazione. La visibilità MCP è una
funzione dell'host, non autenticazione del medico o protezione da un host ostile.
Questa composizione sintetica non concede alcuna autorità clinica.

La vista prepara una selezione fissa della fixture `basic`. L'owner locale
conserva handle e hash dei byte finali in RAM; l'adapter non riceve review,
mapping, fonti locali o configurazione del runner. La preparazione restituisce
testo fisso e una challenge casuale in `_meta`, valida 30 secondi. Dopo il clic autentico su «Condividi questa scheda con la chat»,
l'owner approva quell'hash e consuma una sola volta l'uscita del reader del broker.
Il risultato contiene una ricevuta testuale breve e, in `structuredContent`,
la sola scheda approvata. `_meta.approvedPayload` conserva la stringa esatta del
broker, senza riserializzarla; non contiene fonti originali, mapping o hash.
`_meta.attemptId` identifica il tentativo approvato. Subito prima dell'invio
la vista chiama `deliver`: l'owner verifica vista, tentativo corrente,
generazione, scadenza e consumo monouso senza attese intermedie.
Solo dopo questa conferma e il controllo dell'epoca la vista invia la stringa come
un unico blocco `content: [{ type: 'text', text: approvedPayload }]` tramite
`App.updateModelContext`, cioè `ui/update-model-context`. La resa `[omesso]`
non viene applicata ai byte consegnati.

La [specifica MCP Apps 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
e la [guida OpenAI](https://developers.openai.com/plugins/build/chatgpt-ui)
indicano questo canale per il contesto dei turni successivi. Il
[riferimento OpenAI](https://developers.openai.com/plugins/reference) separa
risultati e metadati per la vista. La capability `updateModelContext.text`
deve essere presente; un canale assente o rifiutato lascia la vista vuota con
un messaggio fisso. Non vengono usati widget state, log, messaggi sostitutivi
o un tool visibile al modello per aggirare un diniego. Una risposta positiva
del bridge prova l'accettazione dell'host, non una richiesta al provider o la
retention. Il basic-host ufficiale conserva il contesto ma non esegue un modello:
il suo esito non dimostra ricezione da parte del modello desktop.

Nessun consenso al caricamento, al focus, all'apertura di un dettaglio o tramite
clic JavaScript. Il gesto è legato alla preparazione corrente e alla vista;
il modello non può chiamare il tool negli host che rispettano app-only.
Il diniego, la scadenza di 30 secondi senza scelta, una nuova vista o una revoca
durante la preparazione non rilasciano la scheda. La finestra di 30 secondi
serve solo a decidere; il clic autentico ferma il timer della vista, mentre
l'owner conserva il proprio controllo di validità. Una carta già condivisa
rimane visibile fino alla chiusura o all'invalidazione. Un nuovo input/risultato
dell'host invalida anche la carta condivisa: gli involucri iniziali vuoti sono
ignorati solo durante l'inizializzazione, mai dopo la preparazione. Cancellazione
e teardown invalidano lo stesso stato. Una risposta `share` trattenuta oltre
una chiusura autorevole, revoca o nuova preparazione non può ottenere `deliver`:
la vista resta vuota e non aggiorna il contesto.

**Limite della consegna:** l'autorizzazione si linearizza al consumo di
`deliver` sul server. Una chiusura successiva, durante il ritorno della
conferma o prima dell'invio al bridge, non può ritirare quell'autorizzazione.
Un'altra conferma sposterebbe la stessa finestra distribuita. Per eliminare
la finestra serve il consumo del tentativo nell'host insieme all'accettazione
del contesto. Il prototipo resta soltanto sintetico; il limite completo è in
[ADR 0160](../../docs/adr/0160-mediflow-in-desktop-chat.md).

**Limite del turno:** la specifica e l'SDK fissati non espongono un evento
universale di inizio turno. Il test invia vere notifiche di input/risultato del
bridge ufficiale; non dimostra che un desktop le invii quando l'utente scrive
un messaggio senza tool. Se l'host non notifica né rimuove la vista, il plugin
non può osservare quel turno. La prova desktop precedente ha osservato proprio
questo mancato ritiro; la qualifica completa del punto richiede una nuova prova
nel desktop e, se il comportamento persiste, supporto dell'host.

La chiusura non cancella i byte già consegnati alla chat. Non si dichiara revoca retroattiva o retention.

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
La chiave protegge soltanto il tool `share` dai messaggi forgiati dopo il
bootstrap fidato; non attesta codice arbitrario nel frame o un renderer ostile. L’host che controlla caricamento e renderer può leggerla
e resta fuori da questo confine, come previsto dall’ADR.

Il canale `ui/update-model-context` è fidato quanto il frame. Il bridge non
verifica firma, nonce o consenso e accetta byte arbitrari dal frame; HMAC
non protegge questo canale. La garanzia del broker è non consegnare al frame
dati MediFlow non approvati: nessun payload in `prepare`, diniego o revoca,
nessuna fonte/mappe fra le risorse leggibili e soltanto l'artefatto approvato
in `share`. Un frame compromesso può inviare byte propri o già approvati;
la revoca non può cancellare byte già ricevuti. I test intercettano anche
`_meta`, `structuredContent` e le risorse, non soltanto il testo del tool.

La CSP della risorsa usa l'hash per istanza del bundle incorporato, senza
script remoti, eval o script inline aggiunti. Il solo codice di dipendenze
è incluso nel bundle locale (SDK MCP); nessun codice di terzi viene caricato
in rete dalla risorsa `ui://`. Stili dinamici dell'host e font incorporato
sono necessari alla resa; connessioni e altre risorse sono negate.

La vista usa Punto d'inchiostro, altezza interna stabile,
nessun ridimensionamento al clic e nessuna fascia laterale. Le liste sono paginate
in gruppi di dieci, senza dipendere dai limiti attuali del broker. Tutti i valori
clinici, gli pseudonimi e i riferimenti opachi sono conservati dal risultato;
i token `{{MF_PII_…}}` sono presentati come `[omesso]` nei due temi, senza
ricomposizione o modifica del payload. La carta segue `hostContext.theme`:
i token Giorno/Grafite governano i suoi colori, anche dopo una scelta manuale,
così variabili scure dell'host non possono lasciare scuro il tema Giorno. Non usa storage, fetch clinici, Touch ID o writer.
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
npm --prefix plugins/mediflow-chat-demo run test:card-desktop
npm --prefix plugins/mediflow-chat-demo run test:card-desktop-negative
npm --prefix plugins/mediflow-chat-demo run test:card-reference
npm --prefix plugins/mediflow-chat-demo run test:card-performance-negative
```

Le prove di riferimento e quelle del demo usano le medesime porte 8080, 8081 e
3017: eseguirle in sequenza. La preparazione scarica la revisione ext-apps fissata
nel pacchetto. L'ingresso aggiuntivo usa **senza modifiche** le funzioni di bridge,
caricamento risorsa e sandbox del basic-host; prova l'ingresso app-only e quello
inline visibile al modello. I callback del contesto registrano i byte accettati
dall'host ufficiale; i casi negativi simulano un suo diniego e l'ingresso da
pannello senza involucro iniziale.
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
Chiedere al modello di chiamare `mediflow_synthetic_card_open` con `{}` e aprire
la sua vista inline. L'ingresso app/thread resta disponibile. Non chiedere al
modello di approvare il tool app-only. Se il client non rende la risorsa,
registrare il limite senza spostare dati nel tool di apertura.

Prima del clic la scheda deve essere vuota. Provare diniego e riapertura
riconnettendo il plugin per ottenere una nuova sessione MCP; poi
condividere con tastiera, espandere storia/terapie/misure, cambiare Giorno/Grafite,
verificare che la carta resti visibile oltre 30 secondi dalla scelta e inviare
un turno successivo mentre è ancora aperta. In una sessione distinta chiudere
la carta e verificare che nessuna risposta tardiva la ripopoli. Nel turno
successivo chiedere i soli riferimenti già consegnati, senza strumenti, letture
visive o riferimenti nel prompt, per distinguere l'accettazione del bridge
dalla ricezione effettiva nel contesto del modello. Verificare assenza di salto della chat,
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


`test:card-desktop` copre ingresso inline, byte approvati e accettati dal bridge,
`isTrusted`, revoca, colori calcolati con host scuro, segnaposto nei due temi,
timer prima/dopo consenso e notifiche dopo la condivisione. Le regressioni sono
state osservate sulla base #613 prima delle correzioni. `test:card-desktop-negative`
rimuove separatamente le sette correzioni (i due involucri del punto 6 sono
separati), verifica il fallimento pertinente e ripristina il codice; al termine
ripete le regressioni con le correzioni. La CI esegue entrambi, oltre alla suite
unit completa nel Web Core; questi test mirati non la sostituiscono.
