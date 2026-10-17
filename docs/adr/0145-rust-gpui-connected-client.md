# ADR 0145: client Rust/GPUI collegato al servizio MediFlow

Date: 2026-10-17

Status: Proposed — implementazione candidata sottoposta a review

Issue: [WUL-706](https://linear.app/wulfgardr/issue/WUL-706),
[WUL-714](https://linear.app/wulfgardr/issue/WUL-714).

## Contesto e direzione

Leonardo ha richiesto di proseguire la transizione Rust/GPUI conservando i
canoni e i vincoli della release, migliorando disposizione e funzionalità
su tutte le piattaforme, e di confrontare vecchia e nuova applicazione.
La finestra sintetica della PR 558 copriva soltanto elenco e note: non era
una sostituzione dell'interfaccia corrente.

Questo passo collega un client Rust all'autorità già esistente. È distinto
dalla futura migrazione del writer e del supervisore descritta in ADR 0137:
non assume conclusi WUL-582, WUL-573 o WUL-580 e non dichiara completata la
transizione dell'intero prodotto.

## Scelta del confine

La shell GPUI è un client nativo paired. Usa le route di autenticazione native
e `/api/v1/network/*`, con credenziale del dispositivo, sessione
dell'operatore, capability e ambulatorio ammesso. Il bearer locale non viene
usato per sostituire l'identità umana.

Il trasporto Rust e i materiali temporanei di sblocco sono in un crate
separato dalla UI. Le richieste bloccanti si eseguono fuori dal thread grafico;
le risposte devono appartenere alla sessione e alla selezione che le hanno
richieste. Un blocco o una nuova selezione impediscono a una risposta tardiva
di ripopolare una vista ritirata.

Rust non apre SQLite. I servizi Node esistenti continuano a verificare
sessione, ruolo, capability, scopo, versione e generazione dell'archivio.
La modifica, il controllo di versione e l'audit restano nella transazione
autorevole attuale. La migrazione della UI non aggiunge un secondo writer
né risolve per implicazione l'autorità Swift locale opzionale.

## Windows e Linux dichiarati

Il roster paired corrente accetta solo `macos`, `ios` e `ipados`.
Si aggiungono `windows` e `linux` come valori espliciti:

- parsing di richiesta e stato persistito, riepiloghi e OpenAPI;
- ammissione nativa e binding del solo issuer di sessione esistente;
- nessuna reinterpretazione di Windows/Linux come macOS;
- piattaforme sconosciute ancora rifiutate;
- nessuna capability concessa per il solo valore di piattaforma.

Il protocollo network passa da 1.11.0 a 1.12.0. I payload Apple precedenti
restano ammessi. Un host precedente può rifiutare i nuovi valori: il client
deve mostrare l'incompatibilità, senza mentire sulla piattaforma né scegliere
un altro canale di autorizzazione. L'estensione del roster non abilita di
per sé l'inferenza nativa: il relativo ambiente conserva i propri vincoli.

Il package dell'issuer viene aggiornato come unità coerente: sorgente,
versione, tarball locale, provenienza, dipendenza, lockfile e inventario
standalone. Due pack offline da copie pulite devono produrre byte uguali.

## Sblocco e trasporto

Il client riproduce il contratto v3 dell'ADR 0143, usando i vettori dorati
già condivisi tra Web e Swift: NFKC, PBKDF2-HMAC-SHA256, HKDF-SHA256,
verificatore e AES-GCM. Invia il verificatore, non la passphrase. La master
key e la sessione restano in memoria; nessun file di preferenze contiene
passphrase o chiave. Il formato dei campi cifrati resta `ENC:iv:data`.
Il client deve distinguere un dato non decifrabile da un campo vuoto.

Il collegamento del dispositivo e l'accesso dell'operatore sono due passaggi
distinti. Il primo conserva il codice paired in memoria protetta da
`Zeroizing`, ma non dichiara una connessione già verificata. «Blocca» ritira
sessione, chiave, dati e bozze dell'operatore; il solo abbinamento del
dispositivo rimane nella memoria del processo per il successivo accesso.
«Cambia collegamento» o la chiusura eliminano anche quel materiale. Non si
introduce un portachiavi persistente con comportamento diverso per sistema.
Il campo segreto non rende il testo disponibile a copia, taglio, cronologia,
albero accessibile o richiesta `text_for_range` del servizio input nativo.

La connessione richiede TLS verificato, origine esplicita e identità del
server verificabile. Nessun redirect deve ricevere le credenziali del
dispositivo. Un certificato della prova sintetica deve essere ammesso
esplicitamente, mai attraverso una disattivazione generale della verifica TLS.
Per l'istanza locale il client ammette anche HTTP su un indirizzo di loopback
letterale inserito esplicitamente. Non ammette HTTP su una rete, risoluzioni
DNS implicitamente considerate locali o una combinazione HTTP con pin TLS.
Con il pin viene verificato l'hash SHA-256 del certificato DER esatto e la
firma dell'handshake; senza pin resta la verifica HTTPS ordinaria. Il pin
costituisce l'identità esplicitamente fidata del server locale e richiede un
nuovo abbinamento quando quel certificato cambia.
Le richieste hanno tempo e risposta limitati. Credenziali e contenuti clinici
non entrano nei log o nei messaggi diagnostici.

Le richieste di scrittura sono nominate e usano la versione osservata.
Il client non ritenta automaticamente una scrittura: perdita di risposta,
timeout o errore dopo l'invio non provano un rollback. «Registrata» richiede
una rilettura coerente dall'autorità. Conflitto, rifiuto e stato indeterminato
mantengono significati diversi e permettono una scelta esplicita del medico.

## Contratto della presentazione

`DESIGN.md`, ADR 0144 Punto d'inchiostro, token effettivamente pubblicati e
mappa delle schermate restano i riferimenti. La nuova UI riprende le aree
Pazienti, Agenda, Diario, Repertori, Analisi, Scale e Impostazioni, l'identità
del paziente persistente, i segnali clinici e la soglia della scrittura.

Newsreader è destinato a titoli, nomi e prosa; il font di sistema a controlli
e valori; IBM Plex Mono ai codici. Un piano di lavoro, filetti fra le righe,
raggi coordinati e focus visibile sostituiscono cornici ridondanti. Le
geometrie dipendono dalla piattaforma e dalla larghezza utile. Una finestra
compatta ridispone i contenuti senza perdere selezione o bozza.

Ogni controllo deve avere un'azione reale. Quando una funzione non è ancora
portata, il client la dichiara e offre, se possibile, l'accesso alla funzione
corrente. Quel collegamento non vale come funzione migrata o test GPUI superato.
Le fixture dimostrative rimangono distinguibili dalla connessione al servizio.

Agenda e Diario generale usano le rispettive route aggregate esistenti, con
gli stessi scopi e capability; i cataloghi usano il servizio di repertori
dell'host. Nessuna ricerca aggiunge una connessione diretta a un provider.
I limiti delle risposte, le date e l'eventuale dato non leggibile devono
restare visibili. I testi clinici formattati mantengono il significato di
paragrafi, liste, enfasi e barrato nella lettura nativa; una modifica non
deve riscrivere implicitamente l'HTML precedente come testo impoverito.

## Piattaforme e criteri di sostituzione

Desktop significa build e prove separate per macOS, Windows e Linux.
Una build superata non attesta accessibilità, input complesso o distribuzione.
Il pin GPUI deve essere esplicito e le dipendenze mantenere le licenze proprie.

Il codice upstream al pin corrente contiene un backend iOS, ma non completa
l'integrazione dell'albero di accessibilità e alcuni dialoghi per file;
il factory della piattaforma non seleziona Android. Per iPhone/iPad servono
quindi lavoro e prove native ulteriori. Le superfici esistenti rimangono
utilizzabili fino al superamento dei percorsi equivalenti, con VoiceOver,
Dynamic Type, tastiera, file, lifecycle e custodia delle credenziali verificati.
Android non è dichiarato supportato da questa modifica.

## Confronto old/new

Le prove distinguono tre domande:

1. La nuova implementazione produce gli stessi esiti del client corrente
   contro lo stesso servizio e lo stesso archivio logico sintetico?
2. I client e gli host di release e candidato sono compatibili nelle
   combinazioni dichiarate?
3. Quali tempi e consumi cambiano per lo stesso lavoro?

Casi minimi: sblocco v3, elenco/scopo, lettura e decrittazione, modifica delle
note con versione, rilettura, conflitto, revoca, blocco e risposta tardiva.
I percorsi aggiunti estendono il corpus; non vengono conteggiati per semplice
presenza di un pulsante. Gli snapshot confrontano i campi estranei, l'audit e
la leggibilità del cifrato, non l'uguaglianza del nonce AES-GCM.

Si registrano revisioni, dipendenze, fixture, sistema e configurazione.
Avvio di sviluppo Web, avvio di una build Rust e tempo di rete sono misure
diverse: nessun rapporto di velocità del prodotto deriva dal loro confronto.
Schermate a dimensioni e temi dichiarati verificano disposizione, geometrie
e testo; non certificano da sole tecnologie assistive.

## Ripristino e lavori successivi

Il ripristino del client consiste nel chiudere la sessione candidata e
riaprire il client precedente sullo stesso servizio compatibile. Non cambia
lo schema, non copia database e non ripete operazioni incerte. Una credenziale
paired Windows/Linux può essere revocata dal servizio come quelle esistenti.
Il downgrade dell'host deve considerare che il vecchio parser non riconosce
queste nuove piattaforme.

Restano decisioni e prove separate per writer Rust, supervisore/IPC, binding
mobile, packaging installato e ritiro delle implementazioni precedenti.
La conclusione di questa modifica non coincide con il GO della migrazione
completa richiesto da WUL-736.
