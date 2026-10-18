# Confronto riproducibile JavaScript / Rust

Questo harness confronta due client sullo **stesso host e sulla stessa
generazione di archivio sintetico**. Il client JavaScript importa
`PatientEditSession` e `encryptData` / `decryptData` dal codice di prodotto
congelato; il piccolo trasporto HTTP del riferimento segue gli endpoint
paired. Il probe Rust usa il crate di trasporto di prodotto. Il risultato
riguarda le proiezioni e gli scenari elencati qui, non tutta l'interfaccia.

La release Web `v0.9.0` resta un riferimento distinto. Un runtime di quella
release conserva i suoi sorgenti, lockfile, owner di autenticazione e
protocollo di credenziale. Non si apre un archivio v3 con un client che
conosce solo il PIN e non si declassa l'involucro di una chiave per farlo
funzionare. Il percorso di compatibilità usa il login Web con il suo controllo
di sessione e la generazione restituita dalla release; il vecchio login nativo
non restituisce quella generazione. I risultati `release-web-pin-snapshot-1` non sono ammessi dal
comparatore dei protocolli `paired-v3-snapshot-*`.

## Esecuzione completa

Servono Linux, Node 24, le dipendenze già installate con `npm ci` e il probe
Rust compilato in modalità ottimizzata. Le dipendenze JavaScript del nuovo
harness sono soltanto moduli standard Node; Next e il bootstrap SQLite
riusano le dipendenze già fissate dal progetto.

```sh
cargo build --manifest-path experiments/gpui-patient-pilot/Cargo.toml --locked --release -p mediflow-runtime-client --bin mediflow-runtime-probe
node experiments/gpui-patient-pilot/comparison/run.mjs --rust-probe experiments/gpui-patient-pilot/target/release/mediflow-runtime-probe --output-dir /tmp/mediflow-comparison-report --samples 5
```

La cartella di output deve essere vuota. Il runner segue il recipe di
`scripts/network-home-base-write-smoke.sh`: copia i sorgenti necessari,
prepara una configurazione Next dedicata, usa webpack e costruisce un nuovo
SQLite dalle migrazioni canoniche. Riusa le dipendenze installate e conserva
una copia fisica dell'owner di autenticazione. Non installa dipendenze e non
compila il probe implicitamente.

Il processo crea un percorso privato `/tmp/mediflow-transition-*`, ascolta
solo su `127.0.0.1` a una porta assegnata dal sistema, genera nuove credenziali,
disabilita la copia legacy e i provider, e verifica la readiness con il bearer
amministrativo casuale. Il preparatore adotta la passphrase v3 attraverso il
normale endpoint e conferma un pairing Linux attraverso il normale flusso di
abbinamento. Il pairing nuovo richiede esplicitamente anche le capability di
Agenda, Diario globale, cataloghi e `network.replica.write-patient-lifecycle`
per la creazione anagrafica; il preparatore verifica che i grant emessi
corrispondano esattamente alla richiesta. I client ricevono file separati senza
il bearer amministrativo. Un pairing già emesso non viene ampliato in modo implicito.

Il runner esegue i golden, un warm-up escluso per ciascun client, almeno
cinque coppie di letture a ordine alternato, gli scenari note/diario, una
fase separata di scrittura delle risorse e la fase anagrafica finale. Ogni
campione apre e chiude una sessione ordinaria. In `finally` arresta il gruppo
di processi che ha creato e rimuove archivio, chiavi, credenziali e log privati.
Conserva solo ricevute e proiezioni senza testo clinico. Un errore produce una
ricevuta fallita e un exit code diverso da zero.

## Corpus e provenienza

`corpus.json` contiene cinque persone inventate: Elena per il quadro completo,
Bruno e Amina per scritture equivalenti, Carlo per gli stati vuoti e Nora
archiviata. Elena ha due voci di diario, inclusa una con HTML annidato, una
terapia, due misure con lo stesso codice e unità, un controllo e un documento
testuale. I campi protetti sono cifrati con la chiave dell'archivio, usando IV
casuali, prima dell'invio agli endpoint. Gli identificativi logici e i dati
in chiaro sono gli stessi nei due archivi di confronto; i ciphertext possono
essere diversi.

Il digest del corpus usa JSON compatto con chiavi degli oggetti ordinate
lessicograficamente e ordine degli array preservato. La fixture usa numeri
interi, evitando divergenze di rappresentazione numerica fra serializzatori.
Il probe compila lo stesso corpus e ne verifica il digest prima di operare.
Le ricevute registrano HEAD, hash del diff dei sorgenti host, manifest dei
file copiati, versione fisica dell'owner, versione Node e hash del binario Rust.
Questi valori distinguono anche un working tree non ancora committato.

`crypto-v3-vectors.json` contiene esclusivamente valori pubblici di test:
due costruzioni deterministiche, una ASCII e una con normalizzazione NFKC,
accento decomposto, carattere a larghezza piena ed emoji. La verifica Node e i
test del crate Rust condividono KEK, verifier, involucro v3 e campi ENC JSON.
Il verificatore Node controlla anche che manomissione e chiave di un altro
archivio non aprano i campi. Nessuna di queste credenziali o chiavi fisse viene
usata dai runtime preparati.

## Proiezione `paired-v3-snapshot-1`

Ogni report riporta origine, generazione **osservata nella sessione**, digest
del corpus e risultato. La generazione attesa nel config viene confrontata
con quella effettiva; non viene copiata nel report come se fosse un'osservazione.
Il comparatore rifiuta origini, generazioni, corpus o protocolli differenti.

| Risorsa | Campi confrontati |
| --- | --- |
| Ambulatori | Conteggio della lista ammessa |
| Pazienti | Conteggio attivi e archiviati; versione e hash note di Elena |
| Diario | ID, versione, hash titolo e contenuto |
| Terapie | ID, versione, hash motivazione |
| Osservazioni | ID, versione, valore wire come stringa, codice unità |
| Controlli | ID, versione, hash note |
| Documenti | ID, hash nome, dimensione dichiarata, hash della data URI decifrata ottenuta dalla lettura di dettaglio |

Gli array di risorse sono ordinati per ID ASCII. Gli hash sono SHA-256
esadecimali minuscoli dei byte UTF-8 esatti: niente trim, normalizzazione
Unicode del contenuto o trasformazione HTML. Le note opzionali `null` o
assenti sono rappresentate dalla stringa vuota in questa specifica proiezione;
la fixture principale contiene note presenti. Il digest complessivo della
snapshot usa lo stesso JSON canonico del corpus.

Il client JS verifica inoltre la corrispondenza delle note iniziali con il
corpus, l'assenza di payload nella lista documenti e il rifiuto della lettura
con pairing ma senza sessione. Questi controlli aggiuntivi sono riportati
separatamente quando non sono esposti nello stesso modo dal probe Rust.

## Proiezione `paired-v3-snapshot-2`

Il preparatore corrente seleziona `comparisonProtocolId: paired-v3-snapshot-2`.
I config precedenti senza quel campo mantengono il protocollo 1, per conservare
la prima ricevuta riproducibile. Due report sono confrontabili soltanto se
dichiarano lo stesso protocollo. La versione 2 aggiunge queste proiezioni a
tutte quelle della versione 1:

| Risorsa aggregata | Query e campi confrontati |
| --- | --- |
| Agenda | `/api/v1/network/checkups`, `limit=500`, dal 1 ottobre 2026 alle 00:00 UTC al 1 novembre alle 00:00 UTC; ID, paziente, versione, data ISO, stato, hash titolo e note |
| Diario globale | `/api/v1/network/entries`, `limit=100`, `type=note`, dal 1 ottobre 2026 alle 00:00 UTC al 16 ottobre alle 23:59:59.999 UTC; ID, paziente, versione, tipo, data ISO, setting (oppure `null`), hash titolo e contenuto |

Anche questi array escludono le righe con `deletedAt`, sono ordinati per ID e
usano gli stessi hash UTF-8. La finestra del Diario globale esclude esplicitamente
le due voci di scrittura del 17 ottobre: i client possono così confrontare
la stessa proiezione prima delle rispettive mutazioni, senza reset dell'archivio.
Il corpus immutato contiene un controllo e due voci di Elena; questo esercita
i due endpoint aggregati senza dichiarare coperta una matrice multipaziente.
I cataloghi sono abilitati per la UI, ma non fanno parte di questa snapshot.

## Scenari di scrittura

Bruno per JavaScript e Amina per Rust partono da note identiche e versione 1.
Il harness rifiuta fixture già consumate e non le resetta implicitamente.
Gli altri dati del corpus, incluso il paziente usato per il confronto UI,
restano disponibili per le letture.

1. JavaScript sottopone i default immutati alla vera `PatientEditSession` e
   verifica che non venga inviato alcun PUT.
2. Ciascun client conserva una seconda sessione autenticata che legge la
   stessa versione prima della scrittura.
3. Il client aggiorna esclusivamente note e versione. Una lettura separata
   deve restituire la versione 2 e la nota concordata esatta.
4. Un tentativo di ripetizione locale viene rifiutato. La macchina JS blocca
   un altro `submit` tramite il journal; Rust richiede una nuova ricevuta di
   lettura. Questi errori rimangono distinti nel report.
5. La seconda sessione prova una scrittura con la versione ormai superata e
   deve ricevere il vero HTTP 409. La rilettura conserva la modifica ammessa;
   il confronto non chiama 409 un rifiuto locale prima della rete.
6. Ogni client crea una nuova voce di diario con lo stesso titolo, contenuto,
   data e setting, poi la rilegge e ne verifica la versione 1. Gli ID generati
   separatamente non sono confrontati; versione e hash del contenuto sì.

Una conferma HTTP da sola non è una rilettura. Il report distingue il
risultato del componente JS, il rifiuto locale, il conflitto del server e il
contenuto nuovamente osservato nell'archivio.

## Scritture risorse `paired-v3-resource-writes-1`

`resource-writes.json` è una fixture pubblica distinta dal corpus di lettura.
Non cambia il significato della snapshot 2. La fase successiva imposta
`exerciseResourceWrites: true`, `exerciseWrites: false` e il digest canonico
`resourceWritesSha256`. Usa gli stessi pazienti dedicati e verifica che
abbiano versione 2 e le note esatte della fase precedente. Prima di scrivere,
le quattro collezioni dedicate devono risultare vuote nel nuovo archivio
preparato dal runner. Il riferimento JS controlla anche eventuali tombstone
nella risposta wire; le liste tipizzate Rust consegnano le righe attive.
Questa prova non è una qualifica di un archivio con cancellazioni pregresse.
Non è ammesso consumare di nuovo una fixture o
resettarla implicitamente.

| Risorsa | Operazioni osservate e controllo |
| --- | --- |
| Terapia | Creazione e rilettura versione 1; seconda sessione legge 1; aggiornamento dello schema testuale e della motivazione; rilettura versione 2; invio della versione superata con HTTP 409; rilettura del contenuto aggiornato invariato |
| Osservazione | Stesso percorso versionato, aggiornando il valore wire da `"128"` a `"132"` e le note, senza cambiare codice o unità |
| Controllo | Stesso percorso versionato, aggiornando note e stato da `pending` a `completed` |
| Allegato | Creazione di un testo inventato di 44 byte; elenco che omette il payload; lettura esplicita di dettaglio con nome, MIME, dimensione, data URI e byte decifrati esatti |

I tre record versionati hanno data del 2 novembre 2026. Il controllo cade
fuori dalla finestra della snapshot Agenda: le due fasi sequenziali continuano
a confrontare la stessa proiezione di lettura. Gli identificativi nuovi sono
emessi o accettati dal writer ordinario, verificati durante la rilettura e
omessi dal confronto fra pazienti diversi.

Per ciascun record versionato, la ricevuta riporta `createdVersion`,
`updatedVersion`, `createdProjectionSha256`, `updatedProjectionSha256`,
`readback`, `staleStatus` e `stalePreserved`. Le proiezioni contengono soltanto
le chiavi dei draft pubblici: valori effettivamente riletti e decifrati,
campi opzionali `null`, valore dell'osservazione come stringa. I digest devono
coincidere con quelli dei draft canonici. Per l'allegato `dataSha256` riguarda
la data URI intera e `bytesSha256` i byte UTF-8 del testo originale; non sono
intercambiabili.

Il comparatore delle risorse richiede ricevute positive complete da entrambi
i client e verifica separatamente che la snapshot resti confrontabile. Non
deduce un esito dalla sola risposta di creazione. Questa fase non esercita
rimozione logica, modifica dei documenti o cancellazione: il writer paired
degli allegati espone creazione e lettura, e i suoi record non hanno una
versione di modifica da inventare nel report.

Il contratto host per terapie, osservazioni e controlli ammette già la
rimozione logica tramite il loro **PUT versionato**, con `deletedAt` e
`deletionReason` cifrata quando fornita; passa agli stessi writer e audit
ordinari. L'assenza del verbo HTTP DELETE non significa che quel percorso
host non esista. Queste quattro prove non lo esercitano: versione del
tombstone, motivo, rifiuto stale, filtri dell'elenco e eventuale ripristino
richiedono scenari propri prima di dichiararli coperti dal client nativo.

```sh
node experiments/gpui-patient-pilot/comparison/compare.mjs --resources resources-javascript.json resources-rust.json
```

## Anagrafica `paired-v3-patient-profile-1`

`patient-profile-writes.json` è una fixture pubblica autonoma. La fase finale
imposta `exercisePatientProfileWrites: true`, il digest canonico
`patientProfileWritesSha256` e gli altri due flag di scrittura a `false`.
I tre flag sono mutuamente esclusivi. Il preparatore concede la capability
di creazione soltanto tramite un nuovo pairing esplicito; non modifica i
grant di un client già abbinato.

Ciascun client crea una nuova persona inventata con il proprio codice
fiscale sintetico. Il codice deve essere assente dalle liste attive e
archiviate del proprio ambulatorio. Il server assegna l'identità; non viene
fornito un ID nel draft. Una fixture già presente blocca la prova, senza
riutilizzo o reset implicito.

| Passo | Scrittura | Verifica tramite lettura separata |
| --- | --- | --- |
| Creazione | Nome, cognome, data di nascita, indirizzo, telefono, caregiver, stato ADI e CF specifico del client | ID dell'ACK, ambulatorio, CF e tutti i campi esatti a versione 1 |
| Modifica sparsa | Soltanto indirizzo e stato ADI | Versione 2, nuovi valori esatti e tutti i campi omessi invariati |
| Conflitto | Una seconda sessione che aveva letto versione 1 tenta un indirizzo differente | HTTP 409 effettivo, versione 2 e valori accettati ancora invariati |
| Svuotamento esplicito | `birthDate: null` e `phone: null` su versione 2 | Versione 3, i due campi nulli e tutti gli altri valori invariati |

Le chiavi assenti restano assenti dal payload. `null` attraversa il writer
come valore nullo; non diventa una stringa vuota cifrata e non si propaga
come valore predefinito agli altri campi. I valori testuali protetti presenti
nel draft sono cifrati con la chiave della sessione. Il confronto JavaScript
esercita il trasporto paired di riferimento e il WebCrypto di produzione;
questa fase non automatizza il form Web.

La ricevuta usa `protocolId: paired-v3-patient-profile-1` anche al livello
principale, `snapshot: null`, `snapshotCanonicalSha256: null`, tempo snapshot
nullo e zero richieste snapshot. Non esegue il comparatore delle snapshot:
dopo la prima creazione, le liste globali dei due client differiscono
legittimamente. Il comparatore dedicato verifica origine, generazione,
corpus, fixture e tutti gli esiti per client. Il rifiuto HTTP 401 senza
sessione è un controllo indipendente del trasporto JavaScript; il client
Rust non espone una richiesta HTTP grezza fuori dalla sessione e questa
fase non gli attribuisce quella misura.

Gli SHA256 delle tre proiezioni riguardano il JSON canonico dei sette campi
di `fixture.create`, esclusi ID, CF e versione. La proiezione attesa dopo
ogni patch deriva dalla fusione sparsa dei draft. Gli hash dei CF sono
verificati separatamente contro la fixture di ciascun client; gli hash degli
ID creati devono essere differenti. Le versioni devono essere 1, 2 e 3 e
gli esiti di rilettura, preservazione e conflitto devono essere positivi.

La prova riguarda persone nuove senza storia clinica. Non qualifica
eliminazione o ripristino del paziente, preservazione di ogni possibile
record storico, form nativo, accessibilità o prestazioni del prodotto.

```sh
node experiments/gpui-patient-pilot/comparison/compare.mjs --patient-profiles patient-profiles-javascript.json patient-profiles-rust.json
```

## Compatibilità di lettura della release

La release `v0.9.0` è fissata al commit
`9c7b3adf2eb18551b7c03b61e0fa6ee2303d31d0`. La prova conserva fisicamente il
suo owner di autenticazione e verifica le dipendenze differenti contro il suo
lockfile. La lettura Web PIN e quella candidata v3 usano due archivi sintetici
separati, con generazioni differenti e lo stesso corpus pubblico. Il confronto
di compatibilità verifica esattamente la proiezione di lettura 1 e mantiene
distinta questa evidenza dal confronto v3 sullo stesso host.

```sh
node experiments/gpui-patient-pilot/comparison/compare.mjs --release experiments/gpui-patient-pilot/evidence/connected/release-v0.9.0-web-readonly.json experiments/gpui-patient-pilot/evidence/connected/candidate-v1-readonly.json
```

Questo comando ripete gli assert sui risultati conservati; non avvia la release
e non produce una nuova osservazione dell'interfaccia. Le ricevute di provenienza
identificano i sorgenti e i binari misurati. Un nuovo confronto HTTP richiede
nuovi runtime preparati con i rispettivi protocolli di autenticazione.

Le [schermate CI storiche della release](../evidence/connected/release-v0.9.0-ui/README.md)
costituiscono un riferimento visivo distinto, con PNG originali e manifest
di provenienza. Le fixture e le date di quelle catture differiscono dal
corpus di questo harness; non sono una nuova esecuzione UI.

## Misure e limiti

Le ricevute contengono mediana, minimo e massimo di almeno cinque campioni
per login e snapshot. Il login comprende KDF v3 e HTTP; la snapshot comprende
il lavoro realmente svolto da ciascun client, inclusi i suoi controlli di
ammissione. Rust esegue discovery e preflight dell'identità/scope aggiuntivi:
il numero di richieste non è identico al piccolo trasporto di riferimento JS.
L'ordine alternato limita un effetto sistematico delle cache, senza trasformare
un host Next di sviluppo in un benchmark di produzione.

Questi tempi descrivono il costo osservato di quel percorso sul runtime
preparato. Non misurano startup del prodotto, RSS equivalente, rendering,
latenza di digitazione, consumo o velocità intrinseca dei linguaggi. Un confronto
di memoria richiede di includere gli stessi processi host e tutto il browser o
client; un confronto di startup richiede build e lavoro iniziale equivalenti.
Il runner non produce quei numeri.

La qualifica TLS con pin, gli errori di rete indeterminati, il cambio archivio,
la revoca pairing e le altre matrici negative hanno test dedicati nel trasporto
e nell'host. Non sono dedotti da una snapshot positiva. Questo harness non
esegue l'interfaccia, né qualifica IME, accessibilità, stampa, periferiche,
durabilità, distribuzione o tutte le funzioni cliniche. Le build native sulle
tre piattaforme e le prove UI restano evidenze separate.

## Lettura scoped Rust del profilo

Il probe Rust apre il profilo con `patient-profile.read.v1`; il suo DTO esclude
`ambulatoryId`. La selezione locale, il preflight dell'identità e l'header di
scope già validato dalla sessione ammettono la lettura. Il probe rifiuta inoltre
il riuso del contesto con un altro scope o paziente. Identità selezionata, CF,
versione, stato e tutti i sette campi di dominio restano verificati; nessun ID
interno viene ricostruito nella risposta per soddisfare il confronto.

Il riferimento JavaScript conserva il GET compatibile. Il confronto misura la
parità dei campi e gli stessi esiti di scrittura, senza attribuire equivalenza
alle chiamate o ai controlli di autorizzazione dei due percorsi. I tempi restano
osservazioni diagnostiche e non dimostrano un vantaggio prestazionale di Rust.
