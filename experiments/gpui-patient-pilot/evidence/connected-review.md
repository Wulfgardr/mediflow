# Review del client collegato e del roster desktop

Data: 17 ottobre 2026. Base del worktree verificato:
`d0cd18f1b4d1e96ac37712415ae9b42fd059d062`. Questa nota riguarda il delta
candidato non ancora committato, non attesta una release pubblicata.

## Esito verificato

La [ricevuta centrale Rust](./connected/rust-gates.json), riletta in questa
review, registra **89 test distinti superati**: 40 dell'applicazione, 20 del
client del pilota e 29 del trasporto collegato, senza errori o test ignorati.
Formattazione, Clippy con warning negati su tutti i target e build della
finestra passano su Linux con Rust 1.98.1 e lockfile candidato. Le ripetizioni
dopo i fix di focus non aumentano il numero dei test distinti. Sono risultati
locali, non una qualifica dei tre desktop o del prodotto installato.

Comandi, dalla radice del repository:

```sh
cargo fmt \
  --manifest-path experiments/gpui-patient-pilot/Cargo.toml \
  --all -- --check
cargo clippy --locked \
  --manifest-path experiments/gpui-patient-pilot/Cargo.toml \
  --workspace --all-targets -- -D warnings
cargo test --locked \
  --manifest-path experiments/gpui-patient-pilot/Cargo.toml \
  --workspace --all-targets
cargo build --locked \
  --manifest-path experiments/gpui-patient-pilot/Cargo.toml \
  -p mediflow-gpui-patient-pilot
```

Nel container sono stati impostati `CARGO_HOME=/tmp/mediflow-cargo` e
`RUSTUP_HOME=/tmp/mediflow-rustup`; i test di trasporto usano porte di
loopback effimere. La precedente esecuzione indipendente di 25 test del
trasporto e Clippy in release precedeva quattro aggiunte ora incluse nei
29 test centrali: omissione del payload nella lista allegati e tre casi
dell'anagrafica. Il controllo della lista
verifica la presenza della chiave `data` prima del decrypt e del DTO: chiave
assente ammessa, `null`, `ENC:` illeggibile e `ENC:` valido rifiutati.

Il digest canonico del manifest di 45 sorgenti e asset corrisponde a quello
della ricevuta Rust (`c79def382f85d96d2f75639be27bce848b6336880b3a2caa7a699205206ba7fc`).
Questa esecuzione precede la correzione successiva del wrapping del menu
al 400%: il relativo risultato visivo non viene anticipato in questa nota.

| Area | Prova effettiva |
| --- | --- |
| Sblocco v3 | Derivazione reale PBKDF2 a 2.000.000 iterazioni, HKDF e unwrap del vettore preesistente `native/contracts/crypto-golden-vectors.v3.json`; verificatore e master key attesi, chiave errata e versione errata rifiutate. |
| Cifratura per campo | Cifrato Web/Swift riprodotto byte per byte; vettori Node indipendenti decifrati per testo Unicode e array; `null`, stringa vuota e prefisso letterale `ENC:` distinti. |
| Policy della passphrase | NFKC, conteggio per caratteri Unicode, nessun taglio o trim della passphrase; credenziale troppo corta/lunga rifiutata. |
| Origine e diagnosi dell’errore | HTTPS e loopback HTTP letterale; origine con credenziali, percorso, query o fragment rifiutata; delimitatori dello scope codificati senza creare un secondo cookie; controlli rifiutati; 409, 401, 403 ed esito indeterminato distinti. |
| Identificativi opachi | Spazi, punti, Unicode, slash e percentuale letterale conservati in un singolo segmento URL; `.` e `..` completi rifiutati. Sette vettori di scope confrontati anche con `encodeURIComponent` in Node 24 e il parser `RequestCookies` della versione Next installata. |
| Legame della lettura | Prerequisito separato per sessione, ambulatorio, paziente, dominio e versione; un campo indecifrabile non diventa un vuoto modificabile. |
| Versioni | Interi JavaScript positivi e sicuri; zero, frazioni e valori oltre `Number.MAX_SAFE_INTEGER` rifiutati. MAX resta osservabile; il writer esistente decide l’esaurimento. |
| Risposte tardive | Una lettura iniziata prima o durante una scrittura non reinstalla il prerequisito consumato. Il blocco condiviso rimuove la master key. |
| HTTP in volo | Un PUT reale verso una fixture TCP sintetica blocca il secondo invio; un ACK dopo lock è indeterminato; un GET dopo lock non consegna dati; una connessione interrotta dopo l’invio non autorizza il replay senza rilettura. |
| Letture aggregate | Agenda e Diario generale usano i due endpoint globali esistenti. La fixture TCP verifica route, ordine conservato, decrypt Unicode, tombstone esclusi e prerequisiti legati al parent di ciascuna riga; un campo indecifrabile resta bloccato. |
| Filtri e repertori | I parametri URL conservano Unicode e delimitatori senza creare parametri, fragment o percorsi aggiuntivi. Date RFC3339 reali, ordine dell'intervallo, limiti e tipi non vuoti sono verificati. L'helper dei cataloghi accetta solo route GET e nomi di parametri elencati, con scope/sessione/lock correnti. I DTO conservano codici, provenienza e valori nulli. |

La suite TCP verifica il client di trasporto usando la forma delle risposte
identity e update. Il suo costruttore sintetico è interno a `#[cfg(test)]`:
non costituisce una modalità di autenticazione del prodotto. La suite non
misura l’audit SQLite, non prova la revoca del vero host e non sostituisce il
confronto HTTP sul corpus comune.

## Review del trasporto

La review ha corretto due problemi prima del congelamento: i retry di
protocollo predefiniti di reqwest sono ora disattivati esplicitamente;
una risposta di lettura tardiva non può più ricreare il prerequisito già
consumato da un invio. La sessione condivide fra tutti i clone sia il blocco
sia il gate del singolo invio. Non espone chiave, cookie o un issuer pubblico.

`can_write` usa soltanto la proiezione server delle capability con pairing,
stato `available` e chiave di scrittura ordinaria. È un’indicazione per la
UI: non deduce permessi dal ruolo e non sostituisce l’ammissione corrente del
server. Il client richiede il protocollo 1.12 e un ambulatorio effettivamente
elencato; verifica che identity restituisca proprio quello richiesto e lo
stesso operatore con canale nativo.

Il codice TLS confronta il digest SHA-256 del certificato DER esatto e
verifica la firma dell’handshake. Senza pin usa la verifica HTTPS ordinaria.
Redirect, proxy automatici e retry sono disabilitati. Il 17 ottobre alle
16:04 UTC il probe Rust ha verificato anche un proxy HTTPS locale verso il
candidato sintetico: pin corretto, login v3, snapshot completo e logout
superati con 23 richieste applicative; pin errato, errore di trasporto nel
login e **zero richieste HTTP aggiuntive**, con un handshake fallito.
La prova non ha richiesto scritture cliniche. Il primo tentativo nel sandbox
non aveva prodotto connessioni; la ricevuta riguarda l'esecuzione successiva
abilitata sulla fixture locale.

SHA-256 del certificato DER sintetico:
`33cd9d8440df702f691768ea4d118a927dd77995afa960c62aeee9df3602f25e`.
SHA-256 del probe misurato, compilato dopo il fix ID e prima delle liste
aggregate:
`2b5438daea465b18d222bcda9442c49e9eca0e82bc9f6d2fb13a242b12f76f07`.
La ricevuta sanitizzata `tls-rust-validation.json` conserva digest, contatori
e risultato; non contiene la configurazione privata o le credenziali.

La regressione degli ID ASCII è stata corretta prima della consegna: il
contratto dei checkup conserva ID opachi non vuoti, come prova anche
`lib/checkup-required-audit.test.ts`. Risorsa URL, scope cookie e ID del
pairing ora hanno validazioni distinte. Il fixture pubblico
`transport/tests/opaque-id-vectors.json` copre sette valori; Node 24.19.0 e
`next/dist/compiled/@edge-runtime/cookies` ne hanno verificato codifica e
decodifica esatte, sempre con i soli due cookie attesi.

## Review indipendente del delta host

Non sono emersi difetti bloccanti nel delta che estende il roster. I cinque
valori `macos`, `ios`, `ipados`, `windows`, `linux` corrispondono fra parsing
di richiesta e stato, tipi v1, OpenAPI, bootstrap nativo e owner impacchettato.
Il confronto dell’oggetto sessione esatto, `clientId`, piattaforma e hash del
token resta invariato. Il nuovo valore di piattaforma non concede capability.
L’ambiente dell’inferenza nativa conserva il proprio elenco Apple.

OpenAPI passa a 1.37.0 e il protocollo network a 1.12.0. Le eccezioni di
compatibilità descrivono l’estensione degli enum di risposta e il possibile
rifiuto dei client/host precedenti. La lettura dei test mostra login/logout
HTTPS per tutti i cinque valori e revoca del pairing per tutti i cinque nel
modello. Il caso di revoca HTTP alla fine del test v3 riguarda l’ultimo
pairing Linux; non è stato contato come cinque prove HTTP distinte. Questa
review non ha ripetuto la suite host già eseguita dal responsabile del delta.

Verifica indipendente di provenienza, eseguita senza estrarre né modificare
il pacchetto: **13 file** sorgente uguali ai file del tarball e della copia
fisica installata; hash e dimensioni corrispondenti al manifest di provenienza;
integrità SHA-512 uguale al lockfile; hash del predecessore 0.8.10 corrispondenti.
Versione verificata: `@mediflow/web-auth-lifecycle-owner` **0.8.11**.
SHA-256 del tarball:
`cf714b64126aa84eca9a6c98f699065ba0bf9721d85ceaa7bc8647d2f6745a19`.
La riproducibilità di due pack è dichiarata nella provenienza generata dal
responsabile; questa review ne ha verificato i byte finali, non ha rifatto i pack.

## Review delle ricevute finali e dei limiti pubblicati

Sono stati letti i 32 file JSON di
[`paired-v3-final-run`](./connected/paired-v3-final-run/receipt.json), concluso
alle 16:57:37 UTC. Il confronto è stato ricalcolato in Node sui report già
salvati, importando `compareReports`, `compareResourceWritesReports` e
`comparePatientProfileWritesReports` da `comparison/compare.mjs`: warm-up,
cinque campioni, note, risorse e anagrafica producono tutti gli stessi nove
oggetti di confronto archiviati. Questa verifica non ha avviato un runtime
né inviato richieste HTTP.

Sono stati inoltre ricontrollati il digest canonico del manifest, la sua
uguaglianza con la provenienza, i byte dei 1.931 file host elencati e le
quattro serie temporali. Non sono emerse differenze di sorgente; mediana,
minimo e massimo coincidono con i cinque campioni per ogni client e fase.
I report non contengono campi di password, passphrase, master key, token
di sessione o pairing. Identità generate e hash del codice fiscale sono
distinti per i due pazienti della prova anagrafica.

| Prova osservata nei report e ricalcolata | Risultato |
| --- | --- |
| Lettura sul medesimo host | Stessa origine, generazione e corpus; proiezioni dichiarate uguali, compresi Agenda e Diario globale. |
| Note e nuova voce | Note versione 1 → 2 e voce versione 1 rilette; secondo invio locale bloccato, seconda sessione obsoleta rifiutata con HTTP 409. |
| Terapia, osservazione e controllo | Creazione/rilettura v1, modifica/rilettura v2, stale 409 e successiva rilettura invariata; proiezioni uguali alle fixture. |
| Documento | 44 byte della fixture UTF-8 corrispondenti, elenco senza chiave payload, dettaglio e data URI verificati. Nessuna prova PUT o conflitto documento attribuita a questa route. |
| Anagrafica | Due pazienti distinti: create/read v1, patch sparsa/read v2, seconda sessione stale 409, clear esplicito di nascita/telefono e read v3. I sette campi condivisi e i codici fiscali specifici corrispondono alle fixture; gli omessi rimangono invariati. |

La fase anagrafica omette dichiaratamente lo snapshot globale, perché le
creazioni ne cambiano il conteggio. La prova HTTP 401 senza sessione è del
solo adapter JavaScript; non viene attribuita al probe Rust. I `null` sono
esercitati dai draft delle risorse e dall'anagrafica; la distinzione delle
stringhe vuote appartiene ai test di cifratura/DTO, senza attribuirla a una
proiezione HTTP che non la confronta.

La [ricevuta JavaScript](./connected/javascript-gates.json) registra inoltre
typecheck e lint, 115 test del selettore, inventario 1.031/1.060 con 29
esclusioni motivate, never-regress, diff OpenAPI effettivo, 15 self-test
OpenAPI e controllo delle affermazioni. I tentativi iniziali bloccati dal
sandbox non sono contati come verifiche riuscite. Questi gate e quelli Rust
rimangono distinti dalla CI del futuro commit integrato.

Il verbale del client e il README mantengono separati i limiti necessari:
nuovi eventi con scelta del solo giorno; conservazione dell'orario su edit
del giorno esistente; scorciatoie e workspace multipaziente ancora parziali;
mobile, installer e tecnologie assistive da qualificare; SQLite, audit e
commit ancora nel servizio Node. Il risultato sintetico non chiude il
writer/core Rust o i criteri di sostituzione dell'intero prodotto.

## Limiti da mantenere espliciti

- La verifica identity precede l’operazione. Non è un fence atomico con
  il commit: rimane una finestra TOCTOU se l’ambulatorio cambia fra i due
  passaggi. Il writer e le sue verifiche correnti restano quelli Node.
- `lock()` invalida subito il client e scarta la master key; cookie e
  credenziale del dispositivo restano soltanto per il successivo `logout()`
  remoto. L’UI deve avviarlo in background. Una richiesta già inviata può
  avere committato; il blocco non è un rollback. Le copie transitorie dei
  buffer HTTP e dei dati visibili non costituiscono una prova di azzeramento
  universale della RAM.
- Le liste aggregate mantengono i limiti del servizio: Agenda 200 righe e
  Diario generale 50, in ordine rispettivamente crescente e decrescente di
  data. I tombstone esclusi dal client possono ridurre le righe visibili
  dopo il limite; non sono presentate come un archivio completo senza limiti.
- Le risposte JSON hanno un limite di 8 MiB, quelle dei documenti di
  24 MiB; l’upload Rust accetta al massimo 10 MiB di byte originali. I limiti
  non attestano un budget completo per ogni copia precedente alla cifratura
  o per il contenuto già presente nella UI.
- Le prove impiegano esclusivamente valori deterministici pubblici e
  documenti sintetici. Nessun PHI, archivio reale, credenziale runtime o
  plaintext clinico viene incluso in questa nota o nei log del client.
- Il client non apre SQLite, non introduce un secondo writer e non consegna
  la migrazione del supervisore, dell’inferenza, del mobile o dei contratti
  di receipt/idempotenza. WUL-582, WUL-573, WUL-580 e WUL-736 non sono chiusi
  per effetto di questi risultati.

## Review della UI collegata

La lettura indipendente di `shell.rs`, `text_input.rs`, `components.rs` e
`navigation.rs` ha verificato la correlazione per epoch al cambio di paziente,
ambulatorio, invio e blocco. Il blocco nasconde i buffer logici e avvia il logout;
un login riuscito dopo l'abbandono della finestra viene ritirato. I controlli
di sola lettura escludono la modifica delle schede archiviate. Il consenso
al singolo invio è distinto dalla revisione; una creazione riconosciuta ma
non riletta resta incerta e non viene resa nuovamente inviabile. Non sono
stati identificati falsi esiti «registrato» in questi percorsi.

Sono stati segnalati due problemi concreti: il servizio di input poteva
richiedere il testo dei campi riservati mediante `text_for_range`, e
l'estrazione di HTML rimuoveva il significato del testo barrato. La successiva
lettura del fix conferma che il servizio di input restituisce `None` per i
segreti e azzera anche il range precedente; il test dedicato copre offset
UTF-16, emoji e un controllo non segreto. Il nuovo modulo `clinical_text.rs`
conserva run stilistici e struttura dei blocchi per render e copia, produce
highlight disgiunti su confini UTF-8 e conserva il testo originale con
un'etichetta quando la formattazione non è interpretabile. L'indentazione
visuale delle liste non supera 36 px, indipendentemente dallo zoom; la
gerarchia completa rimane nella rappresentazione per copia e accessibilità.
I cinque test del renderer sono compresi nei 40 test app della ricevuta
centrale. La loro riuscita non viene usata come prova autonoma della resa
grafica o delle tecnologie assistive.

La review di `documents.rs` e dei flussi in `shell.rs` ha verificato la scelta
esplicita dei percorsi, il limite raw di 10 MiB, la decodifica base64 canonica
con MIME e dimensione corrispondenti e la rilettura byte per byte dopo la
creazione. Il salvataggio locale usa `create_new` e permessi 0600 su Unix;
non apre il documento né usa URL o percorsi contenuti nel record. È stato
segnalato un ulteriore problema da correggere: il future detached del picker
di destinazione tratteneva i byte già decifrati anche dopo lock o cambio
paziente fino alla chiusura del dialogo. La successiva review del fix in
`download_document` conferma che il picker ora precede la lettura del
contenuto: il future conserva soltanto ID ed epoch; dopo la scelta vengono
ricontrollati epoch, sessione e lock, poi lettura, decode e scrittura avvengono
in background. Non restano byte del documento decifrati in attesa del picker.
Il lock non promette di annullare una scrittura locale già iniziata e
autorizzata.

### Editor delle risorse e anagrafica

La review indipendente di `editing.rs`, `patient_forms.rs` e dei relativi
percorsi in `shell.rs` ha confrontato gli editor con i normalizzatori e i
moduli Web del prodotto. Sono stati individuati e corretti tre difetti:

- L'editor delle osservazioni richiedeva un numero finito anche per valori
  e limiti già registrati come stringhe qualificate. Il writer ordinario
  ammette valori non vuoti come `<5` e limiti testuali. Il modulo conserva
  ora tali stringhe e la punteggiatura, compresa la virgola; un edit delle
  sole note non normalizza i campi intoccati. Il trim sui campi modificati
  che lo richiedono segue `String.trim()` di JavaScript.
- Cambiare il giorno di una voce azzerava l'orario precedente. Il modulo
  mantiene ora orario, frazioni e offset esplicito originali, anche per la
  fine di una terapia. La rilettura confronta l'istante esatto dopo la
  serializzazione UTC del servizio: una risposta a mezzanotte non conferma
  un invio che ha mantenuto un altro orario. Non viene dedotto un fuso
  geografico. La nascita e una nuova data opzionale restano campi distinti.
- Un nome di farmaco modificabile liberamente poteva contraddire AIC,
  ATC o principio attivo conservati dal record. Quando tali dati sono
  presenti, il nome è mostrato come campo conservato e il costruttore della
  bozza ne rifiuta anche la sostituzione diretta. Dose, stato, date e motivo
  rimangono modificabili. La sostituzione del farmaco codificato usa ancora
  la gestione corrente, che aggiorna il gruppo di dati insieme.

Il modulo `editing.rs` contiene cinque test: il caso di date preesistente è
stato esteso con offset, rilettura UTC e orario errato; due nuove regressioni
coprono valori qualificati e identità della terapia. Sono stati formattati
con Rustfmt 1.98.1 e sono compresi nella ricevuta centrale di 40 test app.
Questa review non ha lanciato un Cargo concorrente alla build centralizzata.

Nel percorso anagrafico, la review statica conferma la distinzione fra
campo omesso, cancellazione `null` e valore impostato; i campi indecifrabili
rimangono esclusi dalla patch. La versione e il paziente provengono dalla
lettura che ha aperto il modulo. Un ACK richiede la rilettura della versione
attesa e dei campi forniti; errore, conflitto o mancata conferma congelano la
bozza. I callback verificano l'epoch della finestra e il blocco invalida la
sessione condivisa. Non sono emersi ulteriori difetti bloccanti in questi
percorsi alla lettura del candidato; questa conclusione non sostituisce il
confronto con l'host né attesta l'azzeramento di ogni copia transitoria in RAM.

## Carattere nativo e significato dell'enfasi

L'ispezione della schermata sintetica ha mostrato che grassetto e corsivo
non erano distinguibili pur essendo presenti negli highlight. Il backend
Linux del pin GPUI `56934ec0560bce8929025497411de7f5322fb6ca` usa
`CosmicTextSystem`: seleziona fra le face del database e carica la fonte
variabile con peso normale. La font incorporata conteneva una sola face
Regular 400, assi `wght` e `opsz`, nessun asse italic. Il test upstream
`font_properties_describe_the_selected_face` descrive il fallback a Regular
quando mancano le face richieste. Non bastava quindi controllare i run del
parser per attestare la resa dell'enfasi.

Sono state generate quattro face statiche reali Newsreader, Regular/Bold e
Italic/BoldItalic, con pesi 400/700 e dimensione ottica 18. L'upright del
commit ufficiale Google Fonts `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`
corrisponde byte per byte all'asset Web già incluso; il file Italic dello
stesso commit ha la medesima versione 1.003. Il corsivo proviene dal disegno
Italic originale, senza inclinazione sintetica. Il Web rimane invariato.

`app/fonts/Newsreader-Native.manifest.json` registra URL fissati, SHA-256,
versioni, licenza OFL-1.1, dipendenza FontTools 4.61.1, assi e output. Lo
script `scripts/build-newsreader-native.py` in questo esperimento verifica
gli hash degli input e mantiene i timestamp originali. Una seconda
esecuzione `--verify`, con la stessa fonte italic scaricata dall'URL fissato,
ha rigenerato font e manifest identici byte per byte. Le quattro face hanno
658 glifi ciascuna, nessuna tabella `fvar`, famiglia comune `Newsreader` e
contorni del glifo di controllo differenti. La successiva schermata
[`patient-quadro-light-desktop.png`](./connected/gpui-ui/patient-quadro-light-desktop.png),
osservata in questa review, mostra grassetto distinguibile in «sintetico» e
corsivo in «città e caffè», con liste e separazione dei blocchi conservate
nel tema Giorno. Questa prova riguarda il desktop Linux e il contenuto
mostrato; non qualifica da sola ogni glifo, stile combinato o piattaforma.
Il wrapping del menu al 400% è una verifica successiva e separata.

## Responsabilità portata: anagrafica paziente

La lettura di `lib/network-patient-lifecycle.ts`,
`lib/network-patient-write.ts`, `lib/patient-write-normalization.ts`,
`lib/patient-update-operation.ts`, `lib/network-patient-commit-authority.ts`
e OpenAPI conferma un percorso già esistente per creazione e modifica. Il
client Rust può chiamarlo senza introdurre un writer o una route aggiuntiva:

- `POST /api/v1/network/patients`, con capability
  `network.replica.write-patient-lifecycle`, crea versione 1, associa lo
  scope corrente e registra l'audit nella medesima transazione IMMEDIATE.
  Nome, cognome e codice fiscale sono obbligatori; l'ID può essere omesso
  per farlo generare al servizio. I campi sensibili opzionali sono `ENC:`
  oppure `null`, mentre versione, date del server e campi AI sono esclusi.
- `PUT /api/v1/network/patients/{id}`, con capability
  `network.replica.write-patient-profile`, richiede la versione corrente;
  il writer esistente applica CAS, incremento di una versione, membership
  eventualmente richiesta e audit atomici. Il guard ricontrolla pairing,
  sessione, grant, generazione e scope dentro la transazione, senza await
  fino al commit. Questa proprietà riguarda il writer paziente esaminato,
  non viene estesa per deduzione agli altri domini.

Il punto da preservare nell'API Rust è una patch sparsa con tre stati per
ogni campo nullable: non toccato, cancellato esplicitamente, valore nuovo.
Un DTO completo con `isArchived: false` cancellerebbe `archiveReason` e
`archiveNote` per la semantica del normalizzatore; convertire un campo
indecifrabile in `null` cancellerebbe il dato. Le sole proprietà modificate
devono essere cifrate e inviate, usando il prerequisito di lettura consumato
e una rilettura esplicita dei campi e della versione dopo l'ACK. I campi
ordinari di anagrafica non richiedono inferenza AI o cambiamenti di
membership. Il writer può aggiornare pazienti archiviati purché non
tombstoned: `activePatients()` verifica `deletedAt`, quindi la sola lettura
degli archiviati resta una scelta esplicita della UI.

Sono ora implementati `PatientCreateDraft`, `PatientProfilePatch` e
`NullableStringPatch::{Unchanged, Clear, Set}`, con i metodi
`create_patient` e `update_patient_profile`. Il sottoinsieme contiene nome,
cognome, codice fiscale, nascita, indirizzo, telefono, caregiver e stato ADI;
esclude note, archiviazione, cancellazione, AI e cambiamenti di ambulatorio.
I DTO non hanno `Debug`. Il create richiede un ACK con versione 1; la patch
richiede e consuma la receipt di lettura, bloccando soltanto i campi sensibili
effettivamente toccati quando risultano non decifrabili. Un ACK rimane
distinto dalla rilettura.

I tre test aggiunti coprono assente/null/valore e proprietà escluse; legame
di sessione, scope, paziente, versione e campo bloccato; corpo HTTP sparso e
cifrato; doppio invio interdominio bloccato; ACK o risposta persa con
prerequisito consumato; create con ACK versione 1 e rifiuto di ACK privi
di versione o con versione differente. Sono compresi nei 29 test del
trasporto registrati nella ricevuta centrale; le fixture TCP non applicano
il writer SQLite. Il confronto autonomo sul runtime comune ha poi verificato
create/read v1, patch/read v2, conservazione dei campi, seconda sessione
stale 409 e clear/read v3. La review dei report e il ricalcolo del comparatore
sono descritti sopra, senza contarli come una seconda esecuzione HTTP.

## Verifica visiva successiva: Menu al 400%

La QA centrale del 17 ottobre 2026 ha completato la prova del Menu in tema
Grafite, viewport **390 × 844** e testo al **400%**. Questa review ha aperto
e osservato separatamente entrambi i fotogrammi salvati, senza eseguire una
seconda sessione GUI:

| Immagine | Esito visivo osservato |
| --- | --- |
| [`menu-400-settings-focus.png`](./connected/gpui-ui/menu-400-settings-focus.png) | Dopo Tab 9 nella sequenza centrale, «Impostazioni» è interamente presente su due righe e il bordo di focus è visibile entro il viewport. L'icona rimane distinguibile. |
| [`menu-400-lock-focus.png`](./connected/gpui-ui/menu-400-lock-focus.png) | Dopo Tab 10 nella sequenza centrale, «Blocca e nascondi i dati» è interamente presente su tre righe; il bordo di focus e i due lati del pulsante sono visibili. |

L'esito del wrapping e del focus nei due stati mostrati è **PASS**. Il
binario osservato ha SHA-256
`f03e660f94b0ba329e30b305df18c997b665d6f85786f0dabfc880b9d36e731e`.
Il digest canonico del manifest di 45 sorgenti e asset è
`afc29b65d89a6743e571748ec797200a95decc06bef8da7963f09a117ac64014`,
ricalcolato in questa review. La ricevuta Rust delle 17:38:16 UTC registra
lo stesso binario e manifest e la ripetizione di 40 test app, Clippy,
formattazione e build dopo il fix del wrapping. Questo aggiornamento
succede alla verifica con digest `c79def…` riportata all'inizio della nota;
il totale resta 89 test distinti.

Sono state osservate anche le immagini rigenerate del quadro paziente:
[`Giorno desktop`](./connected/gpui-ui/patient-quadro-light-desktop.png) e
[`Grafite desktop`](./connected/gpui-ui/patient-quadro-dark-desktop.png),
entrambe 1440 × 960, e
[`Giorno compatto`](./connected/gpui-ui/patient-quadro-light-compact.png),
390 × 844. Nei fotogrammi desktop sono leggibili il quadro, le voci del
diario e le liste annidate; nel tema Giorno sono distinguibili il grassetto
di «sintetico» e il corsivo di «città e caffè». La vista compatta conserva
la disposizione a colonna, le azioni mostrate e la navigazione inferiore.
Queste osservazioni riguardano i contenuti e gli stati catturati: la prova
del Menu non equivale a una qualifica di ogni area o percorso di focus al
400%, né si estende a modifiche successive al binario indicato.

## Chiusura della review visiva sul manifest finale

Il [manifest UI finale](./connected/gpui-ui/manifest.json) distingue
**21 PNG, tre build e nove casi osservati**. Questa review ha verificato
SHA-256 dei file, dimensioni, inventario completo e riferimenti delle
immagini alle build. I digest canonici dei tre manifest di sorgenti sono
stati ricalcolati: `presentation` (`afc29b65…`, app `f03e660f…`), `focus`
(`eb5dcefc…`, app `99ef1ca3…`) e `clinical-layout` (`60dc6c4f…`, app
`900120a6…`) corrispondono ai valori dichiarati. Tutti i 45 file del
manifest più recente corrispondono inoltre alle sorgenti e agli asset
presenti nel worktree.

Sono state aperte le quattro nuove immagini a 390 × 844, Grafite e 400%:

- [Agenda](./connected/gpui-ui/agenda-search-400-focus.png) e
  [Diario generale](./connected/gpui-ui/diary-search-400-focus.png): il
  campo di ricerca ha focus visibile; nome e cognome, data e ora locali
  sono completi e vanno a capo dentro il viewport.
- [Input dei Repertori](./connected/gpui-ui/references-input-400-focus.png)
  e [comando Cerca](./connected/gpui-ui/references-search-400-focus.png):
  entrambi occupano la larghezza disponibile, con testo intero e bordo di
  focus distinguibile; nel pulsante primario il bordo è bianco. Il catalogo
  sintetico è vuoto: queste immagini qualificano geometria e focus, senza
  dichiarare un risultato positivo di ricerca.

L'esito visivo per questi stati è **PASS** sul binario
`900120a6f94aab983294014ece77d90487b0651f081302a33e370d658b1307f4`,
con manifest di sorgenti
`60dc6c4f4d95cfc3d6ec8804991c54138fe9fe77ff3a834cb393b0a2613dc71b`.
La ricevuta Rust finale corrisponde a questi due digest e registra la
ripetizione dei **40 test app**, formattazione, Clippy e build sull'ultima
revisione. I 20 test client e i 29 test trasporto sono rimasti invariati:
il totale è ancora **89 test distinti**, senza sommare le ripetizioni.
Le osservazioni delle build precedenti mantengono la propria attribuzione
nel manifest; non vengono riassegnate all'ultimo binario. Questa chiusura
ha riletto prove esistenti, senza eseguire altri test o sessioni GUI.

## Chiusura dei file per la pubblicazione

Il diff finale ha segnalato una riga vuota in fondo al manifest Cargo del
trasporto. La rimozione non cambia le dipendenze o il codice: `cargo build
--locked` passa e il binario conserva SHA-256 `900120a6f94aab983294014ece77d90487b0651f081302a33e370d658b1307f4`.
Il manifest dei 45 sorgenti ora ha digest canonico `5d455e24077883b92d599a3f233b89bd9c9aa0d8a9fc65d6c1a196dea694c955`;
la ricevuta conserva il digest precedente e la natura della pulizia.
Il guard delle affermazioni e l’inventario dei test sono stati ripetuti dopo
il congelamento: 756 file, zero affermazioni ad alto rischio; 1.060 file di
test censiti, 1.031 selezionati e 29 esclusioni motivate.
