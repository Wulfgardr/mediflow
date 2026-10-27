# Cambio di stato della terapia: modello legacy e prove del comando durevole

Il TLC in questa directory conserva il modello ADR0156 del percorso PUT legacy,
ora raggiunto dalla UI soltanto per recuperare marker precedenti. Il consumer
ordinario di TherapyManager usa invece ADR0168 e il controller durevole:
`verify:therapy-status` esegue anche i suoi test causali e le gare/crash SQLite.
Il test di composizione controlla il consumer reale e impedisce di ripristinare
implicitamente una PUT dal nuovo controller. Le proprietà del nuovo ledger non
sono una prova TLA né un'estensione implicita degli invarianti legacy sottostanti.

Il recovery cifrato supporta lo schema corrente 6 e i predecessori canonici 4 e 5; le 24 prove di compatibilità sono esterne a TLC, che non copre schema, migrazione, cifratura o ricevute. Restano aperte la verifica verticale Rust-host e quella della GUI.

## Raccordo della copertura al 26 ottobre 2026

`coverage.json.syncCommit` identifica ora la revisione del runtime riesaminata
`c4ae8c6eab6966e40414457ae3b666ac618154e8`; `legacyModelSyncCommit` conserva
`64e190438da8287928f0903b9b719c18b329a7ec` come precedente riferimento del modello
legacy. Le altre impronte coperte restano invariate: il delta rispetto a b806
cambia soltanto il validatore del predecessore recovery cifrato v4.
Il confronto ora rifiuta anche tabelle estranee invece di ignorarle. Non cambia
transizioni, guardie, await, CAS o audit del controller.

`StorageRestored` e `Recover` nel TLC riguardano leggibilità e recupero del
marker browser, non il ripristino del database o l'ammissione del suo schema.
Schema, migrazione, cifratura, chiavi e ricevute durevoli restano fuori dal TLC.
Il pin del validatore è un controllo di deriva con riesame manuale; non rende
quelle proprietà modellate. `durableProtocolCoverage.recoveryCompatibility`
registra questo confine e la revisione del confronto.

`code-current` esegue anche gli otto test causali del validatore: ammissione del
canonico v4 con impronta immutabile e byte invariati; diniego di tabella estranea,
colonna, indice, trigger, vista, versione falsa e v5 senza ledger. Il test è anche
in `verificationInputs`. Le prove cifrate del percorso owner restano evidenza
separata: verificano originale/destinazione e conservazione delle estensioni nel
backup fisico corrente v5. Il verifier generico non aggiunge quel carico né il
caso da257MiB. Modello, configurazione, invarianti, limiti, testimoni e mutanti
TLC restano identici.

Il primo gesto legacy apre una conferma sul paziente, sulla terapia e sulla versione
mostrati. Solo la conferma può iniziare una PUT CAS. Se il browser interrompe
l'attesa, il server può ancora scrivere: una GET alla vecchia versione non
basta per consentire un nuovo intento.

Lo [statechart](./statechart.mmd) descrive il controller Web e l'host separati.
La [lettura interattiva offline](./traces.html) presenta pochi ordini di eventi,
con parole del dominio, senza dati reali né dipendenze di rete. Il diagramma
include anche comportamenti controllati dai test e non astratti nel modello.
La decisione di prodotto rimane [ADR 0156](../../adr/0156-therapy-status-uncertain-client-write.md),
Accepted dal 2026-10-21 dopo la review indipendente completa sulla PR #591 (revisione `399265ffa`).

## Eseguire

Servono Node 24, le dipendenze npm del progetto e Java già installato (provato
con Temurin 25.0.2; Java 17 o superiore è il requisito di questo comando).

```sh
npm run verify:therapy-status
```

Il runner scarica soltanto l'artefatto ufficiale `tla2tools.jar`, release
[v1.7.4](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4), e ne controlla
SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`.
Il digest è stato calcolato sul download HTTPS ufficiale: l'API della release
non forniva un digest. Il record distingue la release Tools `1.7.4` dal verificatore incluso,
`TLC 2.19` (build 2024-08-08, revisione `5a47802`): sono nomenclature diverse
dello stesso artefatto. SHA-1 osservato:
`bee4a54f3ee3d4afc347c3240ec2d9e93b075104`.
Il JAR vive in `~/.cache/mediflow-formal/tla/v1.7.4`, fuori da Git; cache valida
permette esecuzioni offline. `MEDIFLOW_TLA_CACHE` può scegliere un'altra cache.
Non viene modificato Java di sistema.

Ogni esecuzione conserva configurazioni, log, controesempi e `result.json` in
una nuova directory temporanea esterna al checkout. Per conservarli altrove,
impostare `MEDIFLOW_FORMAL_OUTPUT_DIR` su una directory nuova fuori da repository,
Documents e Desktop. Il runner crea lì anche `MEDIFLOW_DATA_DIR` sintetica e
imposta `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`. Non legge né copia il DB reale.
I file di esecuzione non vengono cancellati automaticamente.

Il comando verifica la copertura dichiarata, esegue TLC sul modello corrente,
3 controlli negativi del modello e 6 testimoni di raggiungibilità; poi esegue
i test reali del controller e della route HTTP autenticata/ApiTable, 2 mutazioni
isolate del controller e il controller originale dopo le mutazioni. Un rosso
atteso richiede l'invariante preciso e una traccia TLC, oppure un'asserzione
comportamentale del test. Errori di parser, import, timeout o tool non valgono.
Web Core esegue lo stesso comando prima della build, solo quando il diff CI
tocca una superficie coperta o un input di verifica elencato nel record. Il range
arriva tramite `MEDIFLOW_FORMAL_BASE_REF`; base mancante/non valida o diff non
leggibile fanno eseguire il controllo completo. In locale senza quella variabile
il controllo è sempre completo. Non si aggiunge un workflow separato. I test `.test.ts` restano nella selezione unit
esistente; il runner non è un test scoperto tramite naming.

## Proprietà e danno evitato

| Invariante | Promessa e danno evitato |
| --- | --- |
| `NoWriteWithoutConfirmation` | Nessuna richiesta host generata dal controller senza conferma esplicita: evita una modifica clinica al primo gesto. |
| `NoNewIntentWhileApplicable` | Non apre un nuovo intento quando una vecchia richiesta può ancora superare la CAS: evita che il medico agisca su un esito che crede annullato. |
| `NoUnprovedRegistration` | `Registrata` richiede risposta positiva, conferma ancora in memoria, stato coerente e versione osservata avanzata: evita una falsa conferma di salvataggio. |
| `AdmissionIsNotUncertain` | Il fallimento del nuovo claim prima dell'invio è `unavailable`: evita di far credere che sia partita una nuova PUT. Un marker recuperato può invece essere ignoto anche se il processo che sapeva di non aver inviato è scomparso. |
| `OldOwnerPreservesMarker` | Una rimozione del vecchio owner non elimina il marker di un altro attemptID: evita uno sblocco mentre una richiesta diversa resta irrisolta. |

Gli invarianti si applicano al modello finito, non direttamente al TypeScript.
Il collegamento al codice è manuale e qualificato con test comportamentali,
mutazioni reali isolate e controllo di deriva; non è una prova di raffinamento.

## Limiti e ipotesi esplicite

I limiti macchina sono in [coverage.json](./coverage.json): 2 client/tab nello
stesso profilo e origine, 1 archivio, 1 paziente, 1 terapia, 2 tentativi totali
(compresi i claim falliti), stato iniziale `active`, target `suspended` o
`completed`. `active` come nuovo target è simmetrico per le proprietà scelte,
ma non viene esplorato come gesto. Versioni positive monotone, al massimo 5;
nessun riuso degli attemptID. Un writer esterno può incrementare la versione
fino a 3, anche senza cambiare lo stato. I due tentativi possono incrementarla
ancora. Un processo TLC usa un worker, heap di 512 MiB e timeout di 300 secondi;
lo stato su disco è esterno a Git. La simmetria scambia soltanto i nomi dei due
client e riduce gli stati duplicati; non identifica i tentativi o le versioni. Il timeout è un errore, mai un risultato verde. TLC usa fingerprint finiti: non è
una dimostrazione matematica senza possibilità di collisioni.

Web Locks rende atomici solo lettura/claim, settle e remove nel callback
sincrono del registro; non l'intero controller. Il marker persiste fra remount,
e storage illeggibile blocca. `StorageRestored` rappresenta il ritorno della
leggibilità dello stesso contenuto, non cancellazione o riparazione inventata.
Il modello assume integrità dello storage: manomissione, cancellazione,
profili/origini diversi e perdita completa della cache non sono coperti.
Il latch di generazione archivio e il contesto paziente/sessione validi sono
precondizioni, protette anche da test; non si modellano più archivi/sessioni.

L'host è autorevole: CAS e audit sono una transazione indivisibile, le versioni
non tornano indietro, un rifiuto autorevole non committa quella richiesta. Un
abort client non cambia `attempt.host`. La GET campiona la versione host in
`GetStart` e può arrivare dopo un commit; non inventa versioni future.
Lo stato osservato dal client resta distinto dalla verità host.

La coerenza del modello riguarda lo stato della terapia. Nomi, dosi, cifratura,
identità/autorizzazione, endDate e messaggi UI non sono domini TLC: i test reali
coprono i controlli di dose/paziente/campi bloccati e i confini HTTP. `GetFailure`
astrae lettura negata/non valida. Non si modellano tutte le eccezioni del lock
alla risoluzione post-invio, ogni microtask del trasporto o tutte le risposte
positive tardive dopo timeout: i test del controller le affiancano. Remount
azzera l'intento; la richiesta host sopravvive. La rimozione già decisa può
intercalarsi con una seconda tab e con un nuovo marker. Il rimontaggio TLC
è esplorato dopo dispatch, su unavailable e su conferma/terminali; non esplora
direttamente ogni rimontaggio fra claim e dispatch o callback di owner smontati
a metà lettura. I test di generazione/sessione affiancano questo confine.

Nessuna fairness o liveness è dichiarata. Esito ignoto e versione invariata
possono rimanere bloccati indefinitamente. Non si dimostrano idempotenza
universale, audit/cifratura completi, correttezza dell'app intera, qualificazione
clinica o funzionamento su un'installazione reale.

## Dal modello al codice

Il 27 ottobre 2026, PR #684, è stato riesaminato il diff di
`components/therapy-manager.tsx` fra il precedente `coverage.json.syncCommit`
`719509e92f81c15adc1e8abb9beb82740615c27e` e
`3c3529729a74a7cd0be82ef3290715d0fa5fb7ec`. Cambiano soltanto le due etichette
dell'età passate a `statusChange.recover` e `statusChange.begin`: il conteggio
usa `formatCountLabel(age, 'anno', 'anni')` e conserva la guardia
`Number.isFinite(age)` e il testo per l'età non disponibile. Non cambiano
transizioni, guardie, confini degli await, CAS, audit, altri writer o assunzioni.
Modello, statechart, invarianti e limiti restano invariati. Dopo questo riesame
sono stati aggiornati manualmente soltanto l'impronta del manager e `syncCommit`
alla revisione riesaminata. Il comando completo `npm run verify:therapy-status`
è passato su Node 24.22.0: TLC corrente con 5.903.794 stati distinti e coda
vuota, 3 controlli negativi del modello, 6 testimoni, 122 test reali,
2 mutazioni del controller e 29 test del controller ripristinato.

Gli stati interni `claiming/admitted` corrispondono alla UI `writing` prima
dell’invio; `get/removing/publishing` alle fasi della UI `reading`. Il modello
unisce `conflict/rejected` nel rifiuto autorevole (entrambi impediscono
l’attribuzione di `Registrata`) e i motivi di `unavailable` nel blocco di
disponibilità. Non unisce la verità host al risultato del fetch.

Commit di sincronizzazione del runtime:
`dc9bcbf12cdd990b34676e3136be4cf412a3cd16`. Il file di copertura fissa gli hash
completi delle superfici lette; il runtime non viene modificato da questo lavoro.

Il 22 ottobre 2026, PR #617 (`9ff52b5f822a24c2996ab11b1e5d84ed1c51dbc8`),
è stato riesaminato e aggiornato soltanto l'hash di `components/therapy-manager.tsx`.
Rispetto al commit di sincronizzazione cambia solo la presentazione dei dettagli
di riga (`details` → `Disclosure`, con lo stesso contenuto già montato). Non
cambiano comandi, conferma, CAS, recupero, audit, transizioni o assunzioni del
modello. Prima dell'aggiornamento sono passati TLC sul modello corrente
(5.903.794 stati distinti, coda vuota) e i 48 test del controller e della route.
Il gate completo conserva invarianti, limiti, testimoni e controlli negativi.

Il 23 ottobre 2026, revisione `2e73fe52f9a0cd021677cedac69745a1a8db81b3`, è stata riesaminata
la composizione di Terapie. Titolo, contatori e creazione appartengono ora
alla stessa sezione; i comandi meno frequenti passano nel menu comune.
Le azioni disponibili per ciascuno stato e i relativi handler restano gli
stessi: nessuna eliminazione o modifica è aggiunta alle righe sospese o concluse.
Il form conserva la bozza; la soglia rimane montata e usa un ruolo secondario
quando l'invio del form occupa il ruolo principale.

Il collegamento alle porte e i callback di conferma, CAS, recupero, audit e
transizioni fino a `handleSoftDelete` restano quelli di main `64e190438`.
Il manager aggiunge un riferimento al form e un effetto di layout che porta
il fuoco al primo campo quando si apre una bozza o si cambia terapia in modifica;
l'effetto non invoca porte di lettura o scrittura. Sono stati riesaminati anche
i callback JSX e le guardie dei
comandi spostati: cambia la collocazione, non il comportamento. I componenti
comuni non invocano l'azione all'apertura del menu. Modello, statechart,
limiti e proprietà non cambiano. Prima dell'aggiornamento manuale della copertura
sono passati TLC corrente (28.149.669 stati generati, 5.903.794 distinti,
profondità 36, coda vuota) e tutti i 48 test controller/HTTP su Node 24.21.0.
Il record usa come `syncCommit` la base di main
`64e190438da8287928f0903b9b719c18b329a7ec`, che resta nella storia dopo lo squash;
`2e73fe52f9a0cd021677cedac69745a1a8db81b3` identifica la revisione riesaminata
della composizione. La voce di menu «Elimina (inserita per errore)» conserva
il vincolo d'uso nel testo visibile e nel nome accessibile; conferma e recupero
restano invariati. L'apertura di una bozza porta anche `defaultOpen` a true,
sia per nuova terapia sia per modifica: il form diventa visibile se la sezione
era chiusa. Cambia soltanto la visibilità del contenitore e non i comandi di
scrittura. Si aggiorna solo l'hash del manager fra le superfici coperte;
il comando completo viene rieseguito dopo l'aggiornamento.

| Azione TLC / confine | Implementazione letta |
| --- | --- |
| `Begin`, `Cancel`, `Confirm` | [controller](../../../lib/therapy-status-confirmation.ts), [`begin/cancel/confirm`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L219): copia contesto, guardie, generazione; nessun `write` in `begin`. |
| `Claim`, `ClaimFailure`, `ClaimCompletionFailure`, `Dispatch` | [`await journal.claim`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L245), controllo corrente/segnale dopo l'attesa, quindi `ports.write`. Un errore anche dopo la persistenza può lasciare un marker certamente non inviato noto solo in memoria. |
| `Receive`, `Settle`, `Deliver` | [Risposta `ports.write`, `await journal.settle`, continuazione di `Promise.race`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L267): sono passi separati; settle controlla l'identità del marker. |
| `LoseResponse`, `Host`, `HostReject` | Abort/timeout client separato dalla [PUT Web](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/app/api/therapies/%5Bid%5D/route.ts#L19) e da [updateTherapyOperation](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-write-operation.ts#L58): CAS, incremento e audit nella transazione IMMEDIATE. |
| `GetStart`, `GetReturn`, `GetFailure` | [`reread`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L132): GET autorizzata; dopo `await read` controlla contesto e marker, confronta versione e rifiuto autorevole; nessun write. |
| `Remove`, `Publish` | [`await journal.remove`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L155) sotto lock con attemptID, poi controlli corrente/segnale e pubblicazione `registered/reviewed`; i passi non sono atomici insieme. |
| `Remount`, `Recover` | [`dispose`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L218), nuovo controller e `recover/restore`: perde intento e attribuzione; conserva il marker. |
| `RecheckCleanup`, `RecheckInspect` | [`recheck`](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/therapy-status-confirmation.ts#L190): rimuove solo il proprio marker noto non inviato, attende inspect/lettura/inspect; senza marker torna alla scheda, altrimenti recupera senza retry. Le attese fra inspect sono astratte come possibili cambi del marker prima dell'inspect finale. |
| `OtherWriter` | Writer esterno alla barriera browser; resta soggetto alla CAS host. Nessun nuovo endpoint. |

[therapy-manager](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/components/therapy-manager.tsx#L84) collega il controller
all'UI e alle porte reali; [ApiTable.update](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/db.ts#L499) attende cifratura,
fetch e parsing del rifiuto; il [fence del trasporto](https://github.com/Wulfgardr/mediflow/blob/dc9bcbf12cdd990b34676e3136be4cf412a3cd16/lib/security/client-auth-api.ts#L453)
propaga segnali e generazione archivio. L'ammissione HTTP prima della CAS non
rende annullabile la transazione se il client abortisce.

## Controesempi e collegamento ai test

`AbortUnlock=TRUE` risolve erroneamente una lettura alla stessa versione.
TLC trova: `Begin → Confirm → Claim → Dispatch → LoseResponse → GetStart(v1)
→ GetReturn → Remove → Begin` dell'altra tab, mentre la vecchia CAS v1 è ancora
applicabile. Il server può committare dopo. Il modello corretto conserva il marker.
Il runner muta lo stesso confronto nel controller (`>` diventa `>=`), e il test
`client abort before server commit keeps same-version readback unresolved`
fallisce con `reviewed` invece di `uncertain`. Il source reale non viene editato:
si usa una copia temporanea, con il solo import della guardia puntato al file
originale. Questo è un controllo semantico della regressione, non una ricostruzione
byte per byte del controller storico.

`AdmissionUncertain=TRUE` classifica un claim fallito come esito ignoto; TLC
viola `AdmissionIsNotUncertain`. La mutazione corrispondente nel controller è
rilevata dai test `P2 admission failure`: nessuna PUT, ma fase errata `uncertain`
invece di `unavailable`. `OwnerBlindRemove=TRUE` rimuove il marker senza verificare
attemptID: TLC trova la cancellazione di un marker differente. Il test reale
`archive namespaces, stale owners and marker minimization` e i test P2 della
rimozione conservativa esercitano il registro autentico.

I 6 invarianti negati di raggiungibilità devono fallire con un testimone:
`registered`, rifiuto autorevole, ammissione non inviata, GET stessa versione con
CAS ancora pendente, recupero che porta al confronto e vecchia rimozione con un
marker sostitutivo presente. Non si accetta una ricerca vuota o interrotta.

Il test aggiunto `formal trace: a GET sampled before late host commit stays
uncertain across two owners` esercita anche il ritorno tardivo di una GET vecchia:
resta bloccato, quindi una nuova GET avanzata apre il confronto, senza attribuire
il commit all'owner recuperato. I due test `HTTP abort settles the real client
before the admitted host write; intervening no-op=…` usano ApiTable, HTTP loopback,
route autenticata e CAS/audit reali su SQLite sintetico: tengono la route prima
della CAS, interrompono il fetch, leggono la vecchia versione, verificano blocco
e recupero, poi liberano il writer. Nel ramo no-op il writer tardivo riceve 409;
nell'altro committa con un solo audit. Sono eseguiti dal comando corrente.

La riproduzione storica sul controller `00673251bd40854b6a2832a964f842d9e30eabba`
è evidenza precedente riusata: gli stessi due ordini HTTP avevano dato `reviewed`
invece di `uncertain`, 2 asserzioni fallite. Anche i rossi P2 su `bbf3ebe…` sono
precedenti, non nuovi run di questo contributo. Nessun nuovo difetto del prodotto
è stato dedotto soltanto da un mutante.

## Esito osservato (2026-10-21)

Sul runtime sincronizzato a `dc9bcbf…`, il comando ha completato TLC con
28.149.669 stati generati, 5.903.794 distinti, profondità 36 e coda finale vuota:
i 5 invarianti non hanno violazioni nel limite dichiarato. Una prima esecuzione
con polinomio fingerprint 0 e una seconda con 37 hanno gli stessi conteggi;
la seconda è il default riproducibile. La prima stima basata sui fingerprint
osservati era più pessimistica della stima teorica: il secondo run è un controllo
aggiuntivo di quella specifica incertezza, non una prova illimitata.

Il run finale corrente ha richiesto circa 107 secondi per TLC e 117 secondi
complessivi dei processi del comando su macOS, Node 24.21.0 e Temurin 25.0.2.
Heap TLC fissato a 512 MiB, un worker; il campione RSS osservato in un run era
circa 563 MiB, non una misura del picco. I 3 mutanti del modello e i 6 testimoni
hanno dato il rosso atteso (violazione identificata e controesempio); le
2 mutazioni isolate del controller hanno fallito su asserzioni comportamentali.
I test controller/HTTP sono 48 verdi, compresi i due casi HTTP; il controller
originale dopo le mutazioni è 29/29 verde. Lint, typecheck, selezione dei test e
claims guard sono verdi. Le 5 tracce HTML sono state percorse nei 24 passi e
ispezionate a larghezza 728 e 390 px, senza richieste di rete.

Non è emerso un nuovo bug riprodotto sul runtime corrente: sono stati riscoperti
i controlli negativi delle regressioni note. Runtime e UI non sono cambiati.
Non sono state ripetute le suite E2E complete; le evidenze precedenti restano
limitate alle loro revisioni. Build di produzione, CI remota, installazione,
review indipendente e accettazione non sono esiti di questo contributo.

## Manutenzione

Quando cambia una superficie coperta, il comando si ferma prima di TLC con
`Formal coverage drift`. Confrontare il diff con il commit di sincronizzazione,
comprese funzioni spostate e altri writer. Riesaminare transizioni, guardie,
confini degli await e assunzioni; aggiornare modello, statechart e test pertinenti.
Solo dopo una review esplicita della corrispondenza aggiornare manualmente gli
hash e il commit in `coverage.json`, quindi rieseguire il comando completo.
Non esiste un comando di auto-rehash: un hash aggiornato da solo non qualifica
il collegamento. Se cambia una proprietà, documentare la modifica intenzionale
del contratto. Conservare i difetti aperti e qualificare nuovamente le mutazioni.

Le fonti di metodo sono [pstack, commit fissato](https://github.com/cursor/plugins/blob/7b353f78f6ec193bdbe48ed8059444eb09b6878e/pstack/skills/create-formal-verification-skill/SKILL.md),
la [vista di TLA+](https://lamport.azurewebsites.net/tla/high-level-view.html) e
la [descrizione degli strumenti](https://lamport.azurewebsites.net/tla/tools.html).
Il modello è un'astrazione manuale sopra il codice, coerente con questo uso di TLC.
