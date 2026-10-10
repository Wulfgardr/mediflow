# ADR 0143: credenziale forte di sblocco, verificatore senza segreto e kit di recupero

Date: 2026-10-10

Status: Proposed — nessun codice cambia con questo documento

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

## Da decidere, con una raccomandazione

| Decisione | Opzioni | Raccomandazione |
| --- | --- | --- |
| Copie precedenti del database | **A.** Riavvolgere soltanto: una copia di `medical.db` fatta prima della migrazione (`.old-*`, Time Machine, copie a mano) conserva l'involucro del PIN della stessa master key e resta attaccabile; la migrazione elimina le copie che il prodotto possiede e dice al medico di eliminare le altre. **B.** Ruotare la master key ricifrando ogni campo. | A nella 0.9.0: B è una migrazione dei dati clinici, con il rischio che il criterio 4 di WUL-721 chiede di evitare. I backup non sono toccati: non contengono l'involucro. |
| Conferme di revisione e di ruolo | **A.** Chiedono la passphrase. **B.** Un PIN di conferma separato, verificato dal server con blocco, che non deriva né avvolge alcuna chiave. | B: la conferma protegge dall'uso a computer sbloccato, non dal furto del file; quindici caratteri a ogni conferma spingerebbero a una passphrase debole. |
| Lunghezza minima | 12, 15 o 20 caratteri. | 15. |
| Formato del kit | File dedicato, oppure dentro il backup. | File dedicato: chi copia un backup non deve trovare accanto il modo di aprirlo. |

## Come si prova

Sblocco, cambio, recupero e riavvio su dati sintetici; migrazione interrotta a
ogni passo; segreto errato, involucro corrotto e kit mancante con errori che
non rivelano nulla; ricerca del segreto in log, errori e argomenti di processo;
review crittografica indipendente del diff.
