# Prima tranche 0.9.0 — 26 settembre 2026

## Stato e perimetro

Candidati locali sulla base `6c212221a98f9b8e45cc1d243226d0adb41770bd` della
repository pubblica `Wulfgardr/mediflow`. Questo verbale distingue il lavoro
verificato dalla pubblicazione: nessun nuovo tag, rilascio, push o mutazione
del tracker è stato eseguito in questa tranche. Dati e prove sono sintetici;
le directory dati reali non sono state aperte.

La consegna sorgente/funzionale 0.8.6 e il coordinamento WUL-669 erano già
conclusi. Le correzioni PR 358 e il dossier PR 359 sono su `main`; il tag
`v0.8.6` resta sul commit `46296266c0a8ff4d4ab19216af7e761cddec7d78`.
Lo [Stato del sistema](../STATE_OF_THE_SYSTEM.md) è stato riallineato senza
chiudere le decisioni clinico-organizzative WUL-685–688 o qualificare i target
nativi differiti.

## C01 — inventario iniziale, non censimento concluso

Il manifest è stato ricavato dall'albero Git immutabile della base, non dal
contenuto delle directory runtime: **2.849 file tracciati**, ciascuno con
hash, dimensione, conteggio delle righe, linguaggio e categoria. Comprende
209 file di route, 211 script npm, cinque manifest nativi e sei workflow.
La riproduzione e il controllo indipendente di path e hash sono riusciti.

La mappa dei test elenca 872 file: 610 selezionati staticamente dalla suite,
58 citati direttamente da script e **204 ancora senza raggiungibilità
accertata**. Una selezione statica non è prova di esecuzione. Le directory
Swift `Tests`/`TestsSupport` sono state riclassificate dopo il primo controllo:
non sono codice runtime solo perché si trovano sotto `native/`.

Una successiva acquisizione richiama soltanto l'export di selezione del runner
headless portabile: restituisce 24 percorsi tracciati, ordinati e univoci
(14 AIP, quattro MINI, due MCP e quattro script). Diciotto erano `UNKNOWN`
nel censimento iniziale e ora hanno una prova di selezione; per gli altri
186 quel controllo non aggiunge evidenza. Non sono stati avviati test o
processi figli e il censimento originario resta conservato, senza trasformare
questa selezione in una prova di esecuzione o di successo.

Restano aperti la ricostruzione completa dell'autorità dei writer, la
raggiungibilità dinamica e le classificazioni ambigue. Il ledger iniziale
conserva 20 disposizioni, senza convertire un finding storico o una ricerca
statica in un difetto riprodotto sulla revisione corrente. Nessun codice è
stato eliminato come presunto codice morto.

## C03 — aggiornamento paziente atomico

Web, API-v1 e rete associata usano ora un'unica operazione per aggiornare
profilo, versione e associazione ambulatoriale. Autenticazione, permessi,
scope, normalizzazione e risposte restano negli adapter; non viene introdotto
un writer generico o una nuova capacità headless.

La baseline riproduceva due risposte 500 con il profilo già modificato quando
falliva la scrittura dell'associazione. Nel candidato, una transazione SQLite
sincrona e immediata annulla tutte le scritture se un passaggio fallisce.
Restano distinti campo assente, primario azzerato esplicitamente e paziente
eliminato; le altre associazioni sono conservate. La contesa continua a usare
`patients.version`, con un vincitore e un conflitto per la stessa versione.

Prove accettate dal coordinatore:

- 34 test mirati: rollback SQLite reale, associazioni, null, riattivazione,
  campi cifrati invariati, errori, retry e contesa tra due processi;
- cinque prove di concorrenza contro server isolato;
- due prove sulla route di rete reale, inclusi capacità, sessione, scope,
  versione e disabilitazione della modalità rete;
- lint, controllo tipi, build, never-regress, claims, OpenAPI drift e controllo
  del diff senza errori;
- review indipendente GPT-6 Astra Low, con integrazione delle prove aggiuntive
  richieste su riattivazione e rete.

La candidatura C03 mantieneva ancora l'audit dopo il commit. Non attestava
quindi da sola il requisito C04 descritto sotto.

## C14 — prime correzioni delle prove

### Confine amministrativo backup

Il test di autenticazione del backup si arrestava sullo schema simulato
incompleto, prima dei casi negativi. Sono stati aggiunti i due export mancanti,
riattivato il test nella suite richiesta e separato il controllo della porta
origine da quello Fetch Metadata. Due mutazioni negative indipendenti delle
protezioni hanno fatto fallire il test; il runtime di autorizzazione non è
stato cambiato. I contatori attestano assenza di preflight, restore, fence e
accessi al database per le richieste respinte.

### Directory temporanee e dipendenze dei test

Le directory temporanee possedute dal runner vengono rese fisiche con
`realpath`: su macOS l'alias `/var` non deve causare un falso rifiuto dei
controlli ATHENA. Il percorso dati fornito esplicitamente resta invece
identico e non viene pulito dal runner, secondo ADR 0130. Il test regressivo
verifica entrambe le proprietà e la pulizia dei soli artefatti posseduti.

Gli smoke network ora copiano anche i package locali, usano le dipendenze
installate della checkout e avviano il CLI Next locale senza installazioni
implicite. La baseline con directory dati esterna non raggiungeva i test e
rispondeva 500 al readiness check. Il candidato passa read-only 1/1 e write
2/2 con directory sintetica esterna; lockfile e configurazione TypeScript
della checkout restano invariati. Non sono state qualificate tutte le
varianti dello script network con queste sole due esecuzioni.

La prima candidatura C14 ha superato **4.747 test, con 12 skip previsti e zero
fallimenti** (4.759 totali), più lint, tipi, build, never-regress e claims,
con Node 24.18.0/npm 11.18.0. Chromium e gli input pubblici Mac congelati sono
prerequisiti espliciti: i tre test di pin Mac non qualificano il runtime
nativo. Questo conteggio precede l'integrazione C03/C04 e non è attribuito
retroattivamente al candidato finale.

Il timeout intermittente del selettore nativo AnyDoc rimane aperto in WUL-729:
il successo di altri test non ne dimostra la correzione.

### Isolamento AnyDoc e comando di prova della cancellazione

Il test negativo del worker AnyDoc alterava il file della checkout usato
anche dagli altri test paralleli. Una riproduzione sincronizzata dimostra
`extracted → io_failure → extracted` mentre un peer rinomina e ripristina il
file condiviso. Il candidato altera soltanto una copia fisica temporanea delle
sorgenti esatte: verifica l'estrazione dalla stessa copia prima e dopo i tre
negativi e, durante ogni negativo, l'estrazione dal worker originale invariato.
Un driver con import letterale conserva i guard di riservatezza; la pulizia
attende la chiusura dei processi figli. Passano 58 prove mirate comprendenti
runner, manifest e confini di importazione. Il parser runtime non cambia.

Il comando separato `test:patient-soft-delete` era gia bloccato nella base da
opzioni TypeScript incompatibili e da emissione CommonJS di `import.meta`.
Ora usa il loader canonico, mantiene gli stessi cinque file e le due fasi,
preserva la directory dati esplicita e pulisce solo quella posseduta dal run.
Il vecchio tsconfig e stato rimosso dopo averne verificato l'unico consumer.
Il guard sul filtro dei pazienti eliminati segue ora anche un predicato
`const` locale, usato soltanto nelle query previste: undici casi negativi
coprono alias, mutazioni e variabili omonime, senza ampliare l'allowlist.
La review indipendente GPT-6 Astra Low non trova nuovi casi bloccanti;
il comando integrato passa 31/31.

## C04 — audit obbligatorio, pilota locale verificato

L'[estensione di ADR 0015](../adr/0015-audit-taxonomy-minimum-catalog.md)
definisce il pilota: aggiornamento, associazione e audit richiesto nella stessa
transazione; fallimento dell'audit significa rollback, non successo senza
storia. La baseline SQLite reale conferma che Web e API-v1 rispondono 200
anche se il sink audit fallisce. Il candidato inserisce ora l’evento
richiesto nella stessa transazione e verifica che sia stata inserita esattamente
una riga: anche un inserimento ignorato senza eccezione causa rollback.

Le prove comprendono errore del sink, vincolo, `RAISE(IGNORE)`, limite di pagine
SQLite (`SQLITE_FULL`), versione derivata dall'host, identità Web/API/rete,
metadati minimizzati, ripristino da archiviato, concorrenza con un solo evento
e crash del processo prima/dopo il commit. Nei test di crash autonomi il
processo di verifica apre il file solo dopo la morte del writer; il retry
successivo non applica di nuovo il cambiamento. Non è una prova di perdita
di alimentazione del computer.

La lane ha superato 49 test mirati e cinque prove HTTP di concorrenza, oltre
a lint, tipi, build, never-regress, claims e OpenAPI drift. La review fresca
GPT-6 Astra Low ha verificato correzioni, hash finali e casi negativi pertinenti.
Dopo l'integrazione, lo smoke della route di rete reale passa 2/2.

Il guard audit C14 è stato aggiornato per seguire le chiamate reali
adapter → operazione → writer nella transazione. Non accetta una stringa
presente nel commento o un fallback alla vecchia disposizione. I suoi 13 test
e cinque mutanti delle sorgenti passano; il gate integrato non segnala finding.
Il controllo statico è circoscritto e non sostituisce le prove SQLite.

C04 non implica la migrazione di tutti i writer: i restanti domini ordinari
appartengono a C05. Le ricevute cliniche headless e gli altri percorsi con
contratti più forti non devono essere ridotti alla garanzia del pilota.

### Classificazione iniziale e destinazione degli altri writer

L'inventario statico corrente comprende 82 chiamanti/sink osservati e 30
passaggi attraverso wrapper. Include il sink SQL interpolato del commit SOAP,
che una ricerca del solo nome letterale della tabella non rilevava. I riferimenti
Swift individuati riguardano la lettura dell'audit; l'assenza di altri match non
è dimostrazione di assenza di writer. Per file e chiamanti sono conservati hash
della sorgente e riferimenti puntuali nel run locale.

| Coorte | Classificazione e destinazione |
| --- | --- |
| Profilo paziente PUT Web/v1/rete | Evidenza clinica obbligatoria: pilota C04 nella stessa transazione. |
| Creazione, eliminazione, ripristino paziente e manutenzione orfani | Evidenza clinica obbligatoria. DELETE Web/v1 e famiglia create/delete/restore rete migrati nel candidato locale; creazione locale aggiunta nella coorte successiva descritta sotto. Ripristino amministrativo e manutenzione restano separati. |
| Diario, terapie, osservazioni, checkup, allegati | Evidenza clinica obbligatoria; roster e prove di errore per ciascuna famiglia C05. |
| Prescrizioni prestazioni, relativi item e prescrizioni protesiche | Evidenza clinica obbligatoria; migrazione C05 dei writer host e rete, non soltanto dei loro wrapper. |
| Ambulatori, appartenenze e pulizia contenitori test | Evidenza obbligatoria degli effetti su pazienti/scope; C05. Il contenitore test non giustifica l'assenza di audit. |
| Righe SISS handoff persistite | Evidenza obbligatoria del cambiamento di workflow; C05. |
| Solo lancio contestuale SISS e probe provider sintetico | Log operativi dei tentativi/esiti: non attestano prescrizioni, invii o modifiche cliniche. Contratto esistente preservato. |
| Credenziali, profilo, impostazioni e ciclo autenticato | Evidenza di sicurezza/amministrazione, non declassata a telemetria. La migrazione non è coperta dal pilota paziente. |
| Scheduler e ripristino della storia audit | Riesame C15: distinguere effetti su database/sistema e conservazione degli eventi storici, senza inventare una transazione su autorità diverse. |
| Revisione medica persistita e Clinical Commit Receipts headless | Garanzie proprie già più forti: preservare writer, ricevute e replay, senza sostituirli con il pilota ordinario. |
| Attestazioni di ruolo, porte Supervisor e ricevute WHO | Evidenza richiesta dal rispettivo contratto: una lettura o un tentativo non diventano automaticamente best-effort. |
| Negazioni credenziali/headless | Nessuna mutazione clinica, ma conservazione dei contratti attuali di audit e minimizzazione; non sostituiscono eventi di commit. |

Questa classificazione riguarda i sink osservati. Non dimostra che ogni
operazione clinica abbia già un chiamante audit, né che un writer sia atomico
perché si trova vicino a una transazione. Nessuna coorte non migrata è
considerata completata o messa in HOLD approvato dal solo censimento.

## C05 — prime coorti circoscritte

### Oggetto JSON in ingresso

La baseline conferma nove risposte 500 improprie: JSON nullo, malformato o
vuoto su tre PUT paziente. Array e primitive erano già respinti con 400, ma
come versione mancante. Il candidato integrato valida il solo oggetto JSON
nel punto di parsing, dopo i controlli di autenticazione/scope, e conserva i
limiti rete esistenti. Le richieste non valide ricevono 400 con «Richiesta non
valida.», senza scritture o eventi audit. Un errore del database resta 500;
il superamento del limite di rete resta 413. Non ridefinisce campi, payload
cifrati, proprietà sconosciute o limiti locali.

Passano 81 test mirati complessivi C03/C04/C05 e i controlli di tipi, lint,
build, never-regress, claims, OpenAPI drift e audit. Una review indipendente
GPT-6 Sol Medium conferma il perimetro dei cinque file; gli hash sono stati
verificati durante l'integrazione. Il confronto di 2.609 file non Markdown
conferma l'equivalenza delle sorgenti integrate alla candidatura verificata,
senza ripetere build identiche. Questo non conclude il contratto C05 per gli
altri input e domini.

### Cancellazione logica Web e API-v1

La seconda coorte applica lo stesso audit obbligatorio ai due DELETE locali.
La baseline, sotto un errore SQLite del sink audit, risponde 200 e conserva il
paziente eliminato alla versione 4 senza alcun evento. Nel candidato, una
singola transazione immediata comprende lettura del paziente attivo, controllo
della versione, cancellazione logica e audit. Se la scrittura dell'audit
fallisce o viene ignorata, la cancellazione viene annullata. L'evento registra
la versione committata, non quella richiesta; la motivazione resta esclusa
dai metadati audit. Gli eventi storici non sono riscritti.

Passano 30 prove SQLite e delle route reali, 61 regressioni delle coorti
precedenti e cinque prove HTTP di concorrenza. Sono coperti dinieghi prima
della lettura del corpo, input non validi, conflitti, errore della scrittura
paziente, audit fallito o ignorato, identità derivata dall'host, un solo evento
al successo, conservazione dei figli e delle associazioni, riapertura e
contesa fra due processi. Una cancellazione ripetuta resta 404: non introduce
un nuovo contratto di replay della risposta.

La review indipendente GPT-6 Astra Low non trova blocchi nel runtime e
riesegue nove prove pertinenti. Lint, tipi, build, never-regress, claims e
OpenAPI drift passano sul candidato; i suoi 2.611 file non Markdown sono
identici al runtime integrato prima dell'aggiornamento dei guard. Rete,
ripristino, purge, creazione e operazioni multiple restano fuori da questa
coorte.

La review dei guard ha riprodotto due famiglie di falsi negativi statici:
un predicato sostituito da OR o privo del vincolo sul paziente, e un successo
anticipato prima dell'audit. Il controllo corretto richiede la congiunzione
esatta su ID, versione e paziente attivo, e rifiuta il successo anticipato.
La verifica indipendente riproduce il rifiuto dei mutanti originari agli hash
finali. Passano 24 prove dei guard e il gate non riporta finding; le ricevute
della prima review restano conservate. Questi controlli AST circoscritti non
sostituiscono le prove runtime e non attestano tutti i percorsi clinici.

## Esiti delle verifiche integrate

La combinazione C03+C14, prima di C04, ha eseguito 4.773 test: 4.760 passati,
uno fallito e 12 skip. Il fallimento riguarda l'estrazione AnyDoc della terza
pagina di un PDF sintetico misto, con risultato `isolated_anydoc_failure`.
Dieci processi isolati successivi passano tutti 8/8 sul medesimo test e sui
medesimi hash; questo, da solo, **non dimostra una correzione**. L'indagine
successiva riproduce e rimuove l'interferenza descritta sopra. Non essendoci
una traccia del worker nel fallimento iniziale, non ne attribuisce con
certezza la causa storica. Il problema e distinto dal timeout del selettore
nativo e il risultato originario resta conservato.

Una successiva integrazione C03/C04/C05/C14 rileva quattro incompatibilita
nei test: import dinamico della fixture respinto da due guard e helper JSON
non riconosciuto da due prove di rete. Le correzioni mantengono importazioni
verificabili, helper reale e inventario di 26 lettori limitati. Dopo queste
modifiche, la suite completa passa **4.810/4.822 test, zero fallimenti e 12
skip**. I log precedenti non sono sovrascritti. Sono inoltre passati i tre
comandi di rete richiesti: lettura, aggiornamento profilo e diario.

Questo esito precede la successiva coorte DELETE Web/v1: non ne anticipa
l'accettazione e non qualifica C14 nel suo complesso.

### Candidato integrato dopo DELETE Web/v1

La verifica finale passa **4.841/4.853 test, zero fallimenti, zero annullati
e 12 skip**, in 83,1 secondi, con Node 24.18.0 e npm 11.18.0. Il comando
separato di cancellazione logica passa 31/31; il gate audit controlla 37
route e 26 eventi richiesti senza finding. Il lint dei tre guard modificati
non riporta errori. Build, tipi, lint runtime e gli altri gate restano quelli
del candidato DELETE di cui è stata verificata l'identità delle sorgenti;
le successive modifiche riguardano soltanto guard e documenti.

Il primo lancio di questa verifica aveva omesso le tre variabili con i
percorsi degli input Mac congelati: 4.838 prove passate e tre fallite per
prerequisiti mancanti, con 12 skip. Il log è conservato. Il secondo lancio
usa un comando riproducibile con i percorsi espliciti, senza indebolire i test
o cambiare sorgenti fra i due run. Il successo dei pin non qualifica il
runtime nativo. Restano inoltre valide le tre prove di rete eseguite sulla
stessa implementazione di rete, non modificata dalla coorte DELETE locale.

Il coordinatore accetta questa coorte locale e i relativi guard agli hash
riesaminati. Non dichiara conclusi C01, C03, C04, C05 o C14 nel loro insieme.

## Coordinamento e limiti

L'implementazione circoscritta è stata affidata a GPT-6 Sol Medium; estrazioni
e confronti statici a GPT-6 Luna Medium Fast. Il coordinatore mantiene
contratti, integrazione e decisione di accettazione. La [preparazione delle versioni successive](./2026-09-26-09x-preparation.md)
ricevuta dalla lane separata è integrata come documento. Le sue prove di
qualificazione future restano `NOT_RUN`. Il successivo mandato assegnato
dall'utente a quel thread produce candidati sintetici 0.9.1–0.9.7 separati:
non sono inclusi né dichiarati verificati da questa tranche 0.9.0.
Il nuovo filone Rust/GPUI autorizzato dall'utente mantiene esperimenti isolati;
WUL-735/573/580 non sono accettati da questo lavoro e GPUI non è una scelta
adottata.

I log, i manifest riproducibili, i diff e le ricevute di integrazione con hash
sono conservati localmente nel run `090-start-20260926`, fuori da Git. I limiti
dell'account sono condivisi e non misurano il consumo di questa tranche.
Il checkpoint concordato è alle 09:00 locali; l'orario del reset odierno non
è noto e non è stato dedotto dal solo reset settimanale esposto dal tool.


## Milestone browser del 26 settembre, dopo il checkpoint delle 09:00

Verificato il percorso Web con Chromium 1440×960, Node 24.18.0, Next Webpack,
route HTTP e SQLite reali su una directory sintetica dedicata. Il percorso
apre la scheda, modifica e salva, rilegge il dato persistito, simula una
modifica concorrente e verifica il rifiuto con bozza conservata. Dopo
rilettura esplicitamente confermata, elimina la scheda, torna alla lista
e ne verifica l'assenza dal percorso ordinario. La riga rimane nel database
con versione incrementata e un solo evento di eliminazione.

La prova ha trovato e corretto un difetto UI: la rilettura aggiornava il
modulo, ma non il record usato dalle azioni della pagina. La correzione
trasmette alla pagina lo stesso record validato; non introduce una nuova
lettura nelle azioni, un retry con versione fresca o un aggiornamento
automatico della bozza. Resta invariato il comportamento per cui una
notifica live con un record più recente aggiorna intestazione e azioni,
mentre la bozza conserva il proprio snapshot.

Prove locali: percorso reale 1/1; regressioni browser del modulo 4/4,
comprese conferma annullata e seconda modifica esterna non notificata
che mantiene DELETE obsoleto e rifiutato; lint, typecheck, build,
never-regress e claims superati. Review indipendente Astra Low sul delta
UI, implementazione Sol Medium. Le prove precedenti delle transazioni
e dell'audit restano valide: i relativi file runtime non sono cambiati.

I tentativi precedenti restano conservati: correzioni di selettori e
harness distinte dal difetto reale. Le risposte 409 del conflitto e le
letture 404 successive all'eliminazione sono riconciliate con le richieste
e lo stato del database; nessun errore JavaScript della pagina né
richiesta esterna osservati. Il controllo è sul Web locale, non sui client
nativi o sull'ammissione clinica, e non chiude globalmente C03/C04/C05.

Le ricevute locali sono in `.codex/090-start-20260926/browser-reread-fix/`;
screenshot, trace, configurazione, ambiente e osservazioni del browser
sono conservati fuori da Git nel dossier `mediflow-090-browser-milestone`.
Il precedente snapshot della prima tranche è conservato immutato.


## Milestone C05 — creazione, cancellazione e ripristino paziente in rete

La famiglia rete usa ora l'audit obbligatorio nella stessa transazione
immediata di paziente, associazione ambulatoriale e versione. La baseline
su SQLite reale aveva dimostrato sei modifiche committate senza evento,
una per ciascuna operazione e guasto audit (`FAIL` o `IGNORE`). Nel candidato
tutti e sei i guasti annullano ogni effetto: una connessione indipendente
rilegge righe complete di paziente, associazioni, figli e audit identiche
a quelle iniziali. Tre prove positive verificano un solo evento, attore
derivato dall'host, metadati minimizzati e versione committata; il retry
della richiesta originaria non produce un altro effetto.

La prova HTTP reale, con client associati e sessioni sintetiche, passa 3/3:
creazione e rilettura, cancellazione con assenza dall'elenco ordinario e
presenza nel cestino, ripristino e nuova rilettura; rifiuti per sessione,
capability e ambulatorio errati; versioni obsolete; richieste concorrenti.
Due POST simultanei sullo stesso ID danno un solo successo e una sola
associazione/evento. La risposta 500 del duplicato resta quella preesistente
del vincolo: questa coorte non ne cambia il contratto. DELETE e ripristino
concorrenti producono un solo successo e un rifiuto 404, senza replay.
I campi cifrati mantengono gli stessi byte e il ripristino dal cestino
non cambia il significato dello stato di archiviazione.

Passano 10 test SQLite, 3 scenari HTTP, 5 prove di concorrenza pazienti e
i controlli lint, tipi, build, never-regress, claims e OpenAPI drift.
Il coordinatore ha integrato i soli file della coorte e verificato
l'equivalenza di 2.613 file non Markdown con il candidato dei controlli,
inclusi i tre file UI gia accettati. La suite completa integrata conta
4.863 test: 4.851 passati, zero fallimenti e 12 esclusi. Il gate audit non
riporta finding. La review indipendente Astra Low non rileva blocchi nel
delta; la prova browser precedente resta valida per i file UI invariati.

Implementazione Sol Medium, accettazione del coordinatore; correzioni
di verifica: confronto delle righe complete, retry con versione originale,
assenza nell'elenco rete e concorrenza della creazione. Le ricevute sono in
`.codex/090-start-20260926/c05-network-lifecycle/`, con snapshot distinto
dalle milestone precedenti. Il risultato e locale: nessun commit o rilascio,
nessuna qualificazione nativa o ammissione clinica, nessuna chiusura globale
di WUL-720/C05. Restano da migrare gli altri writer classificati sopra.


## Creazione paziente locale — Web, anteprima vincolata e API-v1

Il Chief of Staff ha concordato questa coorte dopo aver verificato la milestone
rete. Un solo owner Sol Medium modifica i due POST; servizio di creazione,
owner della sessione, registro delle anteprime e normalizzazione restano
invariati. Il contratto è stato aggiunto ad ADR 0015 prima del runtime.

La baseline osserva sei successi 201 con paziente e associazione persistiti
ma audit assente: errore SQLite e inserimento ignorato su ciascuno dei tre
percorsi. Nel candidato, una transazione immediata comprende paziente,
associazione ed evento obbligatorio. Le stesse sei prove ora restituiscono
500 senza alcuna scrittura persistita, verificata da una connessione
indipendente. Identità, versione iniziale e metadati minimizzati sono derivati
dall'host e dai campi normalizzati; le chiavi arbitrarie del corpo non entrano
nell'evento.

L'anteprima conserva il controllo finale della sessione dopo la callback.
Una prova con il componente fisico reale provoca il veto dopo l'inserimento
dell'audit: la risposta è 409 e tutte e tre le scritture vengono annullate.
Sono coperti anche contesto scaduto, sessione ritirata e generazione diversa.
La destinazione fissata non viene sostituita dal corpo o dalla selezione
corrente. API-v1 conserva la possibilità preesistente di creare in archivio.

Passano 15 prove SQLite/handler, 48 regressioni esistenti su servizio,
normalizzazione, contesto e client, una suite HTTP reale sui tre percorsi e
le cinque prove richieste di concorrenza pazienti. La suite HTTP verifica
login reale, accessi rifiutati, attribuzione dell'evento, due richieste
concorrenti con un solo vincitore e ripetizione manuale senza duplicati.
Le richieste HTTP raggiungono un solo processo server: non sono una prova
a due server. Il 500 su ID già esistente resta comportamento preesistente;
non sono introdotti retry automatici o un nuovo contratto di replay.

Lint, tipi, build, never-regress, claims, OpenAPI drift, gate audit e controllo
del diff passano con Node 24.18.0. La review indipendente Astra Low non rileva
regressioni nel delta runtime; il coordinatore verifica separatamente le
prove del veto e gli hash. Il primo controllo never-regress aveva segnalato
un literal della fixture: corretto soltanto il test, senza cambiare il guard.

La prima suite integrata esegue 4.878 prove: 4.865 passate, zero fallite,
una annullata per timeout di 30 secondi nella UI AIFA e 12 skip. Tutte le nuove
prove passano, ma **la suite integrata non è ancora verde**. Il log è
conservato e il timeout è in diagnosi separata, senza attribuirlo per sola
vicinanza temporale alla nuova creazione o al carico concorrente.


Il run diagnostico con traccia Playwright conserva le stesse sorgenti:
AIFA passa in 29,68 secondi, ma falliscono per timeout la preparazione della
fixture Treatment portable runtime e la build isolata del producer Next.
L'esito è 4.864 passati, due falliti e 12 skip. Né questo esito né le prove
mirate verdi identificano la causa dei timeout.

Un solo esperimento con **lo stesso inventario e quattro processi test
concorrenti** passa tutte le 4.878 prove: **4.866 successi, zero errori,
zero annullamenti e 12 skip**, in 182,75 secondi. Il launcher diagnostico è
conservato fuori da Git; non modifica sorgenti, selezione, timeout o guard.
Questo è il risultato della configurazione esplicita, non un successo del
comando standard né una correzione dimostrata dell'instabilità C14.

Il coordinatore accetta il delta locale di creazione agli hash congelati,
con questa distinzione nelle ricevute e nel passaggio al Chief of Staff.
I fallimenti precedenti restano conservati; non si chiudono C14, C05 nel
suo insieme, qualificazione clinica o rilascio. Le prove browser della
milestone precedente non vengono ripetute: i tre file UI restano invariati.


## Delta separato WUL-694 — percorsi del pianificatore backup

Dopo il congelamento della creazione locale, il coordinatore integra i soli
`backup-scheduler-adapter.ts` e `backup-scheduler.test.ts` accettati dal Chief
nella lane parità. Gli hash coincidono con la consegna; tutti i file runtime
delle coorti precedenti restano invariati.

Il delta conserva letterali i caratteri speciali dei percorsi nei comandi
Windows, nelle unità systemd e nelle righe cron; valida i valori prima di
scrivere i file dei job. Non modifica runner, formato del backup, ripristino
o database clinico. Nell'integrato passano 15 test mirati, lint dei due file,
controllo tipi e build con Node 24.18.0/ABI 137. La suite completa non viene
rieseguita per questo delta separato; resta dichiarato il suo esito precedente
con concorrenza quattro e il debito dei timeout del comando standard.

Sono conservate e riusate le ricevute sintetiche già verificate dal Chief
su Windows 11 ARM64, Arch Linux ARM64 con systemd e macOS con launchd, ai
medesimi byte del candidato. Cron è provato con parser modellato e shell
reale, non con un daemon cron. Queste evidenze non qualificano Windows/Linux
x64, parità completa o il percorso integrale di backup e ripristino. Audit
e browser invariati non vengono ripetuti.


## Disposizione C14 del comando richiesto

Dopo la parità, il Chief ha dato priorità a questo residuo prima di altri
writer. La DoD WUL-729 è stata riletta dal tracker in sola lettura: stato
Backlog invariato, nessuna chiusura o esclusione di test.

L'inventario corrente del comando `test:unit` seleziona 564 file: 531 in
`lib`, 25 in `components` e otto script espliciti. Lo stesso wrapper è
richiamato da Web Core in CI. Non imposta la concorrenza: Node 24.18 usa
`max(availableParallelism()-1, 1)`, pari a 13 worker di file test sul Mac
osservato. La capacità effettiva del runner CI non è stata misurata. Cinque
file selezionati avviano Chromium con esbuild, uno esegue packaging/installazione
offline e uno una build Next. Non è una diagnosi causale dei timeout, e un
limite ai worker non limita automaticamente i loro processi figli.

### Correzione circoscritta della prova Treatment

La mappatura della traccia attraverso il loader immutato individua il
fallimento alla prima `runtime.prepare()`, prima dell'invocazione o del
lancio del figlio. La fixture assegnava 100 ms reali anche alla verifica
degli artefatti su disco: poteva quindi interrompersi prima di osservare
la proprietà indicata dal suo nome.

La sola prova della terminazione del figlio usa ora un timer controllato,
con gli stessi 100 ms; la preparazione continua a verificare gli artefatti
reali sintetici. Verifica assenza di kill a 99 ms, un solo kill a 100 ms,
nessuna conclusione o liberazione dello slot prima dell'evento di chiusura,
esito timeout e successiva acquisizione possibile. I test dei limiti reali
della fase di acquisizione restano invariati, così come runtime, provisioning,
loader, runner e workflow. Non è una misura delle prestazioni a tempo reale.

Passano 13/13 prove del modulo, tipi e lint. Un controllo positivo passa;
due mutazioni negative, mancato kill e conclusione anticipata, falliscono
sulle asserzioni previste. I primi tentativi dei soli mutanti avevano un
import relativo errato nell'harness: i log sono conservati e non sono stati
contati come rifiuti validi. Nessuna ulteriore suite completa è stata avviata
per cercare un verde.

### Decisione operativa e HOLD residui

**Il comando standard rimane invariato e in HOLD di affidabilità.** Il PASS
con quattro worker resta un risultato diagnostico dichiarato, non il nuovo
default e non una prova della causa. Una futura politica condivisa locale/CI
può limitare i worker a `min(4, max(availableParallelism()-1, 1))`, registrando
il valore effettivo. È una proposta di budget delle risorse, non applicata:
richiede capacità CI osservata, identico inventario/bootstrap e una verifica
limitata, definita in anticipo per un'ipotesi precisa. Non giustifica skip,
retry automatici, timeout maggiori o una dichiarazione di stabilità.

Il coordinatore core mantiene ownership dei tre HOLD:

- **AIFA:** il primo timeout non ha una traccia dei passi. Nel successivo run
  riuscito, 26,648 dei 29,677 secondi sono nell'avvio di Chromium. Lo sblocco
  richiede identificare il punto del fallimento in una nuova esecuzione
  motivata, con fasi di avvio/interazione/chiusura e relativa causa verificate;
  non basta un altro successo.
- **Producer Next:** la build isolata ha raggiunto 60 secondi nel run
  diagnostico; altri run passano in 6,45 e 43,76 secondi. Causa aperta.
  Lo sblocco richiede tempi delle fasi e prova della terminazione in una
  verifica mirata della stessa build, legata a un'ipotesi concreta, senza
  cambiare il limite o l'oracolo reale dei cookie.
- **Comando locale/CI:** lo sblocco richiede una configurazione condivisa
  dichiarata e verificata sui target effettivi, sullo snapshot identificato,
  mantenendo separati gli eventuali difetti intermittenti. Non si sommano
  successi di run diversi per produrre un unico PASS richiesto.

La disposizione e le ricevute sono conservate in `c14-runner-disposition`
nel run locale. Il censimento C14 completo e il precedente HOLD del selettore
nativo AnyDoc restano aperti e distinti da questa correzione.


## Milestone — ripristino amministrativo e tracce C14, 26 settembre 2026

Dopo l'accettazione della milestone C14, il Chief of Staff ha indicato la
coorte amministrativa C05/WUL-720. Roster congelato prima del codice: GET
elenco e POST `/api/system/restore-patient`, solo sessione Web admin. Nessun
chiamante UI corrente trovato nelle sorgenti tracciate; questo non prova
che la route non sia usata. Ripristino rete, riattivazione dall'archivio,
eliminazione definitiva e recupero da backup restano distinti e invariati.

La baseline SQLite reale ha rilevato due guasti audit (FAIL e IGNORE) con
risposta 200 e tombstone rimosso senza evento. Ha inoltre mostrato che un
bearer locale aggiunto alla sessione Web cambiava erroneamente la superficie
audit in `native`; JSON null produceva 500 senza effetti. Tutte le prove
precedenti sono conservate negli artefatti locali ignorati da Git.

Il candidato preserva il body con il solo `patientId`: nessuna nuova versione
attesa del client, receipt o autorizzazione. Nella stessa transazione
sincrona IMMEDIATE l'host legge stato/versione, verifica la riga, ripristina
il tombstone e scrive un solo audit obbligatorio. Fallimento o inserimento
ignorato annullano l'intera operazione; un UPDATE ignorato non diventa un
successo. Assente resta 404, attivo o richiesta ripetuta resta 409. Restano
identici figli, appartenenze, ciphertext e archiviazione. L'audit deriva
dalla sessione Web ammessa; JSON malformato/null/array/primitivo riceve 400.
ADR 0015 aggiornato prima del runtime; riusate le primitive esistenti.

Prove accettate: **23/23** handler/SQLite con rilettura da nuova connessione,
**1/1** scenario HTTP con cookie reale, GET prima/dopo, token-only rifiutato,
contesa `[200,409]` e riproposizione senza secondo evento; **5/5** confine
autorizzativo e **31/31** soft-delete. Il fingerprint della medesima lettura
amministrativa e stato spostato da `dbServer` a `tx`, mantenendo percorso,
query e molteplicità: nessuna nuova eccezione alla guardia. Il suo FAIL
iniziale e conservato. La prova HTTP riguarda un solo processo server;
i dinieghi dei diversi ruoli sono verificati nei test con seam di sessione.

Verifica integrata: lint, tipi, never-regress, claims, audit gate, build
Node 24.18.0/ABI 137 e **5/5** test di concorrenza pazienti passano. La prima
build ha rifiutato il percorso sintetico scelto dal coordinatore perché
superava il limite socket PM2 di 103 byte; ripetuta la sola build con root
fisica breve, senza modifiche al prodotto. Log originale e correzione
conservati. Suite completa **standard**: **4.905 test, 4.893 pass, 0 fail,
0 cancellati, 12 skip**, 80.554 ms. Inventario 565 file, incluso il nuovo
test amministrativo; runner, bootstrap, parallelismo predefinito e timeout
non sono stati allentati.

Le sole tracce test-only AIFA/Next, verificate prima su **4/4** test, sono
state integrate prima della suite richiesta. In questo run: primo Chromium
avviato in 578,7 ms, interazioni e chiusura osservate; Next producer build
3.827,8 ms, figlio diretto status 0, risposta cookie reale verificata,
chiusure HTTP/applicazione e rimozione fixture osservate. Non e una prova
sull'intero albero dei processi né un confronto controllato del carico.
**Questo PASS standard non dimostra la causa o la risoluzione dei timeout
precedenti.** Restano aperti i HOLD AIFA/Next, affidabilita locale/CI e
chooser nativo storico; cap4 resta una proposta non adottata. Nessuna nuova
full suite invariata e prevista per cercare ulteriori PASS.

Assegnazione: Sol Medium, unico writer amministrativo; Sol Medium in una
checkout distinta per le due tracce di test; Astra Low per review indipendente
read-only del delta e ADR. Il coordinatore ha deciso il contratto, verificato
hash/prove e integrato i risultati. Nessun difetto concreto nel runtime
riesaminato; rework circoscritto al fingerprint e al percorso della fixture
di build. Tempi per comando nelle ricevute; limiti d'account condivisi non
attribuibili alla coorte. Nessuna pubblicazione o chiusura globale C05/C14.

Raccordo parity: verificati direttamente **19/19** sorgenti OCR identici al
manifest consegnato dall'owner, senza importare altro codice. Le prove guest
e la loro accettazione restano di parity/Chief; il risultato riferito 5/6 e
il HOLD memoria Windows non sono una qualifica complessiva del prodotto.


### Raccordo della milestone amministrativa — proprieta del body

Il Chief ha verificato e accettato i 52 path della consegna precedente come
risultato locale di atomicita/audit, rilevando pero un requisito C05 non
soddisfatto: i test positivi accettavano proprieta estranee, inclusi `version`
e `expectedVersion`. La precedente scelta del coordinatore di conservare
questo comportamento non soddisfaceva la DoD sui campi non supportati.
L'accettazione precedente non diventa per questo una chiusura dell'input.

Stessa coorte, stesso writer Sol Medium e nessun altro servizio modificato:
il solo body ammesso contiene `patientId`; ogni altra proprieta propria
restituisce 400 prima di transazione o audit. Nessun CAS client introdotto.
Positivi con solo identificativo, anche con spazi da normalizzare, distinti
dalla prova degli header non autorevoli. Il contratto ADR e stato corretto
prima del codice, preservando il vecchio snapshot e le prove originali.

**29/29** test SQLite passano, inclusi sei campi propri vietati (anche il nome
`__proto__` in JSON), stato completo invariato da connessione riaperta e
sessioni negate prima di leggere il corpo. **1/1** scenario HTTP reale passa:
cinque proprieta vietate ricevono 400 senza effetti, poi il body ammesso
riesce conservando l'attribuzione Web anche con header aggiuntivi.
Lint specifico, tipi, never-regress, claims, audit gate e build Node24.18
passano. Il coordinatore ha verificato che il solo nuovo blocco runtime di
quattro righe precede la transazione: rimuovendolo si recupera esattamente
la route accettata nello snapshot52. Riutilizzate le prove immutate di
atomicita, guardie, concorrenza e altre superfici; nessuna nuova full suite.
Il PASS standard 4.893/4.905 resta attribuito allo snapshot precedente.

**Residuo byte budget al congelamento di questa sottofase:** la ricerca
delimitata non aveva trovato
un massimo governato per questo POST. `request.json()` e il parser di forma
non limitano i byte; il reader canonico `readBoundedJsonBody` esiste ma
richiede un massimo esplicito. I budget native/network, allegati, AI e il
buffering proxy Next non sono un contratto di rifiuto di questa route.
Proposta trasmessa al Chief, non implementata: tetto specifico di 65.536 byte,
reader condiviso in modalita `request-json` dopo l'ammissione Web admin,
413 prima di ogni scrittura per dimensione dichiarata o osservata eccedente,
prove di confine/chunk/multibyte/no-effects. E una nuova restrizione da
rendere esplicita, non una proprieta gia esistente; non stabilisce un limite
temporale di lettura. L'ingresso non e quindi dichiarato completamente
bounded e non viene chiusa C05. Snapshot47 della parity e snapshot52 della
prima consegna amministrativa restano immutati.


### Completamento del limite del body amministrativo

Il Chief ha concordato il massimo proposto di **65.536 byte (64 KiB)** come
nuova restrizione esplicita del solo POST `/api/system/restore-patient`.
ADR 0015 aggiornato prima del runtime, con compatibilita storica dichiarata:
non si attesta un censimento dei client reali. Stesso writer Sol Medium,
stessa coorte e nessun nuovo branch o servizio.

Il lettore canonico `readBoundedJsonBody` e usato in modalita `request-json`
dopo autenticazione e ruolo Web admin, con costante locale non esportata.
Il tetto vale per Content-Length dichiarato e byte effettivi; l'eccesso
produce 413, senza troncatura, transazione o audit. Forma JSON e proprieta
non ammesse restano 400. Il coordinatore ha confrontato direttamente le
sorgenti: GET, ammissione del POST e tutto il blocco dalla allowlist alla
transazione/audit sono identici alla sottofase precedente. Il reader
condiviso non e modificato. Nessun limite di durata o operazioni simultanee.

**33/33** test della route con SQLite reale e **20/20** del reader canonico
passano. Il confine esatto di 65.536 byte contiene un carattere UTF-8 diviso
tra chunk ed e ammesso. A 65.537 byte, con Content-Length assente o inferiore
al reale, la lettura si interrompe e il corpo viene cancellato al chunk che
supera il tetto. Un eccesso dichiarato e rifiutato senza prima lettura.
Le sessioni negate non accedono nemmeno ai getter headers/body della fixture;
i rifiuti conservano l'intero stato paziente, figli, appartenenze e audit,
riletto con una nuova connessione SQLite. **1/1** scenario HTTP con cookie
reale prova 413 senza effetti e il successivo ripristino ammesso con un solo
audit. Il caso HTTP usa un solo processo server; i ruoli negati usano seam
nei test della route.

Passano lint completo, typecheck, never-regress, claims, audit gate e build
Node 24.18.0. La build usa una root sintetica fisica breve, rimossa solo alla
fine del comando. Nessun rework del candidato consegnato. Prove di
atomicita/concorrenza gia accettate riusate; la suite completa standard non
e ripetuta su questo delta e il precedente 4.893/4.905 resta attribuito al
suo snapshot. La coorte amministrativa ora ha un tetto in byte verificato,
non un limite temporale, ne una chiusura globale C05/C14.

Nuovo snapshot separato di 52 path, con ricevute di ultimo writer e controllo
inverso della patch; i precedenti 47/52 path e le prove fallite rimangono
immutati. Il coordinatore conserva integrazione e accettazione; il seguito
viene raccordato con il Chief alla consegna. Nessuna modifica esterna,
pubblicazione o qualifica clinica. Tempi nei log; consumo d'account condiviso
non attribuito alla coorte. Gli HOLD storici C14 restano separati e aperti.

### Diario clinico ordinario: otto mutazioni, una sola autorita di scrittura

Il raccordo successivo con il Chief ha assegnato a C05 la famiglia diario:
POST/PUT/DELETE Web, POST/PUT/DELETE API v1 locale, POST/PUT paired network.
Roster e hash delle sette sorgenti iniziali congelati prima del codice;
normalizzatori condivisi e percorsi headless piu forti restano fuori scope.
Nella baseline 77 casi piu nove supplementari, tutti i 16 guasti audit
FAIL/IGNORE restituivano successo con voce modificata e nessun audit.
Questa e una caratterizzazione del difetto, non un risultato accettato.

ADR 0015 aggiornato prima dell'implementazione. Il Chief ha concordato due
decisioni esplicite: padre mancante/eliminato restituisce 404 su tutte le
otto mutazioni; le sei mutazioni locali introducono un limite JSON di
4.194.304 byte. Sono restrizioni dichiarate, non proprieta retroattivamente
attribuite a tutti gli handler, e non derivano da un censimento dei client.
Il padre solo archiviato rimane ammesso. Ripristinare una voce non ripristina
il paziente. Ruoli e scope continuano a precedere l'accesso non autorizzato;
la rete conserva il proprio limite e le esclusioni AI/documenti gia previste.

Due operazioni condivise racchiudono ammissione del padre, appartenenza di
rete, identita, currentness/CAS, modifica e un solo audit obbligatorio nella
medesima transazione IMMEDIATE. Un inserimento audit fallito o ignorato fa
rollback; anche un UPDATE ignorato dopo il match della versione e un errore,
non un falso successo. Il create locale duplicato restituisce 409; il replay
rete identico conserva 200 senza doppio audit, ma solo dopo ammissione
corrente del padre e dello scope. Gli identificativi validi restano opachi.

Il controllo input e specifico del diario: JSON/forma/campi invalidi sono
400, eccesso dichiarato o effettivo e 413 dopo autenticazione e prima degli
effetti. Non introduce timeout o limiti di operazioni simultanee. Versioni
intere sicure, date numeriche finite storiche, cifratura e formati strutturati
sono preservati. I timestamp inviati dagli attuali form locali restano
compatibili; createdAt memorizzato rimane dell'host. L'audit Web non assume
l'identita native in presenza di bearer o header aggiuntivi.

Le prove del candidato comprendono **151/151** casi SQLite con riapertura
readonly, **22/22** reader canonico e versioni, **1/1** suite HTTP locale
cookie/token e **1/1** suite paired reale. L'ordinazione padre/voce e stata
verificata in due processi e connessioni SQLite: padre prima significa 404
senza voce/audit; voce prima significa voce e audit persistenti anche dopo
il tombstone del padre. Sono prove dell'operazione condivisa con gate
sintetico SQLite, non un test HTTP di tutte le otto gare o una misura del
tempo di blocco del database.

Il form Web reale ha superato **1/1** caso Chromium: create, reload,
cancellazione motivata, ripristino e nuova rilettura. Il probe separato
readonly conferma versione 3 attiva, contenuto ENC, appartenenza conservata
e un solo evento per create/delete/update. Nessuna modifica dell'interfaccia.
La prima lettura finale era stata fermata dal prefisso di sicurezza del
probe, non aggiornato dal coordinatore insieme alla root temporanea breve:
corretto il solo harness e ripetuto il solo probe, non il browser gia passato.

Le suite HTTP legacy invariate hanno rilevato una regressione del messaggio
di errore DELETE: `Invalid date` al posto di `Invalid deletedAt`. Corretto
il solo literal e aggiunti **2/2** casi Web/v1 con payload esatto e no-effects;
poi le sette prove legacy/v1 sul collector integrato passano **7/7**.
Il primo 6/7 e le tre correzioni iniziali del harness del writer restano
conservati. Nessun test preesistente e stato modificato per ottenere il verde.

Sol Medium e stato l'unico writer runtime/test; un secondo Sol ha preparato
la prova UI e raccolto il roster. Astra Low ha eseguito review indipendente
dei confini e del candidato. Il coordinatore mantiene contratto, integrazione
e accettazione. La review ha individuato anche un falso positivo del nuovo
guard statico (mutazione solo in callback non eseguita): corretto seguendo
la catena diretta fino a run(), con controprova dedicata. Il guard collega
ora le otto route al writer transazionale, senza pretendere di dimostrare
staticamente scope/CAS o cifratura. Nessun difetto runtime bloccante emerso
nella review; il successivo delta del messaggio e stato verificato per hash
dal coordinatore. Le prove con dati sintetici non qualificano l'uso clinico.

Passano lint, tipi, never-regress, claims, audit gate e build del candidato;
OpenAPI 1.27.0 allinea le risposte gia presenti e documenta il contratto.
La prima suite standard integrata conta 5.069 casi: 5.055 passati, due
falliti e 12 skip. I soli due positivi delle route diario rete incontravano
lo stub di dipendenza del test invece del nuovo helper entryJsonObject.
Adattato il caricamento alle tre sorgenti reali esplicite, senza cambiare
roster, cap, asserzioni o runtime; la suite mirata passa **31/31**. Il primo
risultato resta conservato. La ripetizione completa segue questa correzione
concreta, non un tentativo su sorgenti immutate per cercare un verde.
La verifica standard finale conta **5.069 casi: 5.057 passati, zero errori o
cancellazioni, 12 skip**. Non cambia concorrenza o soglie e non risolve per
inferenza gli HOLD storici. La build finale del collector e registrata
nella ricevuta finale di questa coorte. I precedenti snapshot 47/52 e gli
HOLD C14 restano immutati. Nessun commit, pubblicazione o mutazione tracker.

### Delta separato delle etichette delle scorciatoie

Dopo il congelamento del diario, il Chief ha accettato e il coordinatore ha
integrato soltanto due file della lane parity: indicazione `⌘/Ctrl + K` nei
comandi e nella ricerca impostazioni, con testo su una riga. Handler invariati.
Riutilizzate le prove reali Mac e Linux, un caso per target: apertura singola
da scorciatoia/click, focus ed Escape. I controlli della checkout isolata
sono conservati; nessuna ripetizione del CRUD o della suite completa per
questo delta testuale. Windows resta separato e non qualificato qui.
Due POST impostazioni con JSON vuoto nel log Linux vicino a reload/shutdown
rimangono un limite osservato a causa non stabilita; questa prova non qualifica
la persistenza delle impostazioni. Il nuovo snapshot conserva separatamente
il precedente congelamento del diario e le ricevute dei due file.
