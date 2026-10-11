# ADR 0144: generazione dell'archivio, per non scrivere nel database B ciò che è stato letto dal database A

Date: 2026-10-11

Status: Accepted, 11 ottobre 2026, con le opzioni raccomandate. Nessun codice cambia con questo documento.

## Problema e contesto

C15 / [WUL-730](https://linear.app/wulfgardr/issue/WUL-730), criteri 4 e 5.
L'[ADR 0142](0142-sqlite-maintenance-admission.md) ha lasciato in HOLD
l'integrazione del lifecycle Web con una frase che resta il requisito:
"un'operazione che ha letto il database A non deve riprendere e scrivere nel
database B". Questo documento propone come soddisfarla.

Letto sul codice di `main` `1eb1f468d`:

- il ripristino da backup è una sola transazione IMMEDIATE; prima della prima
  scrittura distruttiva esegue una chiusura sincrona
  (`runMutationFence` in `lib/backup-restore-executor.ts`), che oggi ritira
  soltanto l'operazione di transizione dei checkup;
- le sessioni Web vivono in memoria; lo stato degli abbinamenti sta in
  `settings` (`NETWORK_PAIRING_STATE_KEY` in `lib/network-home-base-server.ts`),
  che il backup non contiene: un ripristino non lo tocca;
- il browser che ripristina ricarica la pagina
  (`components/backup-restore-ui.tsx`); le altre schede e gli altri client no;
- 24 moduli di produzione scrivono dati clinici passando da
  `writeAuditEventInTransaction` (`lib/security/audit.ts`), dentro la propria
  transazione: è l'unico punto che tutte le scritture cliniche con audit
  obbligatorio hanno in comune.

Dopo un ripristino restano quindi quattro strade aperte:

| | Che cosa succede | Perché ritirare le sessioni non basta |
| --- | --- | --- |
| a | Un'altra sessione resta valida sui dati sostituiti. | Basterebbe, ma oggi non avviene. |
| b | Una scheda rimasta aperta conserva righe lette dal database A, con ID e versione. Dopo un nuovo accesso le invia al database B. | Un backup dello stesso archivio ha gli stessi ID: se anche la versione coincide, la scrittura è accettata. |
| c | Un'operazione già autenticata, in attesa del lock, scrive dopo il commit del ripristino. | La sessione era valida quando la richiesta è entrata. |
| d | Un client abbinato conserva il suo grant e la sua cache. | Il grant sta in `settings`, fuori dal backup. |

Lo stesso vale per lo scambio di file del repair, che sostituisce l'intero
archivio.

## Decisione proposta

### 1. Ogni archivio ha una generazione

Un identificatore casuale, conservato nell'archivio in una tabella di una sola
riga che il backup non esporta. Cambia nella stessa transazione, o nello stesso
journal, di ogni operazione che sostituisce in blocco il contenuto clinico:
ripristino da backup, scambio di file del repair, adozione di un archivio
precedente. Non cambia per le scritture ordinarie.

### 2. Una sessione vale per una generazione

Sessioni Web, sessioni native e grant dei client abbinati registrano la
generazione con cui sono stati emessi. L'autenticazione rifiuta quelli di
un'altra generazione. La chiusura sincrona del ripristino continua a ritirare
ciò che vive in memoria; la generazione rende il ritiro durevole e raggiunge ciò
che la chiusura non vede: un altro processo, un grant in `settings`.

Chiude le strade a e d. Un client abbinato deve abbinarsi di nuovo, e un nuovo
abbinamento comporta una nuova sincronizzazione.

### 3. La scrittura confronta la generazione dentro la propria transazione

`writeAuditEventInTransaction` riceve la generazione della sessione che ha
autenticato la richiesta e la confronta con quella dell'archivio, letta nella
stessa transazione. Se differiscono, la transazione fallisce e la rotta
risponde `409 ARCHIVE_REPLACED`. La regola viaggia così sulla garanzia che
esiste già: nessuna scrittura clinica senza la sua riga di audit.

Chiude la strada c: l'operazione in attesa porta la generazione vecchia.

### 4. Il browser ricarica quando la generazione cambia

`GET /api/auth/check` e la risposta di login includono la generazione. Il
client Web ricorda quella con cui ha caricato i dati; se ne osserva una
diversa scarta lo stato e ricarica la pagina prima di accettare altro input.

Chiude la strada b per il client Web, che è l'unico del profilo 0.9.0.

## Alternative considerate

- **Solo ritirare le sessioni.** Chiude a, non b né c.
- **Ogni richiesta di scrittura dichiara la generazione da cui ha letto**, in
  un'intestazione che il server confronta. È la chiusura completa di b anche
  per i client che non controlliamo, ma cambia il contratto di tutte le API di
  scrittura e dei client nativi, che si qualificano nella 0.9.6. Proposta per
  quella release, sopra la stessa generazione.
- **Tenere la generazione in `settings`.** Evita una tabella nuova, ma
  `settings` si scrive dalla rotta generica delle impostazioni: servirebbe una
  chiave riservata e una guardia in più.

## Conseguenze

- Una tabella nuova: lo schema passa alla versione successiva, secondo la
  regola dell'[ADR 0080](0080-serialize-sqlite-schema-guards-at-bootstrap.md#versioni-dello-schema).
- Un codice di errore nuovo, `ARCHIVE_REPLACED`, che l'interfaccia deve
  spiegare: "i dati sono stati ripristinati da un backup; ricarico la pagina".
- Dopo un ripristino i client abbinati vanno abbinati di nuovo. Va detto al
  medico nella pagina di ripristino, prima della conferma.
- Una lettura in più, di una riga, in ogni transazione di scrittura clinica.
- Le scritture che non passano da `writeAuditEventInTransaction` non sono
  coperte dal punto 3: vanno elencate e decise una per una.

## Decisioni

L'11 ottobre 2026 Leonardo ha lasciato a chi esegue la scelta della pratica
migliore sulle tre questioni aperte. Sono adottate le opzioni raccomandate;
cambiarne una riapre il punto corrispondente.

| Decisione | Scelta | Perché |
| --- | --- | --- |
| Client abbinati dopo un ripristino | Il grant decade e il client si abbina di nuovo. | Soddisfa il criterio 5 senza cambiare le API dei client. La dichiarazione della generazione a ogni scrittura resta proposta per i client della 0.9.6. |
| Dove sta la generazione | Tabella dedicata, di una sola riga, fuori dal backup. | `settings` si scrive dalla rotta generica delle impostazioni: una chiave riservata chiederebbe una guardia in più. |
| Repair con scambio di file | Riceve la generazione insieme al ripristino. | È lo stesso confine, e lasciarlo fuori terrebbe aperto il criterio 4. |

## Come si prova

Su SQLite reale, con dati sintetici: una sessione emessa prima del ripristino
non autentica dopo; una scrittura fermata sul lock durante il ripristino
fallisce con `ARCHIVE_REPLACED` e non lascia righe, e senza il confronto del
punto 3 lo stesso test la vede riuscire; un grant abbinato emesso prima non
vale dopo. Nel browser: due schede, ripristino dalla prima, la seconda
ricarica prima di poter salvare. Per il repair: lo stesso dopo lo scambio di
file.
