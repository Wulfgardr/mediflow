# ADR 0143: credenziale forte di sblocco, verificatore senza segreto e kit di recupero

Date: 2026-10-10

Status: Accepted, 10 ottobre 2026, con le opzioni raccomandate. Emendato l'11 ottobre 2026: [passo 2](#emendamento-del-passo-2-11-ottobre-2026), [decisioni e review indipendente](#decisioni-e-review-indipendente-11-ottobre-2026).

## Problema e contesto

C07 / [WUL-722](https://linear.app/wulfgardr/issue/WUL-722). Leonardo ha deciso
il 9 ottobre 2026 la direzione: passphrase forte come base, chiave solo in
memoria, PIN breve soltanto dove il sistema operativo fornisce la protezione
che manca, backup di recupero cifrato a parte. Lunghezza minima e parametri di
derivazione spettano a chi esegue, misurati sull'hardware supportato. Questo
documento li propone; [SECURITY.md](../../SECURITY.md) chiede un ADR prima di
cambiare il modello delle chiavi.

Letto sul codice di `main` `bcb7af46a`:

- il segreto è un PIN di quattro-otto caratteri (`SECURITY_CONFIG` in
  `lib/security/security.ts`); il cambio PIN e le conferme rifiutano di più,
  mentre il primo avvio controlla solo il minimo;
- dal PIN e da un salt si deriva con PBKDF2-HMAC-SHA256 la chiave che avvolge
  la master key: 600.000 iterazioni per gli involucri nuovi, 100.000 per i
  vecchi; `app/api/auth/rewrap-master-key` porta già un involucro da una
  versione all'altra senza ricifrare i dati;
- a ogni accesso il browser invia il PIN al server locale, che lo confronta con
  un hash bcrypt e solo allora restituisce involucro e salt. bcrypt legge al
  massimo 72 byte: una passphrase più lunga verrebbe troncata in silenzio;
- la master key sbloccata viene esportata in JWK nel `sessionStorage`
  (`lib/security/client-security-session.ts`);
- il backup non contiene `users`: dopo la perdita del computer nessun
  involucro è recuperabile e i campi cifrati del backup restano illeggibili.

### Che cosa regge oggi

Misura su Apple M4 Max, Node 24.21, WebCrypto, un core, tre corse per riga:

| Iterazioni PBKDF2-HMAC-SHA256 | Tempo per tentativo |
| --- | --- |
| 100.000 | 8 ms |
| 600.000 | 44 ms |
| 1.000.000 | 73 ms |
| 2.000.000 | 147 ms |

Chi possiede una copia di `medical.db` prova i segreti fuori dal computer, dove
il blocco dopo i tentativi falliti non agisce. A 2.000.000 di iterazioni un
solo core come quello misurato fa circa 6,8 tentativi al secondo:

| Segreto | Combinazioni | Un core, spazio intero |
| --- | --- | --- |
| PIN di 4 cifre | 10⁴ | 25 minuti |
| PIN di 8 cifre | 10⁸ | 170 giorni |
| 5 parole a caso da un elenco di 7.776 | 2,8 × 10¹⁹ | 1,3 × 10¹¹ anni |
| 15 lettere minuscole a caso | 1,7 × 10²¹ | 8 × 10¹² anni |

L'attaccante moltiplica i core e usa schede grafiche; i tempi si dividono di
conseguenza, e un PIN scelto da una persona è molto meno di uno spazio intero.
Aumentare le iterazioni sposta ogni riga dello stesso fattore: non salva un PIN.
Lo salva la lunghezza del segreto.

## Decisione proposta

### 1. Una sola policy della passphrase

- Minimo **15 caratteri**, massimo 128; nessuna regola di composizione;
  normalizzazione Unicode NFKC prima della derivazione.
- La passphrase è accettata per intero: nessun componente la tronca.
- La stessa costante vale per primo avvio, sblocco, cambio e recupero; il
  server non applica una regola propria perché non riceve più il segreto.

### 2. Derivazione, involucro versione 3

- Resta PBKDF2-HMAC-SHA256: è nativo in WebCrypto e nelle librerie Apple che i
  client usano già, non aggiunge dipendenze e tiene allineati browser e client
  nativi.
- **2.000.000 di iterazioni** come proposta, da confermare misurando sui profili
  Windows e Omarchy/Arch ARM: il vincolo è restare sotto un secondo sul profilo
  più lento.
- Dal risultato si ricavano con HKDF-SHA256 due chiavi indipendenti: la chiave
  che avvolge la master key e un **verificatore di accesso**.

### 3. Il server non riceve più il segreto

Il browser invia solo il verificatore. Il server ne conserva SHA-256 e lo
confronta a tempo costante; blocco e contatori restano come oggi. Con il
verificatore il server non può ricavare la chiave dell'involucro. bcrypt esce
dal percorso di sblocco, e con lui il limite dei 72 byte.

### 4. Chiave solo in memoria

La copia in `sessionStorage` viene tolta e la master key è importata come non
estraibile. Conseguenza da dire al medico: un ricaricamento della pagina chiede
di nuovo la passphrase, come un riavvio.

La copia esiste perché ogni caricamento completo di pagina perde la memoria del
browser: senza, la navigazione interna deve restare sul routing lato client e
la suite E2E, che oggi apre le pagine con caricamenti completi, va adattata a
sbloccare di nuovo o a navigare senza ricaricare. È il costo principale di
questo punto e va misurato prima di fissarne la consegna.

### 5. Kit di recupero

Alla creazione e alla migrazione il browser genera una **chiave di recupero**
casuale di 160 bit, mostrata una volta in gruppi leggibili, e con essa avvolge
la master key una seconda volta. Il **kit di recupero** è un file che contiene
solo quell'involucro e il suo salt: si conserva con i backup, la chiave di
recupero su carta, separata. Su un computer nuovo, backup, kit e chiave di
recupero bastano a rileggere i campi cifrati; senza kit non si recuperano. È
il materiale che manca al criterio 1 di
[WUL-730](https://linear.app/wulfgardr/issue/WUL-730).

### 6. Migrazione dai PIN

Al primo sblocco riuscito con il PIN dopo l'aggiornamento, l'applicazione
chiede la passphrase e mostra la chiave di recupero. Una sola transazione
scrive involucro versione 3, verificatore e involucro di recupero, e toglie
involucro del PIN e hash bcrypt. Interrotta prima del commit, resta il PIN;
dopo, vale la passphrase: non esiste uno stato con un segreto nuovo e un
archivio inaccessibile. Finché non migra, l'installazione è in un profilo
transitorio dichiarato nell'interfaccia. Gli archivi della 0.8.6 si aprono con
il loro PIN ed entrano nello stesso percorso.

### 7. Sblocco rapido

Nel profilo da sorgente, localhost e headless il browser non raggiunge un
archivio protetto dal sistema operativo: nella 0.9.0 vale solo la passphrase.
Portachiavi, Windows Hello e WebAuthn con estensione PRF si valutano con i
client della 0.9.6, una revisione per sistema.

## Alternative considerate

- **Argon2id.** Resiste meglio alle schede grafiche perché costa memoria. Nel
  browser richiede una libreria WebAssembly e, nei client nativi, una seconda
  implementazione da tenere allineata. Rinviato: si riapre se la misura sui
  profili lenti non consente un costo PBKDF2 adeguato.
- **Solo più iterazioni.** Non risolve un segreto di quattro cifre.
- **Conservare bcrypt sul verificatore.** Non aggiunge resistenza: il costo per
  tentativo è già quello della derivazione.

## Conseguenze

- Una colonna in più per l'involucro di recupero e una per il verificatore:
  migrazione di schema versionata, da provare con interruzioni iniettate.
- Cambio della passphrase, logout e recupero ritirano sessioni e grant; lo
  storico resta leggibile perché la master key non cambia.
- I client nativi devono seguire la stessa tabella di versioni.

## Decisioni

Il 10 ottobre 2026 Leonardo, davanti alle quattro scelte che questo documento
lasciava aperte, ha dato mandato di procedere nel modo migliore. Chi esegue
adotta le opzioni raccomandate; cambiarne una riapre il punto corrispondente.

| Decisione | Scelta | Perché |
| --- | --- | --- |
| Copie precedenti del database | Riavvolgere soltanto. La migrazione elimina le copie che il prodotto possiede (`.old-*`, copie di riparazione) e dice al medico di eliminare le altre: Time Machine e copie a mano conservano l'involucro del PIN della stessa master key. | Ruotare la master key vuol dire ricifrare ogni campo clinico: una migrazione dei dati, con il rischio che il criterio 4 di WUL-721 chiede di evitare. I backup non sono toccati: non contengono l'involucro. |
| Conferme di revisione e di ruolo | Un PIN di conferma separato, verificato dal server con blocco, che non deriva né avvolge alcuna chiave. | La conferma protegge dall'uso a computer sbloccato, non dal furto del file; quindici caratteri a ogni conferma spingerebbero a una passphrase debole. |
| Lunghezza minima | 15 caratteri. | È il minimo che regge il confronto della tabella sopra senza regole di composizione. |
| Formato del kit | File dedicato, distinto dal backup. | Chi copia un backup non deve trovare accanto il modo di aprirlo. |

Resta da misurare il costo di derivazione sui profili Windows e Omarchy prima
di fissare le iterazioni della versione 3.

## Ordine di consegna

Ogni passo è una PR a sé, provata prima di collegare il successivo.

1. **Primitive.** Policy della passphrase, derivazione versione 3, chiave
   dell'involucro e verificatore con HKDF: funzioni e test, non ancora usate.
2. **Server.** Colonne per verificatore e involucro di recupero; accesso con il
   verificatore accanto a quello con il PIN.
3. **Migrazione.** Passaggio atomico dal PIN alla passphrase con il kit di
   recupero, provato con interruzioni iniettate; profilo transitorio dichiarato.
4. **PIN di conferma.** Le conferme di revisione e di ruolo passano al PIN
   separato.
5. **Chiave solo in memoria.** Via la copia in `sessionStorage`, con
   l'adattamento della navigazione e della suite E2E.
6. **Recupero.** Ripristino su un computer nuovo con backup, kit e chiave di
   recupero: chiude il criterio 1 di WUL-730.

## Emendamento del passo 2 (11 ottobre 2026)

Scrivendo il lato server sono emerse cinque cose che il testo sopra non
fissava, o fissava in modo incompatibile con la scelta del PIN di conferma.
Dove questo emendamento e il testo sopra divergono, vale l'emendamento.

1. **Il PIN che il medico ha già diventa il PIN di conferma.** La migrazione
   toglie l'involucro del PIN, non il suo hash bcrypt: il punto 6 diceva di
   togliere entrambi, ma le conferme di revisione e di ruolo verificano proprio
   quell'hash, e tra la migrazione e il passo 4 non avrebbero avuto nulla da
   verificare. Tenerlo non espone di più: dopo la migrazione il PIN non avvolge
   alcuna chiave, e chi possiede una copia del database precedente alla
   migrazione può già provare il PIN contro l'involucro che quella copia
   contiene.
2. **Su un account con passphrase il PIN non apre una sessione e non tocca
   l'involucro.** L'accesso, dal browser e dal canale nativo, accetta solo il
   verificatore; il cambio PIN e il re-wrap, che sostituiscono l'involucro, sono
   rifiutati. Un PIN presentato all'accesso è negato senza essere confrontato e
   senza contare come tentativo: un client rimasto alla versione precedente che
   riprova il PIN non deve poter bloccare l'account.
3. **Prima di autenticarsi il browser riceve il salt.** `GET /api/auth/check`
   restituisce, per un account con passphrase, il salt e la versione della
   derivazione: senza non potrebbe derivare il verificatore. Il salt non è un
   segreto; per un account ancora sul PIN la risposta non rivela nulla di nuovo.
4. **I client nativi restano fuori dagli account migrati** finché non inviano
   il verificatore: non entrano con il PIN. È una conseguenza da dichiarare al
   medico prima che la migrazione del passo 3 lo raggiunga.
5. **Recupero sullo stesso computer.** Anche la chiave di recupero produce un
   verificatore, di cui il server conserva l'hash: chi la possiede può far
   accettare una nuova passphrase senza sessione. Le colonne sono quindi
   quattro, non due, e portano lo schema alla versione 2
   ([ADR 0080](0080-serialize-sqlite-schema-guards-at-bootstrap.md#versioni-dello-schema)).

Il passo 4 dell'ordine di consegna si riduce di conseguenza: dare al PIN di
conferma un cambio proprio, che aggiorna solo l'hash, e chiamarlo con il suo
nome nell'interfaccia.

## Decisioni e review indipendente (11 ottobre 2026)

### Decisioni di Leonardo

- **Recupero con la chiave di recupero.** Passa dal controllo di accesso Web
  come un login ritirato nella stessa richiesta. Il recupero non ha una
  sessione, e il proprietario delle sessioni Web ritira le sessioni di un
  account solo a partire da una sessione autentica di quell'account, mai da un
  identificativo utente: così la regola resta intatta e il pacchetto
  `web-auth-lifecycle-owner` non cambia. La sessione aperta per il recupero non
  viene mai consegnata al browser.
- **App native.** Restano fuori dagli account passati alla passphrase finché
  non adottano la versione 3. È accettato: oggi nessuno le usa.

### Review indipendente del codice integrato

Una review in sola lettura, eseguita da un secondo strumento sul diff
`41b0ce6b7..41d601004`, non ha trovato errori nella costruzione crittografica
e ha trovato quattro difetti. Tre sono corretti; il primo va chiuso prima che
l'interfaccia offra il passaggio.

| Difetto | Esito |
| --- | --- |
| La copia `medical.db.schema-original-v<N>-<uuid>.db` creata dall'aggiornamento dello schema conserva l'involucro del PIN della stessa master key: dopo il passaggio alla passphrase resta una via d'attacco offline. | Da fare: il passaggio elimina le copie che il prodotto possiede e che precedono la passphrase, in modo riprendibile dopo un'interruzione. È già la regola della tabella delle decisioni; mancava il codice. |
| Una scheda ferma sulla schermata di blocco da prima del passaggio inviava la passphrase al server come se fosse un PIN. | Corretto: a ogni sblocco il browser chiede prima che cosa sblocca l'account. Se la risposta non lo dice, o se è cambiato rispetto a ciò che il campo mostrava, non invia nulla. |
| Il passaggio verificava il PIN senza contare i tentativi: chi aveva una sessione poteva indovinarlo. | Corretto: usa la verifica condivisa, con contatori e blocco; un blocco nato dopo la verifica ferma la scrittura. Il cambio PIN ha lo stesso limite da prima e resta da allineare. |
| La schermata di blocco contava la lunghezza prima della normalizzazione, e rifiutava passphrase che le primitive accettano. | Corretto: usa lo stesso controllo delle primitive. |

## Come si prova

Sblocco, cambio, recupero e riavvio su dati sintetici; migrazione interrotta a
ogni passo; segreto errato, involucro corrotto e kit mancante con errori che
non rivelano nulla; ricerca del segreto in log, errori e argomenti di processo;
review crittografica indipendente del diff.
