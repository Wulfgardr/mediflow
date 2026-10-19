# MediFlow: client Rust / GPUI collegato

Il comando normale apre il client nativo collegato al servizio MediFlow.
La finestra, lo stato di lavoro, lo sblocco v3, la decrittazione e il trasporto
sono Rust. Il servizio esistente conserva autorizzazione, SQLite, controllo
delle versioni e audit. Il percorso `--demo` mantiene separatamente la prima
prova con cinque pazienti inventati in memoria.

Il lavoro è nella [PR 558](https://github.com/Wulfgardr/mediflow/pull/558),
collegata a [WUL-706](https://linear.app/wulfgardr/issue/WUL-706) e
[WUL-714](https://linear.app/wulfgardr/issue/WUL-714).
Il [verbale del client collegato](../../docs/analysis/2026-10-17-rust-gpui-connected-client.md)
riporta la copertura effettiva, il confronto old/new e le prove della finestra.
Il [verbale del primo pilota](../../docs/analysis/2026-10-17-rust-gpui-patient-pilot.md)
e le immagini `linux-review.png` / `linux-saved-grafite.png` restano evidenza
storica della demo; non documentano la nuova connessione.

## Avvio del client

Dal checkout completo, con Rustup disponibile:

```bash
cd experiments/gpui-patient-pilot
cargo run --locked -p mediflow-gpui-patient-pilot -- --server https://INDIRIZZO-DEL-SERVIZIO
```

Omettere `--server` lascia il campo indirizzo vuoto. L'opzione precompila
soltanto l'indirizzo: non autentica, non sceglie un archivio locale e non
riceve passphrase o token dalla riga di comando.

Occorrono un servizio candidato con protocollo network **1.13 o successivo
nella serie 1.x**, che dichiari `scope.requestBinding: expected-ambulatory-id-v1`
nell'identità, un account con sblocco **v3** e un abbinamento ordinario del
dispositivo con le capability dei percorsi desiderati. Le piattaforme sono
esplicite: `macos`, `windows`, `linux`; i valori Apple già ammessi restano
`ios` e `ipados`. La release 0.9.0 con sblocco precedente non è un host
compatibile per questo accesso nativo v3. Il confronto con quella release
è una prova distinta di lettura tramite il suo client Web.

Ogni richiesta con un ambulatorio selezionato porta anche
`x-mediflow-expected-ambulatory-id`, codificato come il relativo cookie.
Il servizio confronta questa asserzione con lo scope che ha già risolto;
non la usa per concedere o scegliere uno scope. Uno scope scomparso o
incoerente riceve `403` anche se esiste un ambulatorio predefinito.
Un host privo del supporto dichiarato viene rifiutato prima della richiesta
clinica. L'identità preliminare resta un controllo di compatibilità e
dell'operatore, non una prova atomica del successivo commit.

1. Inserire indirizzo, identificativo e codice di abbinamento. L'impronta
   SHA-256 del certificato è facoltativa e va usata soltanto se si conosce
   l'identità del certificato locale. Il primo passaggio non dichiara ancora
   verificata la connessione.
2. Accedere con nome utente e frase di accesso. La derivazione delle chiavi
   avviene fuori dal thread grafico.
3. Scegliere fra gli ambulatori restituiti dall'account e aprire una scheda.
   Le capability del dispositivo sono indicazioni di disponibilità; il
   servizio decide ogni richiesta.
4. Usare «Blocca» per ritirare la sessione dell'operatore e nascondere i dati.
   L'abbinamento resta soltanto nella memoria del processo per un nuovo
   accesso; «Cambia collegamento» e la chiusura lo eliminano.

HTTPS usa la verifica ordinaria del certificato o il pin esplicito del DER
esatto, con verifica della firma TLS. HTTP è ammesso soltanto su un indirizzo
letterale di loopback, per esempio `http://127.0.0.1:PORTA`, e non insieme a
un pin TLS. Redirect, proxy impliciti e retry automatici sono disabilitati.
Passphrase, chiave e codice di abbinamento non vengono salvati in preferenze.
La custodia descritta è quella del processo; non è una promessa di
cancellazione fisica degli appunti o di memoria già copiata dal sistema.

Per la demo indipendente da Node:

```bash
cargo run --locked -p mediflow-gpui-patient-pilot -- --demo
```

La demo ripristina le fixture alla chiusura. Il client collegato registra
invece vere operazioni sul servizio selezionato: per una prova usare un
archivio sintetico creato esplicitamente.

## Interfaccia e registrazione

La shell riprende Punto d'inchiostro dal contratto pubblicato: piano clinico
opaco, identità persistente, quadro e diario, soglia della scrittura,
Giorno/Grafite, focus visibile, navigazione per aree e disposizione compatta.
Newsreader serve titoli, nomi in testata e prosa; i controlli e le righe di
elenco usano il carattere di sistema, IBM Plex Mono soltanto i codici.
I colori vengono dai token effettivi
[`docs/design/lume/tokens/lume.tokens.json`](../../docs/design/lume/tokens/lume.tokens.json),
che contengono il tema corrente Punto d'inchiostro, non dal vecchio banco
statico. Font e marchio sono asset locali del prodotto; le icone usano i
tracciati Lucide già adottati nel client Web. Newsreader incorpora quattro
facce statiche reali: Regular, Bold, Italic e Bold Italic. La fonte Web resta
invariata; il [manifest](../../app/fonts/Newsreader-Native.manifest.json)
registra versione 1.003, origine, licenza e hash. Lo script
[`build-newsreader-native.py`](./scripts/build-newsreader-native.py) usa
FontTools 4.61.1; il recupero della fonte ufficiale richiede `--fetch-source`
esplicito e non avviene durante avvio o build Cargo.

Il campo allergie non esiste nella proiezione paziente corrente: la UI indica
«dato non disponibile» e non lo traduce in «nessuna allergia». I campi cifrati
non leggibili hanno uno stato distinto e non diventano campi vuoti editabili.
Le schede archiviate restano in consultazione. La creazione e la modifica
dell'anagrafica distinguono campi omessi, valori e svuotamenti espliciti.
Diario, terapie, parametri e controlli hanno moduli nativi versionati; il
corpo HTML già registrato viene conservato durante la modifica di titolo e
data. Le stringhe dei risultati clinici non vengono convertite in numeri.
Il selettore nativo cerca nel repertorio dell'archivio e permette di scegliere
o sostituire esplicitamente un farmaco. Nome, AIC, ATC e principio attivo
passano insieme nella bozza; dose, motivo e date conservano i valori inseriti.
«Annulla scelta del farmaco» ripristina l'identità precedente. La registrazione
segue la revisione e la conferma della terapia, con rilettura dei quattro campi.

In Documenti, «Sintesi e fonte» apre i contenuti già salvati ricevuti con
l'elenco: sintesi, nome e data della fonte, estratto e stato di elaborazione.
La vista distingue contenuti assenti, non leggibili, formato non supportato
e una fonte che indica un altro documento; non attesta la corrispondenza con
l'originale attuale. I testi lunghi sono abbreviati con un avviso esplicito.
L'apertura non richiede il blob, non avvia inferenze e non scrive metadati.
La selezione viene ritirata quando si rilegge o si cambia contesto. «Salva
una copia…» resta una richiesta esplicita dell'originale; un errore nella
sola sintesi o fonte non la disabilita se l'originale è leggibile.

Una bozza resta legata a paziente, ambulatorio e sessione. La revisione mostra
che cosa verrà registrato; una conferma separata invia la richiesta una sola
volta. «Registrata» appare soltanto dopo una nuova lettura con versione e
contenuti attesi. In caso di conflitto, rifiuto, risposta persa o rilettura
non disponibile, l'esito rimane esplicito e la bozza resta recuperabile.
Il client non interpreta un timeout come mancata scrittura.

In Impostazioni, «Stato funzioni AI» consulta la configurazione dell'archivio
tramite il discovery paired esistente: quattro funzioni, runtime locale e
centrale, modelli clinico e di ragionamento. «Rileggi stato AI» aggiorna i
valori e l'ora di ricezione. Ogni nuova lettura ritira lo stato precedente;
il cambio di contesto e il blocco invalidano le risposte ancora in volo.
Il rientro in Impostazioni legge di nuovo la configurazione. Questa vista
non qualifica la disponibilità dei modelli, non avvia generazioni e non
modifica la configurazione AI.

«Preferenze funzioni AI» apre una sottopagina GPUI sul contratto nativo v1
esistente: GET/POST `/api/v1/network/ai/functions` e POST `/preview`. Serve
un operatore amministratore e l'autorizzazione esplicita dell'host per quel
dispositivo/operatore; il client non crea o concede permessi. Le preferenze
valgono per tutti gli operatori dell'host. Le opzioni sono solo quelle del
catalogo restituito, con disponibilità dichiarata come configurazione, non
come inferenza verificata. La v1 non espone il provider portable v2.

Una sola bozza per funzione o preset attraversa anteprima dell'host, gesto
separato di conferma e rilettura. L'anteprima deve restituire lo stesso comando,
catalogo e zero scritture; «salvate e rilette» richiede uguaglianza dei valori
e delle revisioni proposti, applicati e riletti. Conflitti, rifiuti o esiti
incerti conservano la bozza e l'ultimo contesto, marcato da rileggere, ma
ritirano l'anteprima: nessun retry automatico. La rilettura esplicita conserva
la bozza nella stessa sessione; cambi di contesto e blocco cancellano il
contesto di richiesta e impediscono risposte tardive o riletture successive
al ritiro. Una scrittura già inviata richiede riconciliazione sull'host.
Nessuna nuova route, writer clinica, installazione o inferenza viene aggiunta.

In Repertori, «ICD-11 WHO» consulta il servizio locale dell'host tramite le
route paired esistenti readiness/search v2 (ADR 0115, **no contract impact**).
La lettura passiva dello stato e la ricerca richiedono azioni esplicite.
«Configurato» resta distinto da una risposta osservata; titoli inglesi,
release, risultati parziali o vuoti, origine e tempi restano visibili.
La copia conserva anche URI canonico, binding e digest della provenienza;
non applica codici né scrive schede. Cambio query, repertorio, ambulatorio,
connessione o annullamento impediscono la consegna di risposte precedenti.
Il servizio locale resta opzionale: nessun avvio, retry, accesso diretto a
WHO o repertorio alternativo automatico. Il catalogo incorporato v3 e il
controllo puntuale dei codici restano nel percorso web; questa consultazione
non li qualifica come supportati dal contratto paired v2.

| Tastiera del client collegato | Azione |
| --- | --- |
| Tab / Maiusc+Tab | Percorre i controlli. |
| Ctrl+K / Cmd+K | Porta il focus alla ricerca. |
| Ctrl+Invio / Cmd+Invio | Apre la revisione. Una seconda invocazione non conferma implicitamente. |
| Invio o Spazio sul pulsante di conferma | Attiva la conferma esplicita. |
| Esc | Torna dalla revisione alla bozza o chiude una richiesta di scarto. |
| Ctrl+R / Cmd+R | Rilegge, rispettando l'eventuale bozza. |
| Ctrl+Maiusc+L / Cmd+Maiusc+L | Blocca immediatamente la sessione. |
| Invio nell'editor | Inserisce una riga. |
| Ctrl/Cmd+A, C, X, V, Z, Maiusc+Z | Selezione, appunti e annulla/ripeti per il testo ordinario. |

I campi segreti non consentono copia, taglio o cronologia e non espongono il
testo tramite il servizio input nativo. Gli appunti clinici vengono scritti
soltanto da un comando esplicito dell'operatore.

## Confini del codice

| Componente | Responsabilità |
| --- | --- |
| `client` | Macchina a stati indipendente da GPUI per bozza, revisione, richieste correlate e rilettura delle note. |
| `transport` | Autenticazione paired v3, chiavi temporanee, TLS, DTO, letture e scritture nominate sulle route esistenti. |
| `app/src/shell.rs` | Finestra collegata, navigazione, ambulatorio, moduli clinici e lavoro asincrono. |
| `app/src/shell/who_lookup.rs`, `transport/src/who.rs` | Consultazione WHO esplicita e parser del contratto paired v2, senza autorità o fonti alternative. |
| `app/src/text_input.rs` | Input locale Unicode, IME, selezione e modalità segreta. |
| `app/src/theme.rs` | Token del prodotto, caratteri, dimensioni e adattamenti di piattaforma. |
| `app/src/demo.rs`, `demo_app.rs` | Fixture e scenari del vecchio pilota, attivati soltanto da `--demo`. |
| `comparison` | Corpus pubblicato, client JavaScript, vettori dorati e confronto HTTP riproducibile. |
| `transport/src/bin/mediflow-runtime-probe.rs` | Eseguibile del confronto, limitato agli identificativi e alle scritture del corpus sintetico. |

Le ricevute di lettura del trasporto sono un controllo del client: non sono
credenziali e non sostituiscono il controllo di scopo nella transazione
server. Il blocco invalida tutte le copie della sessione e le risposte
ritardate. Una risposta positiva arrivata dopo il blocco non riapre la scheda.
Il limite di 262.144 unità UTF-16 delle note è un limite del client; non cambia
il contratto del writer. Non vengono introdotti SQLite Rust, un nuovo
servizio IPC o un writer parallelo.

## Compilazione e verifiche

`rust-toolchain.toml` seleziona Rust **1.98.1**. Il primo build richiede i
repository Git upstream fissati dal lockfile. I font e i token vengono
incorporati dal checkout.

| Sistema | Prerequisiti |
| --- | --- |
| Linux | C/C++, `pkg-config`, Fontconfig, GLib, Wayland, X11/XCB, xkbcommon; display e renderer compatibile per la finestra. Un font emoji del desktop è necessario per i simboli non contenuti nei font MediFlow. I dialoghi file richiedono una sessione D-Bus e xdg-desktop-portal con un backend del desktop. |
| macOS | Xcode, strumenti a riga di comando e compilatore Metal. |
| Windows | Rust MSVC, strumenti C++ e Windows SDK. |

Su Ubuntu 24.04:

```bash
sudo apt-get install clang pkg-config libfontconfig-dev libglib2.0-dev \
  libwayland-dev libx11-xcb-dev libxkbcommon-x11-dev fonts-noto-color-emoji \
  xdg-desktop-portal xdg-desktop-portal-gtk
```

Dal workspace Rust:

```bash
cargo fmt --all --check
cargo test --workspace --all-targets --locked
cargo clippy --workspace --all-targets --locked -- -Dwarnings
```

`cargo test --locked` senza `--workspace` esegue soltanto il membro
predefinito `client`. Il workflow CI è configurato per eseguire tutti i target su Linux, macOS e Windows;
`node scripts/check-test-selection.mjs` lega manifest, moduli e comandi alla
selezione effettiva. La compilazione non sostituisce la prova della finestra,
dei lettori di schermo o del pacchetto installato.

Dal checkout principale, con Node 24 e dipendenze installate dal lockfile:

```bash
cargo build --manifest-path experiments/gpui-patient-pilot/Cargo.toml \
  -p mediflow-runtime-client --bin mediflow-runtime-probe --locked --release
node experiments/gpui-patient-pilot/comparison/run.mjs \
  --rust-probe experiments/gpui-patient-pilot/target/release/mediflow-runtime-probe \
  --output-dir /tmp/mediflow-comparison-results --samples 5
```

La directory dei risultati deve essere vuota. L'orchestratore Linux crea
un proprio archivio temporaneo con dati inventati, avvia il servizio,
esercita entrambi i client e ritira i processi e i dati che ha creato.
Le credenziali temporanee restano separate dai report pubblici.
Il [protocollo](./comparison/protocol.md) descrive campi confrontati,
compatibilità della 0.9.0 e limiti delle misure. I tempi contro Next in
sviluppo sono diagnostici; non misurano avvio, rendering, RAM o latenza di
un prodotto installato.

## Piattaforme, licenze e ripristino

GPUI e `gpui_platform` usano lo stesso commit Zed
[`56934ec0560bce8929025497411de7f5322fb6ca`](https://github.com/zed-industries/zed/tree/56934ec0560bce8929025497411de7f5322fb6ca).
La sola versione `0.2.2` non identifica queste API. Le patch Git riproducono
le dipendenze fissate da upstream; quelle del workspace di una dipendenza
non vengono ereditate automaticamente.

GPUI e backend usati sono Apache-2.0. Il widget di testo conserva
attribuzione in sorgente e in [NOTICE](./NOTICE), con la licenza in
[LICENSE-APACHE-GPUI](./LICENSE-APACHE-GPUI). I tracciati delle icone mantengono
le licenze Lucide/Feather indicate in `app/src/icons.rs`. I font mantengono
le licenze OFL presenti accanto agli asset. I widget GPL di Zed `ui` non sono
parte del client. Questo inventario non è un SBOM del futuro installer.

Il backend iOS di questo pin non completa l'accessibilità e alcuni dialoghi
file; il factory non seleziona Android. iPhone/iPad, Web, Mini, installer e
writer Rust richiedono qualifiche distinte riportate nel verbale. Le
funzioni aperte nel client corrente sono identificate come tali e non sono
conteggiate come funzioni GPUI migrate.

Per ritirare il client candidato, chiudere la sessione e riaprire un client
compatibile con lo stesso servizio. Lo schema dati non cambia. Una modifica
con esito incerto va riletta prima di qualsiasi nuovo invio. Il downgrade
del servizio richiede di considerare gli abbinamenti Windows/Linux che i
parser precedenti non riconoscono.
