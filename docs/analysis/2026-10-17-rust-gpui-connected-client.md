# MediFlow Rust / GPUI collegato: interfaccia e confronto old/new

Data: 17 ottobre 2026. Candidato della [PR 558](https://github.com/Wulfgardr/mediflow/pull/558).
Issue: [WUL-706](https://linear.app/wulfgardr/issue/WUL-706),
[WUL-714](https://linear.app/wulfgardr/issue/WUL-714).
Decisione proposta: [ADR 0145](../adr/0145-rust-gpui-connected-client.md).

## Risultato e perimetro

Il comando normale del workspace apre ora un client GPUI collegato al
servizio MediFlow: accesso v3, ambulatori ammessi, dati clinici cifrati reali,
letture e scritture attraverso il writer esistente. Il precedente servizio
in memoria è rimasto soltanto dietro `--demo`. Il
[README operativo](../../experiments/gpui-patient-pilot/README.md) descrive
avvio, credenziali, tastiera, dipendenze e ripristino.

La richiesta di Leonardo estende il lavoro dalla singola scheda alla
coerenza di tutto il prodotto. Il riferimento è la release 0.9.0 insieme al
contratto visuale accettato, non l'aspetto provvisorio del primo pilota.
Questo verbale separa funzioni implementate, prove osservate e criteri di
sostituzione ancora aperti. Un collegamento al client corrente non viene
conteggiato come funzione GPUI migrata.

Il trasporto Rust non apre SQLite. Autorizzazione, audit, generazione,
controllo della versione e commit restano nel servizio Node. Il confine
mantiene un solo writer nel percorso collegato e permette di verificare il
client prima del successivo spostamento dell'autorità. Non conclude per
implicazione il censimento dell'autorità Swift locale opzionale, il
supervisore, IPC/FFI o il passaggio dell'intero core a Rust.

## Revisioni e prove riproducibili

| Oggetto | Identità |
| --- | --- |
| Release di confronto | `v0.9.0`, commit `9c7b3adf2eb18551b7c03b61e0fa6ee2303d31d0` |
| Base di integrazione | `3d4e5f0ffff8367c5be0bb73c62665b7e2eab1af` |
| Base del worktree delle prove locali | `d0cd18f1b4d1e96ac37712415ae9b42fd059d062`; i manifest delle prove identificano il delta effettivo |
| GPUI e backend | Zed `56934ec0560bce8929025497411de7f5322fb6ca` |
| Rust / Node locali | Rust 1.98.1; Node 24.19.0; npm 11.9.0 |
| Corpus di lettura | SHA-256 canonico `856df9e282cc803e63d81c45064b2d564fc685381affbba08f4c2d4f65e73b36` |
| Fixture scritture risorse | SHA-256 canonico `5a3bbfa8fb1b4054afaaa1dfa5ba5f4ee04f2d615626c6d18abe803f168e5103` |
| Fixture anagrafica | SHA-256 canonico `cc896ab2e91df4843dedb8acbd27eea4ade19031e6c50ab7c462e2f4df6eb3b4` |

La [ricevuta completa](../../experiments/gpui-patient-pilot/evidence/connected/paired-v3-final-run/receipt.json)
e il relativo [manifest dei sorgenti del servizio](../../experiments/gpui-patient-pilot/evidence/connected/paired-v3-final-run/source-manifest.json)
registrano hash del probe ottimizzato, sorgenti copiati, dipendenze,
protocollo, risultati, ordine delle misure e ritiro dell'archivio temporaneo.
Gli hash canonici ordinano ricorsivamente le chiavi JSON; non sono hash dei
byte formattati del file. Le ricevute storiche restano immutate e datate.

## Canoni mantenuti e correzioni dell'interfaccia

I riferimenti sono [DESIGN.md](../../DESIGN.md),
[ADR 0144](../adr/0144-punto-inchiostro.md), la
[specifica Punto d'inchiostro](../design/punto-inchiostro/01-specifica.md) e
la [mappa delle 17 schermate](../design/punto-inchiostro/02-piattaforme-e-schermate.md).
Il tema Rust legge direttamente i token runtime
`docs/design/lume/tokens/lume.tokens.json`, dove il tema corrente è stato
integrato. Il JSON del vecchio banco statico non sostituisce questi valori.

| Aspetto | Applicazione nel client collegato |
| --- | --- |
| Gerarchia clinica | Identità persistente; disponibilità delle allergie esplicita; quadro, diario e soglia della registrazione. |
| Tipografia | Newsreader per testate, anteprima e prosa; font di sistema per controlli, valori e righe di tabella; IBM Plex Mono soltanto per codici. |
| Geometria | Piano opaco, filetti fra righe, raggi di piattaforma, colonne che diventano una in larghezza compatta. |
| Navigazione | Pazienti, Agenda, Diario, Repertori, Analisi, Scale, Impostazioni; le superfici ancora nel prodotto corrente sono dichiarate. |
| Asset | Font locali, marchio MediFlow della repository e tracciati Lucide della stessa famiglia del Web con licenze conservate. |
| Temi e ingrandimento | Giorno, Grafite, aspetto di sistema, contrasto aumentato e dimensioni del testo fino al 400%; le verifiche di layout sono distinte dalla qualifica con lettore di schermo. |
| Accesso | Due passaggi, collegamento del dispositivo e accesso del medico; il primo non dichiara una connessione già verificata. |
| Testo clinico | Blocchi, liste, enfasi e barrato conservano significato in lettura e copia; l'HTML precedente non viene sostituito implicitamente da un testo semplificato. |
| Registrazione | Bozza nominata, revisione e conferma distinte, un solo invio; esito positivo soltanto dopo rilettura esatta. |

La prova della finestra ha individuato regressioni concrete di presentazione:
l'accesso iniziale disponeva l'ultimo comando fuori dalla prima viewport;
una lista annidata del diario perdeva il separatore fra due righe. Le
correzioni sono state applicate all'accesso in due passaggi e al nuovo
renderer del testo clinico. Su Linux la sola font variabile incorporata non
forniva a GPUI le facce bold/italic richieste: ora sono incluse quattro
varianti statiche reali, Regular, Bold, Italic e Bold Italic, con Newsreader
1.003 e asse ottico 18. La font Web è invariata. Il
[manifest delle font](../../app/fonts/Newsreader-Native.manifest.json)
registra sorgenti ufficiali, commit, licenza e hash; lo script di generazione
con FontTools 4.61.1 è stato verificato in un secondo processo con byte identici.
La review ha trovato inoltre una richiesta
`text_for_range` che poteva restituire il contenuto di un campo segreto al
servizio input nativo: ora risponde senza testo e ha una regressione dedicata.

Il modello corrente non espone sesso o un campo strutturato per allergie.
La UI non inventa tali dati e non trasforma un valore assente in un segnale
clinico negativo. Un errore di decrittazione è distinto da una stringa vuota.
Il carattere emoji è fornito dal desktop: nella prova Linux è stato
installato Noto Color Emoji per verificare il simbolo del corpus. I font del
prodotto non incorporano tutti i glifi Unicode.

## Copertura delle schermate

Questa matrice segue la mappa del prodotto; descrive funzionalità effettiva,
non una percentuale ricavata dal numero di pulsanti.

| Schermata | Copertura candidata e limite |
| --- | --- |
| Sblocco | Accesso paired v3, frase segreta, ambulatori ammessi, blocco e nuova autenticazione. La credenziale del dispositivo resta solo in memoria fino a cambio collegamento o chiusura. |
| Primo avvio | Collegamento di un dispositivo a un servizio già predisposto. Creazione dell'archivio e onboarding amministrativo restano nel prodotto corrente. |
| Pazienti | Elenco attivi/archiviati, ricerca, anteprima, apertura scheda e ambulatorio; creazione e modifica dei campi anagrafici ordinari. Il patch conserva i campi omessi e distingue null esplicito. Archivio/ripristino e gestione completa delle appartenenze restano nel percorso corrente. |
| Scheda paziente | Identità, quadro, diario, terapie, controlli, parametri e documenti attraverso i DTO correnti. Archiviati in consultazione. |
| Scrittura con conferma | Note e moduli collegati passano da bozza, revisione, conferma e rilettura; conflitto ed esito incerto non riabilitano un invio automatico. |
| Ascolto della visita | Rimane nel percorso Apple esistente; non è riprodotto dalla shell GPUI. Nessuna nuova ammissione AI viene dedotta dalla piattaforma Windows/Linux. |
| Terapie | Lettura, creazione e modifica versionata mediante il writer corrente. Per una terapia codificata il nome conserva AIC/ATC/principio attivo: la sostituzione del farmaco usa ancora il selettore corrente. Il ragionamento assistito e le prescrizioni di prestazioni/protesica hanno contratti e superfici ulteriori. |
| Misure | Lettura, creazione e modifica di osservazioni con unità, codice, valore stringa, riferimenti, note e data; l'andamento grafico del prodotto richiede una qualifica distinta. |
| Documenti e proposte | Elenco, lettura del contenuto, upload e salvataggio con scelta esplicita del percorso. OCR, proposte e gestione documentale completa restano distinti dal trasferimento verificato dei byte. |
| Agenda | Route aggregata corrente, gruppi per stato/data, nome del paziente e apertura della scheda; limiti e intervallo della risposta sono osservabili. |
| Diario | Voci della scheda e lista globale, ricerca sui risultati caricati, lettura del testo clinico, creazione e modifica di una voce. Il corpo HTML esistente è conservato, mentre titolo/data e corpo di testo semplice sono modificabili. La fedeltà dell'editor ricco è distinta dalla fedeltà dei byte conservati. |
| Repertori | Farmaci, esenzioni, ATC, LOINC e UCUM attraverso i cataloghi dell'host; fonte/versione e limiti. WHO ICD-11 usa un altro contratto, non viene simulato da un risultato vuoto del motore legacy. |
| Analisi | Accesso alla funzione corrente; elaborazioni e grafici non portati nella shell GPUI. |
| Scale | Accesso alla funzione corrente; formule, questionari e registrazione dei risultati non sono dichiarati migrati. |
| Impostazioni | Aspetto e blocco nativi. Accessi, ambulatori, backup/ripristino, AI, governo dei dati e zona pericolo restano sulle superfici correnti. |
| Stati | Errori nominati, dati non leggibili, conflitto, risposta persa, rilettura fallita, bozza e registrazione verificata. |
| Mini | Percorso CLI corrente; la shell grafica non sostituisce né qualifica un nuovo Mini Rust. |

Le liste aggregate usano gli endpoint esistenti. Non viene ricostruita una
lista globale scaricando ogni scheda. I limiti server predefiniti sono 200
controlli e 50 voci; i filtri tipizzati ammettono fino a 500/100 nella singola
richiesta. Una risposta limitata non viene presentata come archivio completo.
Le prove aggregate del corpus hanno un solo paziente con righe iniziali;
la suite TCP verifica separatamente due parent e il loro legame alle ricevute.

Agenda e Diario espongono i campi Dal/Al: gli estremi includono l'intera
giornata nel fuso del computer e vengono convertiti in UTC per la richiesta.
L'intervallo applicato è separato dal testo ancora in modifica; una data
invalida non cambia risultati o filtro attivo. I nuovi eventi dei moduli
GPUI permettono di scegliere il giorno, non ancora l'ora. Cambiando il giorno
di un evento esistente vengono invece conservati ora, frazioni e offset;
la rilettura confronta l'istante effettivo.

La tastiera copre Tab/Shift-Tab, Invio/Spazio sul comando con focus,
Ctrl/Cmd+K, Ctrl/Cmd+R, Esc e Ctrl/Cmd+Shift+L. Ctrl/Cmd+Invio apre la
revisione e non conferma una registrazione. Le scorciatoie del canone per
`/`, navigazione della worklist con j/k o frecce, Ctrl/Cmd+N e Ctrl/Cmd+L
non sono ancora tutte implementate; nemmeno le schede paziente multiple
del workspace corrente sono sostituite da questa singola scheda GPUI.

## Riferimento visivo old/new

Le undici schermate della release sono PNG originali dell'artifact
`playwright-report` della [run E2E 38783064909](https://github.com/Wulfgardr/mediflow/actions/runs/38783064909),
non ricostruzioni. La verifica del digest dell'archivio scaricato coincide con
GitHub. Il checkout della CI è il merge `8e0a4e9bde7cc2d115c627cd5f25142091aa1b8d`;
il suo tree `13a1cf283dc18dbf06a0dad3f55d48f741e326e7` è identico a quello
della release `9c7b3adf…`. Origine, viewport, fixture, scroll e risultato del
test sono documentati nel
[manifest delle immagini originali](../../experiments/gpui-patient-pilot/evidence/connected/release-v0.9.0-ui/manifest.json).

Il riferimento copre elenco, quadro chiaro/scuro, diario, nuova voce e
impostazioni; comprende desktop e viewport 390 × 844. I test selezionati sono
passati senza retry; il report `official-ui` è riuscito 6/6. Le fixture della
CI release sono diverse dal corpus del nuovo client: il confronto valuta
famiglia, gerarchia e geometrie, non una differenza pixel per pixel.

La nuova shell mantiene identità e azioni della scheda, quadro e diario,
filetti, piano opaco, temi e soglia della registrazione. La disposizione
compatta conserva una sola colonna e navigazione inferiore; l'ingrandimento
usa scorrimento verticale e un menu completo. Il conteggio delle funzioni
ancora esterne rimane nella matrice sopra, anche quando la destinazione è
raggiungibile dalla nuova interfaccia.

Il [manifest della finestra GPUI](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/manifest.json)
registra 21 immagini e nove verifiche dichiarate, con hash del binario,
manifest dei sorgenti, viewport e limiti. Le immagini appartengono a tre
build successive identificate singolarmente: il confronto della tipografia
e delle geometrie iniziali non viene attribuito per retroattività all'ultimo
binario. Le prove usano X11/Xvfb e rendering software; il fuso del processo
è Europe/Zurich, distinto da quello UTC delle ricevute HTTP.

| Superficie | Immagine osservata |
| --- | --- |
| Quadro Giorno desktop | [Scheda sintetica](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/patient-quadro-light-desktop.png) |
| Quadro Grafite desktop | [Stessa scheda](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/patient-quadro-dark-desktop.png) |
| Quadro a 390 × 844 | [Identità, azioni e navigazione](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/patient-quadro-light-compact.png) |
| Agenda, intervallo e data invalida | [Intervallo applicato](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/agenda-compact.png), [errore con risultati conservati](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/agenda-invalid-date-compact.png) |
| Menu al 400% | [Focus su Impostazioni](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/menu-400-settings-focus.png), [focus sul blocco](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/menu-400-lock-focus.png) |
| Ricerca e riga paziente al 400% | [Ctrl+K](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/patient-search-400-focus.png), [Tab sulla riga](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/patient-row-400-focus.png) |
| Intestazioni cliniche al 400% | [Agenda](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/agenda-search-400-focus.png), [Diario generale](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/diary-search-400-focus.png) |
| Repertori al 400% | [Ricerca a larghezza piena](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/references-input-400-focus.png), [focus del comando principale](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/references-search-400-focus.png) |
| Registrazione da tastiera | [Cursore nella bozza](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/notes-draft-caret-400.png), [revisione](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/notes-review-400.png), [registrazione e rilettura](../../experiments/gpui-patient-pilot/evidence/connected/gpui-ui/notes-verified-400-desktop.png) |

La QA al 400% ha trovato etichette tagliate, una ricerca focalizzata fuori
dalla viewport e intestazioni cliniche senza larghezza utile. I testi dei
componenti condivisi ora ricevono un limite di larghezza; i target di scroll
rivelano ricerca, righe e azioni con focus. Le coppie nome/data e
nome/valore, la soglia di stato e la ricerca dei repertori passano in colonna
quando il testo è molto ingrandito. Il focus del comando principale ha un
bordo distinto dal suo fondo.

La bozza multilinea conserva accenti ed emoji. Due Ctrl+Invio consecutivi
producono la stessa revisione visibile; la registrazione osservata avviene
con Invio sul comando esplicito e termina con la rilettura. Nel corso dello
sviluppo sono stati esercitati anche creazione anagrafica, svuotamento del
solo telefono, nuova voce di diario e dialoghi nativi di upload/salvataggio:
il documento sintetico di 63 byte è identico dopo il trasferimento. Il
manifest distingue queste osservazioni precedenti dalle prove dell'ultima
build. Il catalogo del banco grafico è vuoto: la QA del focus nei Repertori
non viene conteggiata come risultato positivo di una ricerca catalografica.

## Confronto funzionale old/new

Il [protocollo riproducibile](../../experiments/gpui-patient-pilot/comparison/protocol.md)
separa due esperimenti. Il primo legge lo stesso corpus sui servizi release
e candidato mediante il rispettivo accesso valido. Il secondo confronta
JavaScript e Rust contro lo stesso host candidato, stessa generazione e
stesso ambulatorio. Non tratta un cambio di protocollo di autenticazione
come differenza di un campo clinico.

La release 0.9.0 usa il precedente accesso Web PIN; il nuovo client usa il
contratto v3. La lettura release è riuscita usando il vero controllo di
accesso Web di quella release e il logout ha restituito 204. Le proiezioni
decifrate coincidono con quelle del candidato, su archivi sintetici distinti.
Questa è compatibilità di lettura; non attesta che il vecchio host ammetta
il nuovo client nativo v3.

| Caso esercitato | Esito osservato |
| --- | --- |
| Corpus | 4 pazienti attivi, 1 archiviato, 1 ambulatorio; scheda principale versione 1 con 2 voci, 1 terapia, 2 osservazioni, 1 controllo e 1 documento. |
| Lettura/decrittazione JS vs Rust | Tutte le proiezioni dichiarate uguali, compresi Unicode e dati del documento. |
| Agenda e Diario generale | 1 controllo e 2 voci nell'intervallo pubblicato; proiezioni aggregate identiche nello snapshot 2. |
| Note | Fixture equivalenti separate: versione 1 → 2, note esatte dopo rilettura. |
| Secondo invio locale | JavaScript blocca con il proprio journal; Rust richiede una nuova ricevuta di lettura. Sono errori locali diversi, entrambi prima di un secondo invio. |
| Modifica concorrente delle note | Una seconda sessione realmente autenticata conserva la versione precedente; PUT rifiutato con HTTP 409. |
| Nuova voce di diario | Titolo, contenuto, tipo, data e contesto riletti esatti; versione 1. |
| Terapia | Creazione v1, modifica v2, confronto di tutti i campi del draft, stale PUT 409 e ulteriore rilettura v2 invariata. |
| Osservazione | Stesso percorso; codice, unità, valore stringa, riferimenti, data, fonte e note confrontati. |
| Controllo | Stesso percorso; data, titolo, note, fonte e passaggio pending → completed confrontati. |
| Documento | Creazione, elenco privo di payload, dettaglio con nome/MIME/dimensione esatti e confronto dell'intera data URI; 44 byte UTF-8 uguali. |
| Anagrafica | Nuovi pazienti distinti per client: creazione v1, modifica sparsa v2, stale PUT 409 con rilettura invariata, svuotamento esplicito di nascita/telefono e rilettura v3. Tutti i sette campi condivisi confrontati. |
| Archivio temporaneo | Creato dal runner, account e abbinamenti sintetici espliciti; processi e dati posseduti ritirati al termine. |

La [ricevuta delle risorse](../../experiments/gpui-patient-pilot/evidence/connected/paired-v3-final-run/resources-comparison.json)
registra gli hash delle proiezioni create e aggiornate. Le versioni, gli
esiti HTTP e il contenuto riletto vengono verificati prima di produrre un
risultato positivo. Gli ID generati e i nonce della cifratura non devono
coincidere fra due registrazioni equivalenti. La
[ricevuta anagrafica](../../experiments/gpui-patient-pilot/evidence/connected/paired-v3-final-run/patient-profiles-comparison.json)
controlla separatamente codice fiscale e identità di ciascun client. Dopo la
creazione le liste globali hanno dimensioni diverse per costruzione: quella
fase omette lo snapshot e non lo presenta come una parità fallita o superata.

Gli update di terapia, osservazione e controllo possono rappresentare una
rimozione logica tramite i campi del writer corrente; questa prova non
esercita quella funzione. Gli allegati paired non hanno un equivalente PUT
versionato nella superficie qui usata. Non sono quindi riportati come
superati un aggiornamento o un conflitto del documento.

## Tempi diagnostici

La nuova esecuzione completa è terminata alle **16:57:37 UTC**. Dopo un
riscaldamento escluso dal campione sono stati eseguiti cinque accessi e
snapshot per client, alternando l'ordine. Il probe Rust è ottimizzato; il
servizio comune usa Next in sviluppo e mantiene le dipendenze del lockfile.

| Misura | JavaScript, mediana [min–max] | Rust, mediana [min–max] |
| --- | --- | --- |
| Accesso v3, inclusi KDF e HTTP | 425,86 ms [405,83–454,66] | 364,82 ms [291,39–411,49] |
| Snapshot completo dichiarato | 528,33 ms [441,72–620,17] | 581,41 ms [565,37–647,40] |

In questa prova lo snapshot Rust include controlli di identità/scopo prima
delle richieste. I due client non eseguono un insieme identico di richieste
accessorie. Le misure servono a localizzare il costo del percorso; non
quantificano la velocità intrinseca dei linguaggi né avvio, rendering, RAM,
energia o prestazioni dell'applicazione installata. Il banco era condiviso con altre attività di sviluppo; queste sono misure
diagnostiche con cinque campioni, non un benchmark isolato. Le ricevute
precedenti restano conservate con i propri tempi, fuori da questa tabella.

## Protezioni e regressioni verificate

La [ricevuta Rust](../../experiments/gpui-patient-pilot/evidence/connected/rust-gates.json)
registra **89 test distinti superati**: 40 dell'applicazione, 20 del client
del pilota e 29 del trasporto collegato, senza errori o test ignorati.
Formattazione, Clippy su tutti i target con warning negati e build della
finestra passano su Linux. Le ripetizioni dopo le correzioni dell'interfaccia
non aumentano il conteggio dei test distinti.

La [ricevuta JavaScript](../../experiments/gpui-patient-pilot/evidence/connected/javascript-gates.json)
registra typecheck, lint, **115/115** test del selettore, inventario completo
(1.031 file selezionati e 29 esclusioni preesistenti motivate su 1.060),
never-regress, diff OpenAPI effettivo contro la base e guard delle
affermazioni. I self-test OpenAPI passano 15/15; il guard delle affermazioni
riconosce le 18 violazioni e le 11 regressioni di mascheramento sintetiche.
Sono prove locali sul delta identificato dai manifest, separate dalla CI
del commit pubblicato.

La [review del trasporto e del roster](../../experiments/gpui-patient-pilot/evidence/connected-review.md)
riporta vettori dorati v3 Web/Swift, decrittazione dei campi, origini ammesse,
identificativi opachi, cookie di scopo, versioni intere sicure, gate di un
solo invio e risposte tardive. La suite TCP esercita perdita della risposta,
blocco durante GET/PUT e lettura tardiva che non ripristina una ricevuta già
consumata. Una scrittura inviata prima del blocco può avere committato:
il blocco non viene presentato come rollback.

Il test TLS reale su proxy sintetico ha ammesso il certificato con pin
corretto ed eseguito accesso/lettura/logout; con pin errato non sono arrivate
richieste HTTP applicative. Il client verifica il DER e la firma TLS,
disabilita redirect, proxy impliciti e retry, e limita tempi e dimensioni.
La verifica identity precede il writer: la finestra fra preflight e commit
rimane un limite del contratto host, non un controllo atomico inventato dal
client.

L'estensione `windows`/`linux` è propagata a tipi, parsing, stato persistito,
issuer nativo, OpenAPI e protocollo 1.12. L'ambiente di inferenza mantiene i
propri vincoli Apple. La suite host mirata ha ottenuto **65 pass, 0 fail,
1 skip** su 66 test: lo skip è l'esecuzione del bundle Swift XCTest sul
sistema Linux. Login/logout HTTP sono esercitati sui cinque valori;
la revoca finale HTTP riguarda Linux, mentre la revoca nel modello è
verificata per tutti i cinque. Non vengono contate cinque revoche HTTP.

Il package `@mediflow/web-auth-lifecycle-owner` passa a **0.8.11** con tarball
locale, lockfile, provenienza e inventario standalone coerenti. Due pack
offline da copie pulite hanno prodotto gli stessi byte. Una review
indipendente ha confrontato i 13 file del sorgente, del tarball e della
copia fisica installata. SHA-256 del tarball:
`cf714b64126aa84eca9a6c98f699065ba0bf9721d85ceaa7bc8647d2f6745a19`.
Il diff semantico OpenAPI passa contro `origin/main` con le estensioni enum
esplicitamente documentate; client stretti precedenti possono rifiutarle.

## Piattaforme e criteri ancora aperti

| Piattaforma | Evidenza e condizione per la sostituzione |
| --- | --- |
| Linux | Finestra collegata eseguita su X11/Xvfb con renderer software e corpus sintetico. La matrice CI compila e testa il target. Restano desktop reali, lettori di schermo, IME e pacchetto installato. |
| macOS | Target GPUI e test del workspace nella matrice CI. VoiceOver, input, lifecycle, accesso a file e installer devono essere provati su sistema reale. |
| Windows | Piattaforma paired esplicita, target GPUI e test nella matrice CI. UI Automation/Narrator, IME, scala DPI, colori di sistema e installer richiedono esecuzione reale. |
| iPhone/iPad | Il backend UIKit/Metal del pin non completa l'albero accessibile e alcuni dialoghi file; occorrono binding e prove prima di sostituire Swift. |
| Android | Il factory del pin non seleziona un backend Android; non è un target qualificato da questa modifica. |
| Web | Conserva il percorso corrente. L'allineamento dei token non equivale a un port GPUI nel browser. |

Il [factory fissato di GPUI](https://github.com/zed-industries/zed/blob/56934ec0560bce8929025497411de7f5322fb6ca/crates/gpui_platform/src/gpui_platform.rs)
mostra i backend selezionati. I dialoghi di apertura e salvataggio del
[backend iOS dello stesso pin](https://github.com/zed-industries/zed/blob/56934ec0560bce8929025497411de7f5322fb6ca/crates/gpui_ios/src/ios/platform.rs)
restituiscono esplicitamente un errore di funzione non ancora implementata.
Un backend Web esiste nel pin; la sua presenza non porta automaticamente
questo client, il suo trasporto e i suoi flussi nel browser.

Gli adattamenti dichiarati nel design seguono la piattaforma; le misure
sperimentali di dispositivi non verificati nel banco non vengono presentate
come specifiche hardware accertate. Riduzione del movimento, focus e
contrasto del client sono distinti dalla qualifica completa delle tecnologie
assistive. Un'immagine o una compilazione superata non basta a chiudere
questi criteri.

Per concludere la transizione dell'intero prodotto restano il port delle
superfici cliniche indicate nella matrice, il writer/core Rust con i suoi
prerequisiti di autorità, supervisore/IPC, installer e prove su ciascuna
piattaforma. WUL-582, WUL-573, WUL-580 e il GO WUL-736 restano decisioni e
verifiche autonome. La PR non viene unita o distribuita per il solo risultato
positivo del confronto sintetico.
