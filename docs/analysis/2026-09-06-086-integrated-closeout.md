# MediFlow 0.8.6: chiusura dello sviluppo e consegna

Aggiornamento: 7 settembre 2026. Branch `codex/WUL-669-086-integrated-candidate`.
Base del programma: `b72ac713b624e7d771262e4e01c5c5e1f56f9ae2`.
Stato deciso dall'utente: **feature-complete e development-complete** sul
candidato `c320694c33d0d55848d6f721f176a2e22e221620`. Sorgente funzionale
congelato; i successivi aggiornamenti di consegna riguardano documenti e
artefatti, non funzionalità o correzioni. Nessun push, PR, merge, tag o release
è attestato da questo verbale.

Questo verbale aggiorna lo stato del candidato. Le prove precedenti della
[base funzionale](./2026-09-06-086-functional-closeout.md) e della
[promozione web](./2026-09-06-086-integrated-ui-verification.md) mantengono
il proprio commit e perimetro; non vengono attribuite retroattivamente al
candidato finale. I contratti dei componenti restano negli ADR pertinenti.

## Decisione di closeout

L'utente considera concluso lo sviluppo della 0.8.6 e richiede la consegna
del candidato congelato. Le prove Windows/Linux e Apple fixture/simulator
già acquisite restano valide nel proprio perimetro. I volumi Xcode e delle
VM non sono collegati: questa indisponibilità non impone di ripetere le prove
e non riapre lo sviluppo. Il precedente limite d'uso del 20% è revocato.

| Residuo di accettazione | Disposizione |
| --- | --- |
| Interoperabilità UI mirata iPhone ↔ Mac/Home Base, bloccata sul riempimento deterministico del campo nel test | **DEFERRED VALIDATION ITEM / POST-RELEASE VERIFICATION GATE** |

La verifica differita richiede il percorso ordinario, assert invariati e
rilettura indipendente dei dati sintetici, quando gli ambienti saranno
disponibili e la sua esecuzione sarà autorizzata. Nessun workaround per
ottenere un falso verde. Salvo un difetto reale emerso da quella verifica,
il residuo non riapre lo sviluppo della 0.8.6; nessuna nuova feature o
correzione entra nel candidato congelato.

La decisione modifica l'accettazione della consegna, non gli esiti registrati:
non attesta le combinazioni mobile/host non eseguite e non autorizza il claim
**fully validated cross-platform**. Provisioning WHO, responsabilità
regolatorie, firma e distribuzione mantengono i rispettivi confini documentati.
Pubblicazione e merge restano operazioni distinte, con autorizzazione e prove
proprie; non seguono automaticamente dal congelamento.

## Milestone di chiusura documentale

Questa milestone aggiunge ricevute recenti senza sostituire le sezioni storiche
che seguono. Nessun esito qui sotto
attesta merge, release o parità completa con host reali.

| Suite completa successiva | Risultato e confine |
| --- | --- |
| Windows, runtime `25e8f8708`, test `8aaf2e622` | 158 casi: 145 PASS, un FAIL, 12 skip espliciti, zero retry. Comprende 157 casi canonici e un primo avvio da directory vuota. Accesso, recovery, reset isolato e onboarding completo sono PASS. Il FAIL confronta due righe entrambe evidenziate: la prima per hover residuo, la seconda per selezione da tastiera. |
| Diagnosi Windows dello stesso FAIL | Due contesti separati: il primo riproduce hover e colori uguali in tutte le 12 osservazioni; il secondo sposta solo il puntatore fuori dalla lista e supera l'intero caso con gli assert originali. `bbd4fcbfb` integra quella precondizione nel test. Il full originario conserva il suo FAIL. |
| Headless Windows, stesso runtime | Import guard PASS su 44 file/quattro superfici; portable 239 PASS e nove FAIL per timeout/uscita senza codice su 248 casi. MCP separato 33/33, Mini separato 11/11 e Supervisor sul bundle compilato PASS. I successi separati non cancellano il fallimento del gruppo portable né ne dimostrano la causa. |
| Controllo portable Windows in sequenza | Un solo controllo: 248 PASS, zero FAIL/skip, stessi 22 file e stessi titoli; 94,9 s. L'unica variazione è `--test-concurrency=1`, senza modificare scadenze, asserzioni, ambiente dei processi o autorità. `5c25d0968` rende canonico il runner byte-identico a quello eseguito; collector unitario e lint mirato PASS. Il riepilogo Node completo è verificato, ma il wrapper PowerShell non ha acquisito il codice d'uscita figlio. Non è una nuova esecuzione del comando canonico né una prova di contesa CPU. |
| Comando portable canonico Windows, runner `5c25d0968` | Una successiva esecuzione di `npm run test:headless-portable`: 248 PASS, zero FAIL/skip/retry, 22 file e titoli identici all'inventario canonico, 111,8 s complessivi. Codice d'uscita nativo npm 0 e segnale nullo acquisiti direttamente. L'unico file sovrapposto al sorgente del guest è il runner; l'app compilata e i servizi paired restano `25e`. I due run precedenti conservano risultati e limiti originali. |
| Linux, runtime `25e8f8708`, test `8aaf2e622` | Full di 187 casi: 138 PASS, 49 skip, zero FAIL/retry. Un secondo run su database creato dalla UI completa i sette casi opt-in: 145 PASS distinti e 42 esclusioni esplicite, 40 del prototipo e due Apple Vision. Import guard, portable 248/248, MCP 33/33, Mini 11/11 e Supervisor compilato PASS. |
| iPhone e iPad, fixture `dc1fc05222e5e8db97119e69b29aa576555737ac` | Firma ordinaria del simulatore; sorgente `5ced` più il solo fix DEBUG `8fc`. iPhone 37 PASS e quattro skip; iPad 34 PASS e sette skip: zero FAIL nelle due suite da 41. Digest di app, test e xctestrun invariati prima/dopo. Comprende AX5, rotazione effettiva, bozza e rilettura del motivo d'archivio; non usa host reali. |

Il confronto dei 147 titoli ordinari, comprese le due esclusioni Apple, coincide
fra i guest. I 30 casi di differenza nei collector riguardano le route del
prototipo: il separatore Windows impediva di enumerarle. `e9716d741` corregge
l'enumerazione con prova locale sullo stesso elenco; non è applicato ai full
riportati sopra e non modifica retroattivamente i loro conteggi.
Una successiva raccolta `--list` su Windows con `e971` e `bbd` verifica 48 file
e 187 casi canonici, coincidenti per file e titolo completo con Linux: 147
ordinari e 40 del prototipo. L'elenco non esegue test; tutti i 30 casi aggiunti
appartengono al prototipo e i risultati dei full precedenti restano invariati.
La ricevuta Linux distingue inoltre CRUD ed export dettagliati provati su
`3c4863f13` dalle nuove esecuzioni `25e`: il totale dei test non prova ogni
funzione sull'ultima build. Le sei combinazioni di UI mobile e host restano
da eseguire. Nessuna richiesta clinica reale, pubblicazione o merge è attestata.

La creazione paziente Apple ora verifica sessione, contesto e bozza prima di
pubblicare risposte asincrone; conserva le modifiche introdotte durante il
salvataggio. Sulla base precedente quattro dei cinque nuovi test falliscono;
il candidato `4b2436319` supera 35 regressioni mirate con Xcode 26.6. La build
firmata ordinariamente per il simulatore supera compilazione, verifica della
firma e controllo dei payload entitlements; questo non attesta ancora il
percorso di creazione attraverso un host reale.

Il primo tentativo UI reale iPhone/Mac (`4b`/`25e`) supera Configura,
accesso nativo e caricamento del paziente sintetico. Si ferma prima di aprire
la scheda: il dialogo di sistema per salvare la password copre la lista.
Nessuna modifica clinica viene eseguita da quel percorso. Il video conserva
il blocco; il tentativo non completa una delle sei combinazioni richieste.
Il successivo candidato di test `8957fbec7`, con firma ordinaria verificata,
gestisce soltanto quel dialogo e l'azione “Not Now”. Il nuovo tentativo si
ferma ancora prima dell'accesso: il helper di riempimento lascia un suffisso
nel campo dell'identificativo perché cancella dal cursore centrale. Non prova
quindi la gestione del dialogo o il percorso clinico. Occorre osservare la
selezione dell'intero contenuto prima di correggere il helper. I due tentativi
e i prodotti compilati restano conservati.

Dopo lo sblocco manuale del Mac, il controllo diretto del simulatore non riesce
ad azionare Configura. Una prova XCTest separata, `cff1bbf45`, raggiunge invece
il campo e ne conferma il valore invariato prima e dopo una pressione lunga.
Build con firma ordinaria e singola osservazione sono PASS; AX e screenshot
non mostrano però un menu di selezione. Questo PASS non prova “Select All”,
sostituzione del testo o completamento del percorso reale. Il candidato di
sola osservazione resta nel worktree di verifica, separato dal branch integrato;
il helper precedente è invariato. Raggiunto il limite concordato del 20% della
quota settimanale, la sessione entra in chiusura ordinata senza un nuovo P1.

### Ricevute precedenti conservate

| Sorgente | Verifica | Limite |
| --- | --- | --- |
| Node, `52ae794ab2411e3c7d438db34b36114187bb4418` | Suite completa: 3.206 PASS, uno skip canonico, zero FAIL su 3.207 casi; lint completo PASS. Node 24.19.0 e directory sintetica privata. | Le modifiche successive solo documentali, ai test browser e al builder del simulatore hanno verifiche distinte. |
| Windows 11 ARM64, Node 24 x64 emulato, `25e8f8708f47a51c45f2bdfd64a8caa5e422d45b` | Focused run `16/16` PASS: `15` test canonici e first root da directory vuota. | Non è il full finale né un bundle AnyDoc ARM64 nativo. |
| Windows, stesso runtime `25e8f8708` | Onboarding completo canonico PASS su un secondo database nuovo: configurazione UI, ripresa, CAS, rollback, risposta persa e idempotenza. I due lotti mirati sommano 17 PASS senza retry o skip. | Il collector completo successivo rimane una prova separata. |
| Windows 11 ARM64, Node 24 x64 emulato, `868eb3ee6eef367c368a314f98bd15d60dd788b8` | Full: `142` PASS, `12` skip espliciti e `2` FAIL, senza retry. Un FAIL è `official-ui`; l'altro è onboarding. | I due FAIL restano distinti; il run non promuove il target finale. |
| Linux ARM, `3c4863f13ddf31a2b2d224bbdbcd06f8fdf99f1c` | Storico: `122` PASS, `9` flaky, `5` FAIL e `49` skip, con un retry storico. Il target `800` ha `24` PASS e un FAIL background one-shot. | Il full sul target `25e` è pendente. |
| Linux ARM, runtime `25e8f8708`, due file di test integrati in `8aaf2e622` | Cartella e lista: 25 PASS, zero skip o retry. Il tema viene scelto dalle Impostazioni ordinarie; focus, sezione visibile e stile attendono le condizioni effettive entro il budget esistente. | Le prove storiche fallite restano conservate; il run non dimostra assenza statistica di intermittenza. |
| SwiftPM, `af1391e67846b1cc9848ce8f8b3dd1bd7f7a9f22` | `823` totali: `822` PASS, `0` FAIL, `1` skip canonico. La correzione riguarda l'errore del wrapper; non riesegue i test. | Non è build o UI iOS/iPadOS integrata. |
| Generic Apple, `f512643eebe9c50a95fad9fce3e69fc9ce8954ba` con solo delta `5ced` | Compilazioni generiche macOS `arm64+x86_64` e iOS device `arm64` PASS con Xcode 26.6 (`17F113`); il native tree `f4dff69dc421d01888d8d609ce9911e026ad0d19` coincide con il parent `5ced`. I digest della sintesi e dei receipt sono verificati. | `CODE_SIGNING_ALLOWED=NO`; app non avviate. Nessuna prova UI, Keychain, host paired, firma di produzione o distribuzione. |
| Apple UI, `7d0c8240883e837b6e201c3d34f768ecda35f19b` | Phone: `36` PASS, `4` skip, `1` FAIL. iPad: `30` PASS, `7` skip, `4` FAIL. | `41` è un conteggio target, non una fonte; AX5, rotazione e gesto Home restano aperti. |
| Simulatori con firma ordinaria, `5ced339e9` | Build-for-testing PASS. Quattro target PASS: AX5 iPhone e iPad, rotazione effettiva iPad e bozza completa dopo rotazione. Due target archivio falliscono alla rilettura del motivo dopo il salvataggio. | Il ramo demo aggiornava il record senza rinnovare la mappa dei campi editabili; `8fc772e6a` corregge quel solo ramo DEBUG. La nuova prova UI è ancora da eseguire. Nessun difetto del salvataggio HTTP è attestato da questa fixture. |

Le attese descritte nella tabella precedente fotografano quella milestone.
Le due suite UI da 41 sono ora concluse come riportato sopra; full SwiftPM e
compilazioni generic Apple conservano la propria sorgente. Il refresh dei tre
host a `25e` non sostituisce le prove delle sei combinazioni app/home-base.

## Verifiche del candidato del 6 settembre, secondo lotto

La build web pulita `868eb3ee6eef367c368a314f98bd15d60dd788b8` ha
superato Turbopack, TypeScript, 112 route e il controllo del bundle standalone
su macOS con Node 24.19.0 / ABI 137. La build Windows dello stesso commit
ha superato webpack e il controllo standalone/AnyDoc con Node 24.19.0 x64
su Windows 11 ARM64: questa prova usa l'emulazione x64, non un bundle AnyDoc
nativo ARM64. Le copie compilate e i registri delle impronte sono conservati
fuori Git; i test successivi non sovrascrivono i bundle dei servizi paired.

| Confine verificato | Risultato e sorgente |
| --- | --- |
| Suite unitaria Node completa | `92c106950fd37246856b45cc0315d5ebb4fd8042`: 3.198 PASS, uno skip previsto, zero errori su 3.199 test; 71,1 s di esecuzione, directory sintetica dedicata. |
| Suite SwiftPM completa | 805 PASS, uno skip previsto per benchmark senza manifest, zero errori su 806 test; 65,5 s. Package tree `a5f3452a9b8cfe39d2bc6472e9312fd8c5aff5a4`, identico al candidato `7d0c8240883e837b6e201c3d34f768ecda35f19b`. Include navigazione, diario, cache, blocco e scadenza della sessione. |
| Navigazione web, focus e densità della lista | 34 PASS su build `27f3fe0b7f970f7defe703599f3df1b56f2f39df`: tastiera, cambi di paziente, viewport stretti, comandi di riga e lista virtualizzata. Nessun retry o skip. |
| Percorso web ordinario completo | Tre PASS su build `868eb3ee6`, test `d09572293144ab157b8026370a1a862a00d68126`: impostazioni, agenda, destinazione del paziente e “Apri quadro”; URL, sezione visibile, focus, identità, contenuto, console e pulizia verificati. |
| Recupero dell'accesso web | Build `3041f8ade`: due test mirati e sei casi originali PASS. Il rinnovo attende la risposta del blocco prima di accettare un nuovo PIN; nessun accesso automatico o allentamento del confine server. |
| Reset web isolato | Un PASS su processo standalone e database temporaneo propri, con configurazione iniziale e riconfigurazione dalla UI; il test P3 invariato sul servizio separato conserva il PIN originale. Nessuna prova CI implicita. |
| Linux, sorgente `3c4863f13ddf31a2b2d224bbdbcd06f8fdf99f1c` | Build, primo accesso da directory vuota, sei casi UI ufficiali e scale PASS. Import guard 44 file/quattro superfici, portable 248, MCP 33, Mini 11 e smoke del Supervisor compilato PASS; gruppi non sommabili come casi distinti. |

I primi run falliti restano conservati. La prima suite Node su `868eb3ee6`
aveva otto errori: sei controlli di inventario/loader e due aspettative AST
del controllo PIN. Una copia di build inattiva è stata spostata fuori dal
checkout, senza aggiungere esclusioni ai controlli; l'import webpack del test
browser è stato reso statico. Il controllo PIN è stato riallineato alle
preparazioni Web/native già previste dall'ADR 0106 e rifiuta 30 mutazioni
di sorgente, incluso l'abbandono della barriera dopo il CAS. Nessuna modifica
del servizio PIN è stata necessaria per questa correzione del controllo.
La prima suite Swift aveva una sola aspettativa obsoleta sul percorso di
logout; la ripetizione completa usa `/api/auth/native/logout`.

“Apri quadro” ora apre esplicitamente `#quadro`; l'apertura generica della
cartella conserva il Diario come vista iniziale del layout B. La prova
intermedia richiedeva erroneamente sul riepilogo un attributo appartenente
alle sezioni collassabili: il test finale controlla la visibilità e il link
di navigazione corrente, mantenendo tutte le verifiche di contenuto e focus.

I client Apple cancellano la presentazione clinica al blocco e al 401 della
sessione corrente; le guardie di generazione proteggono dalla ripubblicazione
tardiva nei percorsi coperti dalle regressioni citate.
Il salvataggio del diario protegge la bozza durante la richiesta e il
recupero di un conflitto richiede rilettura, revisione esplicita e un nuovo
salvataggio. Queste sono verifiche del codice e del modello: non attestano
la cancellazione fisica di ogni copia temporanea in memoria né sostituiscono
le prove dell'applicazione con storage ordinario e host reali.

Le suite browser complete dei guest, le 41 prove UI per ciascun simulatore
e le sei combinazioni app/home-base sono ancora in corso o da eseguire.
I dodici run HTTPS già riusciti sulle sei combinazioni usano client API
indipendenti: non sono sei prove dell'interfaccia mobile. I vecchi badge
della matrice di parità non costituiscono una nuova verifica delle funzioni.
Non è ancora soddisfatto il gate finale di promozione.

## Verifiche precedenti alla build 868

La build web da worktree pulito
`cf1a13c307b5a78d53b95ba6327437b0b250cb73` ha superato Turbopack,
TypeScript e il controllo del bundle standalone con Node 24.19.0 / ABI 137.
La copia compilata è conservata fuori Git con gli asset e le impronte dei
file. Su questa copia `/api/system/revision` restituisce `unknown` senza gli
override di provenienza: lo SHA è attestato dal registro della build e dai
digest, non da quella risposta HTTP.

| Prova | Evidenza circoscritta |
| --- | --- |
| Tastiera K4 e navigazione L9, senza modificare i test | Quattro PASS, due ripetizioni per scenario, 24,6 s; nessun errore console. |
| Header e CSP sulle sei superfici principali | Due PASS, senza allentare la policy. |
| Query ReactDOM: navigazione, errore, retry, supersessione, ripristino e smontaggio | Sette PASS; letture ritardate e fallite sono fixture dichiarate, non traffico clinico reale. |
| Editor inline, transcoder, binding e flussi S7 integrati | 55 test Swift PASS. La prova UI della nuova versione resta separata. |
| Home-base Mac `27775bdde96aef5697341e8f22ae142e1f1dc5ec` | Due pairing distinti: accesso nativo, lettura, scrittura, rilettura cifrata indipendente e logout via HTTPS. Quattro run API riusciti; non prova dell'interfaccia mobile. |

L'editor nativo ora conserva gli stili su intervalli selezionati; il nuovo
percorso di autenticazione nativa mantiene distinta la sessione Web. Le query
ritirate quando il documento viene abbandonato non pubblicano errori tardivi;
gli errori di richieste ancora attive restano visibili. La selezione rapida
della ricerca non viene più sostituita dal focus differito del titolo.

Windows e Linux usano runtime e TLS nei rispettivi guest, database sintetici
separati e avvio ordinario da directory vuota. La prima matrice completa
Windows su `d402479cd2ff575f2a37ae177a2cc42574a1b8fd` ha prodotto
55 PASS, 68 fallimenti, 12 skip espliciti e 8 test non eseguiti su 143 casi.
I nuovi run mirati e gli adattamenti dei test alla UI ordinaria non sostituiscono
questo risultato. Il nuovo run completo, le prove finali Apple e le sei
combinazioni app mobile/home-base restano aperti. Gli errori HTTP 401 delle
impostazioni richiedono una verifica distinta dagli errori delle query
interrotte durante la navigazione.

## Comportamento consegnato nel candidato

- La UI ordinaria usa B con barra superiore; Aspetto permette di scegliere
  A con barra laterale. Il confronto con Originale rimane nel solo launcher
  sintetico. Un clic apre la cartella; navigazione, compilazione progressiva,
  gerarchia del testo e slider sono condivisi dalle pagine applicative.
- La base funzionale conserva provenienza e recupero OCR, stato delle
  funzioni, onboarding locale, rinnovo dell'accesso, setup host Ollama e
  timestamp dell'export FHIR. Le prove e i limiti specifici restano nel
  verbale della base.
- Search WHO usa il sidecar locale scelto dall'utente: endpoint loopback
  fisso, attivazione esplicita, risultati limitati e validati, cache distinta
  dalla risposta diretta. URI e identità degli artifact accompagnano la
  selezione; audit e modifica web/native conservano la provenienza.
  [ADR 0115](../adr/0115-icd11-who-reference-data-adapter.md) e
  [setup](../icd-who-setup.md) ne definiscono il confine.

- La cartella Apple mostra una sezione alla volta; le bozze sopravvivono alla
  consultazione dei Documenti. Il testo digitato legge lo stato corrente e
  la trascrizione finalizzata Mac resta separata, con conferma prima della
  sostituzione. [Verbale Apple](./2026-09-06-086-apple-ui-verification.md).
- La modifica della sola diagnosi aggiorna il dirty state: l'uscita chiede
  conferma, l'annullamento conserva la compilazione e non effettua scritture.
  Il reset della provenienza quando si torna al testo libero rimane esplicito.

## Verifica storica della prima integrazione

Ambiente web: Node 24.19.0, ABI 137, dipendenze fisiche nel worktree,
`env -i`, `MEDIFLOW_DATA_DIR` esplicita e fixture sintetiche. La suite unitaria
crea la propria directory temporanea; `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`
impedisce al preparatore di copiare il database legacy. Nessun servizio WHO
viene abilitato per queste prove.

Sorgenti eseguibili della prima integrazione: `a3e402f825dd778115fddb83cd789757e359a770`, worktree
pulito all'avvio della build. Il server standalone ha restituito
`codex/WUL-669-086-integrated-candidate@a3e402f825dd:clean` da
`/api/system/revision`. Questa prova precede le modifiche successive elencate sopra.
Log di quel lotto: `/tmp/mf086-final-c6f84emr/logs/`; indice e ricevuta locali in
`tmp-086-integrated/`.

| Verifica sul candidato unificato | Risultato |
| --- | --- |
| Build webpack e postbuild standalone | PASS, Node 24.19.0 / ABI 137. |
| Build Xcode Debug macOS arm64 e iOS Simulator | PASS, Xcode 26.6 / SDK 26.5, firma disabilitata. |
| SwiftPM: Core provenienza, selezione, documenti, S7, layout, binding e VisitRecording | 128 eseguiti: 127 PASS, uno skip previsto per benchmark senza manifest, zero fallimenti. |
| Browser ordinario: UI, bozze, accesso, stato funzioni e onboarding | Nove scenari PASS nel primo lotto. La prova WHO di persistenza si è fermata prima dell'accesso per un marcatore di fixture mancante. |
| WHO: selezione, sostituzione, cifratura, rilettura e modifica anagrafica | PASS separato dopo il completamento del marcatore della fixture già sintetica e isolata. Query e risposte WHO simulate; API, cifratura e SQLite reali. |
| Suite unitaria conclusiva `npm run test:unit` | 3.185 eseguiti: 3.184 PASS, uno skip previsto, zero fallimenti; 70,6 s senza compilazioni concorrenti. |
| Lint, typecheck, never-regress, claims, Lume, OpenAPI, AnyDoc local-only e crosswalk Fabric | PASS finali. |
| Manifest e confine WHO, retirement Docker | Nove test script PASS. |

Tutti i dieci scenari browser previsti sono coperti dai due lotti, non da
un'unica esecuzione senza errori. Le sorgenti UI Apple e i test del progetto
Xcode sono identici a `f231d9a82`; il delta Core WHO è incluso nella build e
nelle prove SwiftPM qui sopra. Le due prove di bozza su iPhone/iPad restano
quelle del verbale Apple, non un nuovo run UI sul candidato integrato.

La prima suite integrata ha eseguito 3.185 test: 3.183 riusciti, uno skip
previsto e un errore nel fingerprint AST del controllo Next. Il solo delta
di configurazione esclude gli strumenti sintetici dal tracing, secondo ADR
0123. Dopo la verifica del diff, il fingerprint è stato riallineato; tutti
i 23 test del confine di accesso sono passati. Alias, inclusione dell'owner
e controlli negativi restano invariati. La ripetizione durante le build ha
incontrato un solo timeout di 1,5 secondi nell'avvio del processo Mini; nessun
timeout o codice di autenticazione è stato modificato. La ripetizione senza
compilazioni concorrenti è passata integralmente. Il primo timeout è compatibile
con il carico concorrente, ma non costituisce una misura generale di prestazioni.

Il guard egress ha inoltre richiesto una sola eccezione per il test nativo di
selezione: host UUID su `.invalid`, sessione effimera e URLProtocol che intercetta
ogni richiesta, compresi gli host sconosciuti. L'eccezione è limitata a quel
file e alla sola interpolazione; non abilita un endpoint dell'applicazione.

## Proposta visiva macOS successiva

L'utente osserva che l'app Mac rimane sostanzialmente simile alla precedente.
La rifinitura verificata qui cambia soprattutto navigazione interna e gestione
delle bozze; non soddisfa ancora il redesign visivo complessivo richiesto.
La [proposta successiva](../design/2026-09-06-086-macos-redesign.md) ora cambia
quel rapporto: aree in alto, una sola lista laterale, testata persistente,
sette sezioni visibili e dati anagrafici disposti come un documento. Il suo
verbale riporta nuove build Mac/iOS, 87 test mirati e osservazione della
finestra reale; le prove precedenti di questa pagina restano riferite ai
rispettivi commit. I test passati non costituiscono accettazione estetica
o una revisione completa di ogni singolo form Apple.

## Limiti e promozione

- WHO non è provisionato: digest immagine, snapshot, accettazione della
  licenza, riavvio offline e ripristino restano da registrare. Nessuna prova
  contro un catalogo installato; lookup e cross-check puntuali sono fuori
  da questa implementazione Search. Il manifest non equivale all'attivazione.
- Prove su simulatori e Mac locale non attestano pairing, dispositivi fisici,
  installazione esterna, firma, notarizzazione o distribuzione Apple.
- La matrice regolatoria rimane un dossier tecnico da sottoporre alla
  revisione competente; `legalVerdict: not_assessed`. Non attesta conformità
  o adozione organizzativa.
- Resta documentato l'[incidente di inizializzazione del database standard](./2026-09-06-086-functional-closeout.md#incidente-nella-verifica-del-binding)
  avvenuto nella verifica precedente. Nessun record clinico letto o riportato;
  `quick_check` prova l'integrità strutturale, non l'assenza di modifiche.
  Non esiste una fotografia precedente sufficiente e non è stato tentato
  un ripristino. Il reader iniettato ora evita quell'import del database.

La promozione richiede ancora il completamento delle prove, la revisione del
diff e i controlli remoti. Le issue non sono dichiarate chiuse e non sono
state modificate su GitHub o Linear. Firma, notarizzazione e release restano
distinte dal merge richiesto.
