---
summary: "Baseline WUL-670: sorgenti, prove sintetiche e disposizione dei branch prioritari per la 0.8.6."
read_when:
  - "Avviando OCR, WHO, Fabric, accesso, onboarding o design arena della 0.8.6."
---

# Baseline operativa MediFlow 0.8.6

Data: 5 settembre 2026. Issue: [WUL-670](https://linear.app/wulfgardr/issue/WUL-670).
Coordinamento: [WUL-669](https://linear.app/wulfgardr/issue/WUL-669).
Owner di questa ricognizione: Codex, task `01a072e2-b344-7411-864b-b1b67569d93c`.

## Base e ambiente

Base runtime: `b72ac713b624e7d771262e4e01c5c5e1f56f9ae2`.
`main` locale e `git ls-remote origin refs/heads/main` coincidevano all'avvio.
La base preparatoria `6a5463e8d` è antenata; la nuova base include il merge #350.
Repository operativa: `Wulfgardr/mediflow`.

Worktree baseline: `codex/WUL-670-086-baseline`. Le quattro modifiche documentali
preparatorie sono state copiate dalla checkout principale e conservate lì
invariate. Nessun branch storico è stato integrato o cancellato.

Ambiente osservato: macOS 27.0 arm64, Node 24.19.0, Swift 6.4, Next 16.3.4,
AnyDoc 0.2.4. Database creati da migrazioni e fixture sintetiche; copia legacy
disabilitata. Browser Chromium tramite Playwright, server isolato sulla porta
3286, terminato dal runner dopo i test. Nessuna configurazione privata copiata.

Due errori di allestimento sono stati distinti dal prodotto:

- Il nuovo worktree selezionava inizialmente Node 26, incompatibile con l'ABI
  SQLite installata. La verifica valida usa esplicitamente Node 24.19.0.
- Un collegamento a `node_modules` fuori dal worktree impediva al processo PDF
  isolato di leggere le dipendenze. La prova OCR valida usa una copia locale
  delle dipendenze nel worktree WUL-671, sullo stesso SHA runtime, senza
  allargare i permessi del renderer.

## Funzioni, osservazioni e destinazioni

| Funzione | Servizio e prerequisiti | Stato osservato e limite | Azione / issue |
| --- | --- | --- | --- |
| Testo negli allegati | `anydoc-current-source-composition.ts`, AnyDoc locale, sorgente corrente e sessione | Estrazione RTF reale e anteprima browser verificate. Upload e inferenza restano separati. | Estrai testo; consolidamento PDF in WUL-671. |
| Scansioni PDF | AnyDoc → `needsOcr` → materializzazione/rendering → Apple Vision → ricomposizione | Il test reale di composizione riconosce una scansione sintetica sul Mac. Non è ancora prova completa UI/installer né qualifica di accuratezza. | WUL-671: scansione e PDF misto dalla UI, errori e recupero, matrice di supporto. |
| Immagine singola | Apple Vision sa leggere raster; la composizione applicativa richiede routing PDF | Il motore riconosce un'immagine sintetica. Questo non prova l'accesso allo stesso motore dalla UI per un allegato PNG. | Esito applicativo esplicito e percorso manuale in WUL-671. |
| WHO ICD-11 | Application Service server-only, OAuth ufficiale e rete opt-in; binding `2026-01`/MMS/inglese | Stati disabled/credentials_absent/offline/configured/available/unavailable e cache verificati con transport sintetico. Nessuna credenziale o richiesta WHO live verificata. | WUL-672 decide online/sidecar e lookup; WUL-673 consegna setup e prova live. |
| Patient Insight | Production root Fabric, Ollama configurato per il ruolo, lifecycle/binding e interruttore | Registro e superficie browser verificati; nessuna inferenza del modello eseguita. | WUL-674: stato azionabile e prova sul binding target. |
| Smart Import | Production root Fabric, Ollama configurato per il ruolo e sorgente corrente | Registro verificato; nessun import assistito live qualificato da questa baseline. | WUL-674; conservare revisione prima di applicare. |
| Document Synthesis | Production root Fabric, Ollama e sorgente corrente, massimo sola proposta | Registro verificato; estrazione AnyDoc riuscita non significa sintesi AI riuscita. | WUL-674: separare i due esiti nella presentazione. |
| Treatment Reasoning | Production root Fabric, artifact ATHENA e runner MLX locali | Pagina modelli conserva il percorso separato da Ollama. Modello/runner non verificati sul target. | WUL-674: prerequisiti, prova e recupero dedicati. |
| Accesso | Owner lifecycle Web, sessione e PIN locali | Login sintetico accettato dalle route, sblocco e navigazione browser riusciti; revoca in-flight testata nella composizione. Cambio PIN, logout e recupero UI completi non ancora coperti qui. | WUL-675: completare matrice auth senza cambiare identità/authority. |

Il registro Fabric presenta ancora `ocr` come «Non disponibile» e «nessun
interruttore può riattivarla», anche se il percorso documentale separato può
eseguire Apple Vision. È un problema di comprensibilità riprodotto nella
superficie sintetica, non la prova che il motore locale sia spento.
La pagina WHO diagnostica legge soltanto readiness: `configured` non equivale
alla riuscita di una ricerca. Il metodo HTTP corrente espone ricerca/readiness;
il lookup puntuale e il cross-check richiesti vanno definiti in WUL-672.

## Sintomi UI e limiti

Impostazioni: la superficie browser è raggiungibile; il primo livello espone
termini quali lifecycle, receipt, venue ed egress. Lo screenshot sintetico
conferma la densità di metainformazioni segnalata. WUL-674/678 devono usare gli
owner esistenti per presentare funzione, stato e azione, conservando i dettagli.

Scheda paziente: apertura dell'archivio e navigazione provate con fixture. La
preferenza sulla composizione «a T» rimane una valutazione UX da confrontare in
WUL-676/677; questa baseline non approva un nuovo layout. WUL-561/562 e WUL-565
restano fonti di studio, non contratti visivi adottati.

Onboarding assistito, deslop globale e applicabilità GDPR/AI Act restano nel
programma. Questa ricognizione non inventaria tutto il debito, non decide
packaging/ruoli giuridici e non attesta conformità: WUL-681/683/685 possiedono
quegli esiti. Nessuna nuova issue duplicata creata.

## Registro dei recuperi prioritari

Prefisso di tutte le ref: `codex/hold/`. Conteggi riferiti ai percorsi toccati
dal branch dopo il merge-base, poi confrontati con la base corrente: un
percorso differente non equivale a una funzionalità mancante. Le ref complete
si ottengono anteponendo il prefisso ai nomi nella tabella.

| Branch | SHA | Differenti / toccati | Disposizione e motivazione |
| --- | --- | --- | --- |
| WUL-522-attachment-extraction-currentness-owner-v1 | `ee2191fc152e6d3eee04cf3adb62798d652df02c` | 2/2 | DEFER: aggiunge un owner storico non usato dalla composizione corrente; mantenere la source authority già collegata e i test di currentness. Riesame solo per un difetto scoperto. |
| WUL-522-attachment-extraction-currentness-owner-harden-v1 | `1a60f3e41f445fd49e2e6ab3dcf05ffe77c665dd` | 2/2 | DEFER: stessa famiglia, nessun trapianto del secondo owner. Intento di revoca/currentness già coperto da prove correnti; equivalenza completa non affermata. |
| WUL-522-local-ocr-apple-vision-execution | `3d7dcf457ac5b75c3a50b29c60e04efb0a39f74d` | 12/12 | ADAPT: conservare scenari di prova utili; adapter Fabric storico incompatibile con il percorso AnyDoc corrente. WUL-671 usa la composizione già presente. |
| WUL-522-fabric-provider-disclosure-v1 | `e90a9fe882f3d751542378e7163155268b15350c` | 9/9 | ADAPT: recuperare intento informativo in WUL-674. Il vecchio diff rimuove lifecycle e validazioni correnti sostituendoli con disclosure statiche. |
| WUL-559-web-states-lume | `784423913be1488ce90141b84407276b608a1178` | 12/16 | ADAPT: quattro percorsi già identici. Conservare scenari stato/recupero; i residui cockpit/live-query richiedono bisogno riprodotto, non merge del ramo. |
| WUL-560-web-keyboard-palette | `5d9c90b5205167f5918b4ac96ef6cd36b35ba4ca` | 8/10 | ADAPT: requisiti tastiera e ricerca per WUL-676/678/679. Nessun ripristino del vecchio cockpit. |
| WUL-560b-command-center | `131ea8f1a76e8a2ba4d8351fc2c4ccd21e0e35c0` | 7/10 | ADAPT: il trapianto eliminerebbe Analisi/Scale e riporterebbe focus differito. Conservare il componente corrente e valutare task pertinenti. |
| WUL-560c-keyboard-e2e | `0a7d964df2727a77e8f9cd1cf144d350c7d58c0b` | 9/11 | ADAPT: scenari test da confrontare con navigazione scelta; conteggio dei delta verificato, nessuna esecuzione del vecchio ramo. |
| WUL-560d-keyboard-e2e | `5fbe5eaa16b6f79eb578644afe0131dd58544238` | 8/11 | ADAPT: stessa destinazione del precedente, evitare duplicazione delle prove. |
| WUL-561-web-lume-mockup | `697fdfbe6dac05ff645db533d3550826e46197fd` | 40/40 | DEFER runtime, KEEP come studio WUL-676: la scelta Lume non è imposta all'arena. |
| WUL-562-web-inventory-after-icons | `93362ca505149f5d6c51502784395e65126921df` | 42/42 | KEEP come inventario di copertura per l'arena; nessun recupero integrale di UI e icone. |
| WUL-565-macos-inspector-strumento-carta | `c08d5c9e3b0bfd7725d5e9f3201549c49c914763` | 8/8 | KEEP come riferimento di pannello contestuale; implementazione Swift e parity native DEFER, fuori dalla tranche localhost. |

WHO #322/#340: ALREADY_COVERED per issuer e retirement richiesti nella
ricognizione. `bbee22c6d` e `ba2aac730` sono antenati della base; issuer ufficiale,
servizio e istruzioni di ritiro Docker sono presenti. Questo esito riguarda il
codice e i contratti, non setup o disponibilità WHO live.

Gli altri branch hold restano conservati e fuori da questa analisi mirata.
Nessuna chiusura retroattiva di issue 0.8.5/1.0 o PR storiche.

## Precedenza OCR da riallineare

ADR 0107 ritira Apple Vision automatico e descrive la scansione come terminale;
ADR 0111 introduce DeepSeek e nega fallback Apple Vision; ADR 0117 rende gli
engine opzionali e ammette Apple Vision. Stato del sistema, CONTRIBUTING e
composizione corrente documentano/eseguono invece il fallback PDF locale.
Anche alcune righe dell'indice Markdown assegnano ancora precedenza assoluta
ad ADR 0107. Sono riferimenti incompatibili da correggere insieme.

Destinazione WUL-671: fissare la precedenza per il percorso AnyDoc + Apple
Vision già presente, con formati/piattaforme e prove; preservare il ritiro
della capability Fabric e delle route legacy. Nessuna riattivazione automatica
di vecchi adapter, egress o provider per ottenere indicatori verdi.

## Verifiche e consegna

- 76 test passati, zero skip, sullo SHA base con dipendenze locali e Node 24:
  composizione current-source, motore Apple Vision, servizio/readiness/issuer
  WHO, presentazione Fabric e navigazione impostazioni. WHO usa transport fake;
  scansione e riconoscimento Apple Vision usano processi reali e input sintetici.
- 8 test browser passati: `web-auth-login-p3`, `settings-fabric`,
  `document-upload-anydoc-focus`, `web-smoke`; dati sintetici, webpack, un worker.
- Gli errori iniziali ABI e symlink sono conservati come prove di allestimento,
  separati dall'esito valido. Nessun guard del prodotto indebolito.
- Evidenza locale: `tmp-086-baseline/` nel worktree WUL-670 e
  `tmp-086-ocr/baseline-contracts.log` nel worktree WUL-671; output esclusi da Git.

WUL-670 consegna la baseline locale. Primo sviluppo funzionale: WUL-671,
iniziando dalle prove UI per PDF testuale, scansione, misto con ultima pagina
scansionata e immagine singola, poi correzioni dimostrate e contratto OCR.
WUL-676 può procedere indipendentemente, partendo da questa baseline sintetica.
Seguono decisione WHO, proiezione stati/accesso, onboarding, censimento debito e
matrice di applicabilità; scelta utente prima della UI finale.

Nessuna inferenza AI, richiesta WHO live, installazione esterna, mutazione
Linear, push, PR, merge, release o attestazione di conformità in questa baseline.
