# MediFlow 0.8.6: verifica del candidato sorgente

Aggiornamento: 7 settembre 2026. Programma WUL-669.

**7 settembre 2026 — correzioni sorgente verificate; CI e pubblicazione pendenti.**
Il blocco contrattuale PIN è chiuso a livello sorgente dall'addendum indipendente
`SOURCE_REVIEW_PASS` su `cefa5c78f43ada28e9d74f2d65e5f2173b15edb8`.
Il finding LOW `csf_e6ea8156c1fde74d61ebf750`, emerso nel primo addendum JSON,
ha esito `FIX_VERIFIED` su `be9233282c0ab18759b0e679b877d9dc30af5a99`.
I due file PIN e i sette file della correzione allegati sono identici nel
candidato integrato `11a42f68effbdc11cd6371bf050a6e2e074de5b3`.
Non restano finding reportabili nel sorgente revisionato; questo non certifica
la sicurezza generale. Il rilascio del pacchetto sorgente è autorizzato ma
attende CI verde. CI finale, PR, merge e tag non sono ancora attestati.

## Disposizioni degli addenda indipendenti

| Revisione | Sorgente esatto | Esito e limite |
| --- | --- | --- |
| PIN | `1d633d98d0a093623c8c4f488815af804c769a6e..cefa5c78f43ada28e9d74f2d65e5f2173b15edb8` | `SOURCE_REVIEW_PASS`, zero finding. Successo ed esiti ambigui ritirano autorità e presentazione locali; il conflitto pre-CAS tipizzato mantiene l’autorità. Parse Swift e never-regress PASS nella ricevuta; nessun XCTest o runtime Apple eseguito dalla review. |
| Primo addendum JSON | `1d633d98d0a093623c8c4f488815af804c769a6e..61ca67191c7a78955dcc097254c7cc988f715242` | `SOURCE_REVIEW_HOLD`: LOW `csf_e6ea8156c1fde74d61ebf750`, disponibilità del processo. Digest 30/30 verificati; 68/68 test dichiarati dall’owner, non rieseguiti dal reviewer. Questo esito resta storico. |
| Correzione allegati | `e7f8a555ac697c36adc60a36132a776e39d19a72..be9233282c0ab18759b0e679b877d9dc30af5a99` | `FIX_VERIFIED`: digest 7/7, test sintetici 63/63, typecheck focalizzato, ESLint e diff-check PASS nella verifica indipendente. |

La correzione allegati riduce il cap JSON a 30.408.704 byte, riserva uno slot
per istanza modulo prima della lettura e applica una deadline di lettura di
30 secondi. Il limite wire da 25 MiB resta distinto dal budget della busta.
Slot e contatore non coordinano processi diversi né limitano memoria già
allocata dal trasporto. La deadline non copre il servizio. Non sono state
misurate RSS, OOM o prestazioni sotto carico. Questi limiti non riaprono il
finding specifico verificato. OpenAPI è aggiornato in una lane separata e
richiede verifica del parent prima della promozione.

Il confronto Git dei due file PIN con `cefa5c78` e dei sette file del fix con
`be923328` non mostra differenze su `11a42f68`. Questo verifica l’integrazione
di quei sorgenti, non una nuova review esaustiva dell’intero tree.
Il [report originale](./2026-09-07-086-daybreak-security-review.md) mantiene
report inglese, hash e conclusioni storiche senza riscrittura retroattiva.

## Verifiche locali già eseguite: lettura delle ricevute

Questa lane documentale ha letto i log, senza rieseguire test, build o HTTP.

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
UI iPhone–Mac/Home Base resta differita al post-release. Il parent prepara
schermate web sintetiche da `e7f8a555a`: `worklist`, `record`, `diary`, `documents`,
`access`, `analytics` sotto `docs/images/getmediflow-086/`. La loro presenza e
revisione spettano alla lane immagini; questa lane ammette link ancora pendenti.
Le immagini non provano esecuzione AI, estrazione AnyDoc o OCR.

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
