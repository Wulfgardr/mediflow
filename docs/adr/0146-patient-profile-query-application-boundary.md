# ADR 0146 / BT-01: ammissione host e query del profilo paziente

Data: 2026-10-18. Stato: Proposed; accettazione con il merge della PR.
Riferimenti: WUL-582, WUL-575, ADR 0071, ADR 0145.

## Problema

La porta `patient-profile-service` esiste, ma la sua lettura accetta identificativo,
proiezione e scope non accompagnati da ammissione e restituisce alla Web una riga
ORM. Il contratto non rende espliciti autore e scopo della lettura e lascia la
policy distribuita negli adattatori.

## Decisione

Riutilizzare quel servizio. Il suo ingresso host riceve la richiesta originale,
la superficie fissata dal chiamante di produzione e un risolutore dell'identificativo.
La superficie non viene letta da body, query string o dichiarazioni di ruolo,
scope o ricevuta. Prima di leggere il profilo l'ingresso invoca le autorità già
esistenti e ne consuma il risultato nella stessa chiamata. Non esporta un principal
serializzabile, un issuer alternativo o una query SQL richiamabile senza ammissione.

- Web: sessione Web corrente, dal proprietario esistente e validata sull'utente.
- API v1 locale: token locale esistente, anche senza sessione umana. L'autore è
  il servizio locale autenticato; non gli viene attribuito un ruolo medico.
- Paired: client, modalità home-base, capability di lettura pazienti, sessione
  account e scope risolto dall'host, incluso il confronto con l'ambulatorio atteso.
- Validazione FSE: medesima query di membership, con lo scopo specifico e la
  capability FSE già prevista. Non richiede la capability di replica pazienti.
  Restano applicabili le verifiche di generazione del suo ingresso esistente.

Identità dell'autore, scopo e ambito compongono una query interna al servizio.
Il contratto della query e la vista del profilo sono tipi espliciti, indipendenti
sia da Request/Next sia dalle righe ORM. I campi cifrati restano stringhe opache;
le date sono proiettate senza introdurre decifratura o canonicalizzazione clinica.
Il descrittore versionato di questa singola operazione è usato dal dispatch host:
non è un nuovo registro generico né una capacità intelligente o agentica.
Il catalogo Headless statico denied/unavailable mantiene la propria semantica.

L'adattatore traduce decisioni e vista nel wire esistente. Sessioni mancanti,
capability, modalità, scope, tombstone e pazienti archiviati conservano i rispettivi
esiti e precedenze. La risoluzione dell'identificativo avviene dopo l'ammissione
iniziale, conservando il rifiuto di richieste non autenticate prima dei parametri.
La query non scrive SQLite né audit. Le normali primitive di sessione mantengono
la propria gestione volatile del ciclo di vita.

## Confini e alternative

Un contesto plain object fornito dall'adattatore oppure un secondo registro di
principal duplicherebbero l'autorità: sono esclusi. Request rimane soltanto
nell'ingresso host transitorio Node; non entra nel contratto della query. Una
futura estrazione del motore deve conservare l'ammissione nell'host e definire un
confine autenticato proprio; questo ADR non qualifica IPC/FFI né un writer Rust.

Writer, audit di scrittura, custodia delle chiavi, ENC, CAS e API pubbliche non
cambiano. La convergenza della verticale Swift è un contributo distinto; questo
incremento non dichiara un solo writer per l'intero prodotto. La canonicalizzazione
prima di ENC e gli altri criteri S0 non sono chiusi dalla sola query.

## Prove e ripristino

Test sintetici attraverso gli adattatori reali verificano le tre proiezioni,
lettura locale token-only, scope/capability paired e FSE, rifiuti e tentativi di
sostituire autorità, tombstone e assenza di effetti su SQLite/audit. I test del
writer restano applicabili. Una reversione del contributo ripristina i precedenti
ingressi senza migrazioni, formato persistente nuovo o effetti da annullare.
