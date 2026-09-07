# MediFlow 0.8.6: verifica del candidato sorgente

Aggiornamento: 7 settembre 2026. Programma WUL-669.

**7 settembre 2026 — candidato locale aggiornato; pubblicazione sospesa.**
Il blocco contrattuale PIN è chiuso a livello sorgente dall'addendum indipendente
`SOURCE_REVIEW_PASS` su `cefa5c78f43ada28e9d74f2d65e5f2173b15edb8`.
Il finding LOW `csf_e6ea8156c1fde74d61ebf750`, emerso nel primo addendum JSON,
ha esito `FIX_VERIFIED` su `be9233282c0ab18759b0e679b877d9dc30af5a99`.
I due file PIN e i sette file della correzione allegati sono identici nel
candidato integrato `11a42f68effbdc11cd6371bf050a6e2e074de5b3`.
Non restano finding reportabili nel sorgente revisionato; questo non certifica
la sicurezza generale. La [PR 351](https://github.com/Wulfgardr/mediflow/pull/351)
è aperta su `c2db2521a28b0e98007a2b8702da076b8bc9a056`, senza merge.
Le modifiche successive sono locali. Ulteriori push, merge, tag e release
restano sospesi: oltre alla CI verde, è richiesta la qualificazione del nuovo
percorso ChatGPT/Codex. Quel collegamento non è ancora implementato o verificato;
le prove Ollama e MCP riportate qui non lo attestano.

## Disposizioni degli addenda indipendenti

| Revisione | Sorgente esatto | Esito e limite |
| --- | --- | --- |
| PIN | `1d633d98d0a093623c8c4f488815af804c769a6e..cefa5c78f43ada28e9d74f2d65e5f2173b15edb8` | `SOURCE_REVIEW_PASS`, zero finding. Successo ed esiti ambigui ritirano autorità e presentazione locali; il conflitto pre-CAS tipizzato mantiene l’autorità. Parse Swift e never-regress PASS nella ricevuta; nessun XCTest o runtime Apple eseguito dalla review. |
| Primo addendum JSON | `1d633d98d0a093623c8c4f488815af804c769a6e..61ca67191c7a78955dcc097254c7cc988f715242` | `SOURCE_REVIEW_HOLD`: LOW `csf_e6ea8156c1fde74d61ebf750`, disponibilità del processo. Digest 30/30 verificati; 68/68 test dichiarati dall’owner, non rieseguiti dal reviewer. Questo esito resta storico. |
| Correzione allegati | `e7f8a555ac697c36adc60a36132a776e39d19a72..be9233282c0ab18759b0e679b877d9dc30af5a99` | `FIX_VERIFIED`: digest 7/7, test sintetici 63/63, typecheck focalizzato, ESLint e diff-check PASS nella verifica indipendente. |
| Document Synthesis | `6d4b66f82c154045baf73ea62be7890417a90ed4..9fe74f2573c455ae2f8439f1b47adee767414f3c` | `SOURCE_REVIEW_PASS`: 15/15 test indipendenti, zero finding. Risorsa privata Web, selezione confermata e invalidazione asincrona; nessuna esecuzione browser da parte del reviewer. |
| Continuità broker DS | `1377215d259106e4477ba4a35b4071393ee55ff7..d4c06f039e09f42a2d7275db7d7733628e2d239a`, integrato in `e49d87c0d085b740812a9581a051a698e73e45a8` | Zero finding nei due file; 33/33 test integrati e 8/8 crosswalk indipendenti PASS. Broker legato al canonical owner e cleanup senza rientro. Non prova la sintesi ordinaria. |

La correzione allegati riduce il cap JSON a 30.408.704 byte, riserva uno slot
per istanza modulo prima della lettura e applica una deadline di lettura di
30 secondi. Il limite wire da 25 MiB resta distinto dal budget della busta.
Slot e contatore non coordinano processi diversi né limitano memoria già
allocata dal trasporto. La deadline non copre il servizio. Non sono state
misurate RSS, OOM o prestazioni sotto carico. Questi limiti non riaprono il
finding specifico verificato. OpenAPI 1.24.0 è allineato in `735f5cd85`:
cap, risposte 400/408/413/503 e `Retry-After` sono documentati.
Il guard OpenAPI è passato; i due script di regressione sono inclusi nella
raccolta canonica `test:unit` per la CI.

Il confronto Git dei due file PIN con `cefa5c78` e dei sette file del fix con
`be923328` non mostra differenze su `11a42f68`. Questo verifica l’integrazione
di quei sorgenti, non una nuova review esaustiva dell’intero tree.
Il [report originale](./2026-09-07-086-daybreak-security-review.md) mantiene
report inglese, hash e conclusioni storiche senza riscrittura retroattiva.

## Verifiche locali già eseguite: lettura delle ricevute

La tabella distingue le esecuzioni; i tentativi precedenti restano conservati.

Il coordinatore ha eseguito nuovamente `npm run test:unit` sul candidato
`9be09c5837fba72eb83cf46fcd88ebdb1f569523`, dopo l'inclusione dei due script
di regressione JSON: **3.267 PASS, 0 FAIL, 1 SKIP su 3.268**, uscita 0,
63,956 secondi. Fixture temporanee isolate, Node 24.19.0, nessuna compilazione
pesante concorrente. È una nuova esecuzione completa verde; non riscrive né
attribuisce una causa ai precedenti fallimenti. La CI remota resta distinta.

| Evidenza | Esito osservato | Confine sorgente e limiti |
| --- | --- | --- |
| `build-receipt.json`, `build-integrated.log` | PASS, incluso controllo bundle standalone; Node 24.19.0 | Ricevuta su tree pulito `e7f8a555ac697c36adc60a36132a776e39d19a72`, fingerprint `e7f8a555a`. Non prova build di `11a42f68` o del commit finale. |
| `supervisor-current.log` | Smoke production Supervisor PASS: cinque operazioni, checkup governato con conferma Web, un aggiornamento/audit, revoca e uscita pulita | Percorso canonico MCP; log sintetico senza SHA incorporato. Non attribuito come esecuzione dell’ultimo commit. |
| `unit-integrated-unsandboxed.log` | **3224 PASS, 1 FAIL, 1 SKIP su 3226** | Un test della composizione AnyDoc/Apple Vision attendeva `extracted` e ha ricevuto `review_required`. Il log non incorpora uno SHA; non è una suite tutta verde. |
| `anydoc-composition-idle.log` | **13/13 PASS**, esecuzione isolata successiva | Prova separata: non cancella il fallimento della suite completa, né ne dimostra la causa. |
| `attachment-budget-integrated.log` | **63/63 PASS** | Test focalizzati del fix integrato, distinto dalla verifica indipendente su `be923328`; log senza SHA incorporato. Nessuna prova RSS o HTTP. |

I precedenti log falliti, inclusi tentativi in sandbox e prove Swift locali,
restano evidenze storiche fuori Git. Nessun conteggio è stato riclassificato
retroattivamente. Le prove piattaforma precedenti conservano i propri SHA.

## Interfaccia e navigazione delle impostazioni

Il runtime Web compilato da `98fb036ec579b1bfe2ce947d7723fb7ca0eaabbe`
ha superato build webpack, TypeScript e controllo standalone/AnyDoc.
Dodici stati sono stati osservati nel browser a 1440, 965 e 390 px, con
login ordinario e soli dati inventati. La verifica usa Playwright locale;
il plugin Browser non era disponibile.

- Panoramica è presente nella navigazione interna: da Profilo, Aspetto e
  Ambulatori si torna alla pagina iniziale senza usare il menu superiore.
- I comandi misurati hanno altezza 44 px, raggio 12 px e peso del testo 600, inclusi Nuova voce,
  Checkup host, Azioni, Nuova prestazione e Dettagli.
- La ricerca è separata dal titolo dell'elenco; nei Repertori le etichette
  complete non si sovrappongono al comando Dettagli.
- Nei dodici stati non è stato rilevato overflow orizzontale. I tre errori
  console corrispondono a GET `/api/icd/proxy` con risposta 503, nella demo
  priva di servizio WHO configurato: non è una verifica con console pulita.

Le immagini e le misure sono conservate nella ricevuta privata
`ui-harmony-98fb/ui-harmony-qa.json`. La precedente prova su `5e4a3aef6`
aveva rilevato il peso 650 nelle impostazioni; l'ultimo allineamento lo porta
a 600 e la stessa verifica passa. Le sei immagini pubbliche acquisite su
`e7f8a555a` sono precedenti a questi ritocchi e devono essere sostituite prima
del rilascio. Gli stati AI non vengono alterati nelle immagini.

La successiva segnalazione visiva ha evidenziato filtri ancora a raggio 7 px:
il controllo su `98fb` misurava i comandi elencati, non quei filtri.
I commit `23beeda7d` e `ce9746954` uniformano selettori, comandi delle
impostazioni e indicatori condivisi. Sul bundle `e49d87c0d` sono stati
verificati **24 stati**: lista, impostazioni, repertori e prestazioni a
1440, 965 e 390 px, in tema chiaro e scuro. Le 102 osservazioni dei comandi
e 54 degli indicatori hanno raggio 12 px; i comandi hanno altezza minima
44 px, gli indicatori 32 px e testo di almeno 13 px. La distanza tra i
filtri è 8 px; tra filtri, ricerca e intestazione è 16 px. Nessuna
sovrapposizione o eccedenza orizzontale rilevata; contrasto minimo
misurato 5,07:1. I sei errori console corrispondono al servizio WHO 503
già descritto. Ricevuta: `ui-controls-e49-02/receipt.json`.

`b938fa4b717940859eea6f4468175ae6e6e2998b` corregge inoltre il conteggio:
stesso carattere della UI, titolo 20 px e testo di supporto 14 px, con
baseline condivisa. **8 stati** della lista a 1440, 965, 390 e 320 px,
nei due temi, hanno superato i controlli di allineamento, ricerca con
0/1/3 risultati, cancellazione e ritorno del focus, filtri attivi/archivio,
assenza di overflow ed errori console. Ricevuta: `ui-heading-b938/receipt.json`.
Build webpack, TypeScript e standalone/AnyDoc PASS su questo SHA; digest
del bundle preservati. Dopo il riavvio con i metadati derivati dalla
ricevuta, HTML e API espongono il fingerprint atteso. Non è una nuova
esecuzione CI. Il lint mirato non rileva errori; resta il warning già
presente sul consumer `useVirtualizer`, non modificato dal diff.

La prima prova ordinaria Document Synthesis su `9fe74f257` si ferma con
`context_missing` prima della conferma: il contesto dell'ambulatorio è assente
nella sessione nuova. Nessuna richiesta alle route AI è stata osservata.
Il riesame sorgente verde non chiude questo problema del percorso reale.

La correzione `bcbfb912e` aggiunge una scelta esplicita dell'ambulatorio,
senza cookie o valori predefiniti, con nomi leggibili e nuova lettura prima
della selezione confermata. L'addendum indipendente Daybreak sul delta a cinque
file non rileva finding: 28/28 test mirati e 8/8 test crosswalk PASS. La prova
ordinaria successiva sul bundle `5e4a3aef6` supera scelta, conferma e capture,
ma il primo ingest risponde **409 `capture_consumed`**. Non è stata prodotta
una sintesi validata. Questa evidenza resta distinta dai test sorgente verdi.

Il successivo fix del broker, integrato in `e49d87c0d`, supera la perdita
di continuità fra projection autentiche. Il coordinatore ha rieseguito
33 test PASS; la review indipendente non rileva finding. La nuova prova
ordinaria osserva selection GET/POST 200 e capture 200, quindi il primo
ingest termina **409 `selection_changed`**: nessuna preview o inferenza.
La diagnosi sorgente individua la riemissione della selezione nel binder
AnyDoc durante ingest, che cambia gli epoch controllati da DS. Il ramo
live preciso non è distinguibile dalla sola risposta 409. Il nuovo
intervento di composizione resta da implementare e verificare; non si
allentano le fence e non si promuove il percorso documentale a funzionante.

## CI: risultati conservati e correzioni locali

La CI E2E della PR su `c2db2521` ha raccolto 187 casi: **131 PASS, 5 FAIL,
2 flaky e 49 SKIP**. Restano i fallimenti relativi alla lettura delle etichette
AI, alla precondizione WHO e all'asserzione console dei tre web smoke;
i due casi flaky riguardano la densità della lista. Nelle tracce esaminate i
409 provengono da `/api/auth/lock`, non da scritture cliniche. La causa interna
dell'invalidazione non confermata non è stata dimostrata dalle sole tracce.

Il commit locale `d7d3271de` prepara la fixture E2E sotto `os.tmpdir()`, marca
i dati sintetici e mantiene il divieto di copia legacy nei passi successivi.
Parsing YAML, `bash -n`, seed reale su directory nuova e precondizioni WHO
invariate sono passati con Node 24.19.0: un utente sintetico, zero pazienti,
un ambulatorio predefinito. Non è una nuova esecuzione CI o browser.

La compilazione Apple in CI ha inoltre rilevato un'assegnazione a una proprietà
con setter privato nel nuovo test PIN. La correzione locale `2831cf427`
mantiene l'asserzione sullo stato della nuova sessione; il parse è passato,
ma la CI Apple sul nuovo commit resta da eseguire.

## MCP, Mini e limiti di distribuzione

Il sorgente del [Supervisor](../../lib/security/portable-supervisor-child-processes.ts)
avvia Web e MCP come figli distinti. Lo [smoke canonico](../../scripts/mediflow-headless-supervisor-standalone-smoke.mjs)
verifica anche la conferma Web e l’unicità di aggiornamento/audit.
Mini vive in [packages/mini/src/cli.ts](../../packages/mini/src/cli.ts):
`lib/mini/` non esiste in questo tree. Come chiarisce il [README](../../README.md),
la CLI condivide il catalogo ma **non ha un binding Supervisor di produzione**;
senza parent AIP fallisce chiusa. Il PASS MCP non è una prova Mini end-to-end.

I volumi Xcode e VM sono indisponibili. Nessuna nuova esecuzione locale Swift
XCTest, firma, UI nativa o prova multipiattaforma è attestata qui. La verifica
UI iPhone–Mac/Home Base resta differita al post-release. Le sei schermate Web
sono state acquisite sul runtime di produzione `e7f8a555a`, con login ordinario
e cartelle inventate: `worklist`, `record`, `diary`, `documents`, `access`,
`analytics`. Il [manifest delle immagini](../images/getmediflow-086/manifest.json)
riporta SHA, dimensioni e provenienza. Nessun ritocco della UI nelle immagini.
La timeline è stata acquisita dopo la verifica della continuità fra i nodi.
La schermata documentale mostra l'anteprima AnyDoc ottenuta con l'azione manuale
di estrazione di un PDF dimostrativo; non mostra OCR o sintesi AI.
Questa acquisizione prova quelle schermate, non la validazione completa dei flussi.

Manca l’artefatto firmato di produzione con digest e verifica degli entitlements
effettivi. È un’assenza di prova di distribuzione, non un finding di isolamento.
ThisDeviceOnly è esplicito al nuovo inserimento della chiave cache, non per il
token paired né come attestazione degli item preesistenti. Il futuro RBAC
operatore–ambulatorio è un non-goal esplicito di ADR 0036, non un difetto di
sicurezza rimasto da correggere; non autorizza claim di isolamento multioperatore.

Il parent dovrà registrare CI verde sull’esatto candidato e, dopo pubblicazione,
PR, merge SHA, tag e ricevuta del pacchetto sorgente. L’autorizzazione al rilascio
non ne prova il completamento. Nessun installer firmato è attestato.

## Provenienza sanitizzata

SHA-256 ricalcolati dai file esterni originali. Le ricevute e i log restano
fuori Git; i nomi sono identificatori di evidenza, non link pubblici. I digest
provano identità del contenuto, non esecuzione indipendente di questa lane.

| Fonte | SHA-256 |
| --- | --- |
| `daybreak-pin-addendum/addendum.md` | `ddf059451b38cd81d164a4068ce55105f1985ec3cb916356bb5782a522361fc2` |
| `daybreak-pin-addendum/review-receipt.json` | `09ac621eafc97fb98c5b934d9cafa16ed5130bc10c1f3e2e4b0e813cba86f9d3` |
| `daybreak-json-addendum/addendum.md` | `613e52cb7abe0973e0066f413754992da529bfc4531982ab291d6f3ad4e8fdff` |
| `daybreak-json-addendum/review-receipt.json` | `2ae1dcda74700e8453a1535e57b90720694c9cf143116a673532159d706013be` |
| `daybreak-attachment-fix-addendum/addendum.md` | `da6ccb7ab515295f2d8686c890d3ceb1c24cfc93b859371860bc0c569fcef9b8` |
| `daybreak-attachment-fix-addendum/review-receipt.json` | `8e0a916dd9457ba70c5888ec7a8c3e0a90cb41ad093fd8cabb337f705bf0c405` |
| `build-receipt.json` | `dbb2b12d02071ca6b161ff12dcea9a731298b74e472bae1f8573891d1cb2116d` |
| `build-integrated.log` | `1893838939ba2616e3dba76b34e782b103dde51c0525ac4f4cbdebf61b754e90` |
| `supervisor-current.log` | `69f3589ba9cd992fa1808e9ed61689fdc997c1acd7df12b263717e3886ad76c5` |
| `unit-integrated-unsandboxed.log` | `a0fd4a3856f61dd5d3319385093ae4938743d4238c1dec8774bf0bde8375f001` |
| `anydoc-composition-idle.log` | `8d17c1659eefbf487802610018d535e392667dadd9896bf0369f8407521d53c8` |
| `attachment-budget-integrated.log` | `dacb6899a0843245e55a0d9f913fb7dbeaea65c71bc6bd650d78af86ae213427` |
| `daybreak-ds-addendum/addendum.md` | `d4a2499d8078732f553751c97265a2271e037351b55ee0ed1da54e1d87ba5900` |
| `daybreak-ds-addendum/review-receipt.json` | `995e5c6b555f850ceecbfbcf94462193a8fea995e3af52fbd932f92b28973d6f` |
| `daybreak-ds-context-addendum/addendum.md` | `1305856b3bd8f7d49e9fd839aa9dbc138af05c417e29b9351bed27c0a04bb44b` |
| `daybreak-ds-context-addendum/review-receipt.json` | `d496b96cf53aa6af8f11657a27d701afd35b88261673db2f7bb8c4a5fe4fe5e9` |
| `daybreak-ds-owner-addendum/addendum.md` | `7d5d9cb85589060c0fb153fe750a35ad5ae7d250c7dc04b9e16b0ee5f3261afc` |
| `daybreak-ds-owner-addendum/review-receipt.json` | `3a04232b3ed0148f4818e4ad8fec93271ab3a817529b5a34f6f7f4fa45407431` |
| `ui-controls-e49-02/receipt.json` | `de4f26fbaaa9c07077f6adc00637a9779fddc200bdce9990e04e5cb5af36ca33` |
| `ui-heading-b938/receipt.json` | `13c5160450cafdb9db2dc6d3b629d4152d981e60ff39b735cefc1e31a5caa9e3` |
