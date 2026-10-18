# ADR 0146 / BT-01: ammissione host e query del profilo paziente

Data: 2026-10-18. Stato: Proposed; accettazione con il merge della PR.
Riferimenti: WUL-582, WUL-575, ADR 0071, ADR 0145.

## Incremento S1: vista scoped e riferimenti host (WUL-583)

Il pilota espone `patient-profile.read.v1` con `contractVersion: 1`, distinto
dalla revisione del paziente. `lib/patient-profile-scoped-contract.ts` definisce
una vista consegnabile separata dallo snapshot interno: non contiene `id`,
`ambulatoryId`, percorsi, SQL o righe ORM. La proiezione `profile` ammette soltanto
nome, cognome, codice fiscale, nascita, indirizzo, telefono, caregiver, diagnosi,
esenzioni, note, ADI, stato archiviato e motivi/note di stato e archivio. `notes`
ammette soltanto le note. ENC e custodia delle chiavi non cambiano; nessun blob
AI/documentale o sottorisorsa entra nella vista.

La richiesta distingue `open` da `read`. Web e paired aprono sul paziente scelto
dal rispettivo ingresso autenticato, con `expectedSelectionEpoch` obbligatorio.
La selezione usa il proprietario corrente e il suo confronto atomico dell'epoch;
il paziente della route e lo scope risolto dall'host non sono autorizzazioni
fornite dal body. Il GET autenticato dell'epoch permette l'acquisizione iniziale
e la risincronizzazione. I consumer conservano l'epoch osservato e scartano le
risposte di intenzioni superate: soltanto l'intenzione ancora corrente può
essere ritentata dopo un conflitto. Un'apertura A tardiva non rinnova il proprio
epoch per riscegliere A dopo B.

`read` richiede handle e `expectedRevision`; non può trasformarsi implicitamente
in apertura quando l'handle manca, scade o viene revocato. Un riferimento casuale
è posseduto dall'host e legato a sessione, selezione, paziente, scope, scopo,
proiezione massima, revisione e durata. Il riuso nella stessa lease è ammesso;
falsificazione, contesto diverso, ampliamento della proiezione, cambio ruolo,
lock/logout, revoca, restart, scadenza o revisione non più corrente lo negano.
Il risultato restituisce riferimento e attualità (`revision`, `selectionEpoch`,
`observedAt`, `expiresAt`), senza promettere validità dopo la risposta. Le risposte
sono `no-store`; i consumer separano cache e continuazioni per selezione e handle.

Web e native riusano i propri issuer fisici di sessione e il proprietario della
selezione. La lettura paired richiede le protezioni correnti di modalità,
dispositivo, operatore, ruolo, capability readonly e ambulatorio atteso; non
richiede una capability di inferenza né un provider. Local-v1 token-only rimane
un principal servizio nel percorso legacy, senza inventare identità mediche.
I GET legacy conservano il wire compatibile, ma i consumer del pilota usano
la vista scoped per aperture, riletture e readback che abilitano il writer.
Il proprietario native profilo usa i resource port emessi da `serverSessions`
con un gate fisso readonly e un registro fisicamente distinto dal proprietario
di inferenza. Non amplia il gate AI Apple né accetta un gate sostituibile dal
chiamante. Le piattaforme paired ammesse, comprese Windows e Linux, possono
leggere il profilo senza `network.ai.central-runtime`; i dinieghi dell'inferenza
restano invariati.

La sola operazione profilo può attraversare Mini/OperationClient/RPC tramite
composizione esplicita dell'host e issuer AIP già esistente. Una connessione
open-loops non riceve per questo la nuova operazione. La proiezione massima è
fissata dall'host; il chiamante può restringerla, mai ampliarla. La porta IPC
specifica torna al proprietario Web attivo: il solo mirror del Supervisor non
ammette la query. `open` headless verifica epoch e binding già attivati e crea
soltanto un riferimento di lettura; non seleziona nuovamente il paziente e non
revoca implicitamente l'autorizzazione. Ruolo corrente, binding, query e verifica
finale condividono l'ultimo segmento sincrono, dopo tutte le attese. La porta è
revocabile con il ciclo di vita esistente. RequestId RPC duplicati sono negati;
un retry con nuovo RequestId può usare lo stesso handle ancora valido.

La query non modifica dati clinici o audit. Il wrapper AIP conserva invece il
proprio audit obbligatorio, verificato separatamente. Mini funziona con parent
autenticato anche senza MCP o provider. Non si ampliano planner semantico,
capability intelligenti, writer, ENC, CAS, idempotenza o semantica di WUL-576.
Il confine non dichiara isolamento da codice ostile nello stesso processo.

Le prove attraversano gli adapter reali e comprendono successo, DTO privo di
identificativi interni, retry, replay dopo invalidazione, scope/proiezione,
revisione, aperture tardive e revoca/cambio ruolo durante le attese. Snapshot
clinico e audit della query restano invariati; l'audit del wrapper AIP è atteso.
La reversione non richiede migrazioni o ripristini di dati: elimina soltanto
contratto, ingressi e riferimenti volatili introdotti dal pilota.

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
Il descrittore versionato di lettura è usato dal dispatch host. L'UPDATE usa
l'identità `patient-profile.update.v1`, versione 1, assegnata dal servizio host
nel discriminatore interno diretto a `updatePatientOperation`. Il writer esistente
rifiuta identità/versione mancanti o diverse prima di aprire una transazione.
`operationId` e `contractVersion` sono distinti dalla versione CAS del paziente.
Il descrittore identifica il contratto operativo, non emette autorizzazioni:
ammissione, audit e guard del commit restano quelli esistenti. Il body HTTP
non può selezionare l'operazione. Non viene creato un registro generico né una
capacità intelligente o agentica.
Il catalogo Headless statico denied/unavailable mantiene la propria semantica.

L'adattatore traduce decisioni e vista nel wire esistente. Sessioni mancanti,
capability, modalità, scope, tombstone e pazienti archiviati conservano i rispettivi
esiti e precedenze. La risoluzione dell'identificativo avviene dopo l'ammissione
iniziale, conservando il rifiuto di richieste non autenticate prima dei parametri.
Nel paired i parametri sono risolti prima dello scope finale; dopo tale controllo
la query viene consumata senza ulteriori attese. FSE usa un identificativo
sincrono ricavato dalla URL, senza callback asincrona dopo lo scope.
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
writer restano applicabili; test del contratto UPDATE verificano rifiuto di
identità/versioni sconosciute prima degli effetti, impossibilità di selezionare
il dispatch dal body e conservazione di commit, singolo audit e conflitto 409.
Questo completa i descrittori operativi della verticale lettura/UPDATE, senza
introdurre ricevute, idempotenza nuova o un writer portabile. Una reversione del contributo ripristina i precedenti
ingressi senza migrazioni, formato persistente nuovo o effetti da annullare.
