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
| Creazione, eliminazione, ripristino paziente e manutenzione orfani | Evidenza clinica obbligatoria. DELETE Web/v1 e famiglia create/delete/restore rete migrati nel candidato locale; creazione locale, ripristino amministrativo e manutenzione restano separati. |
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
