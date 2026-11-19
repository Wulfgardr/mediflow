# Contribuire a MediFlow

Se lavori al progetto, parti dai dati delle prove, che devono essere sintetici. Non introdurre PHI o PII reali nella repository, nelle fixture, nei log o nelle catture, inclusi screenshot, database esportati e campioni anonimizzati reversibili. Anche gli accessi e la storia delle modifiche vanno protetti.

Apri una PR per problema, così riesco a seguire la modifica e le prove. Dimmi cosa non hai verificato e riconosci le fonti esterne in [CREDITS.md](./CREDITS.md).

## Prima di iniziare

Ho scelto local-first, quindi per introdurre invii al cloud, telemetria, chiamate AI remote o sincronizzazione servono richiesta esplicita e documentazione. Se vuoi spostare un confine di sicurezza, prima serve un ADR.

Il lavoro va nella repository pubblica [`Wulfgardr/mediflow`](https://github.com/Wulfgardr/mediflow), unica sede per issue, branch, PR, tag e release. Quella privata precedente è archiviata e non va usata come mirror o destinazione di export. Dati ed artefatti sensibili restano fuori da Git: [SECURITY.md](./SECURITY.md) e [topologia del repository](./docs/repository-topology.md).

Verifica lo stato del worktree e del branch, poi parti da una issue pertinente ed apri un branch dedicato. Lascia intatte le modifiche altrui e separa i lavori concorrenti. Tieni commit e diff piccoli e coerenti, senza refactor laterali, e suddividi il lavoro per risultati verificabili, non per numero di file. Consulta la [mappa della documentazione](./docs/README.md), l’[architettura](./ARCHITECTURE.md) e gli ADR pertinenti. Consulta anche lo stato del sistema e la sicurezza per il componente, ricordando che le fotografie storiche valgono per la revisione indicata. In Linear registra risultato, criteri di accettazione, sequenza e dipendenze. Dopo aver consultato la documentazione, se resta un dubbio, fammi una domanda mirata sul punto aperto. Le prove valgono per la revisione verificata: se cambia un contratto, riesamina quelle interessate. Una consegna tecnica non autorizza da sola l’uso clinico o di dati reali.

## Avvio in locale

Servono Git, Node.js 24.x ed npm. Ollama è opzionale per Patient Insight, Smart Import e Document Synthesis.

```bash
git clone https://github.com/Wulfgardr/mediflow
cd mediflow
nvm use
npm ci
npm run prepare:dependencies
```

Apri `MediFlow.command` su macOS, `MediFlow.cmd` su Windows o `MediFlow.sh` su Linux. Da terminale, senza browser, usa `node scripts/mediflow.mjs --scelta sviluppo --senza-browser` per un albero modificato. Per la produzione usa `node scripts/mediflow.mjs --scelta web --senza-browser`: servono Git pulito e una build verificata della revisione corrente. `--scegli` ignora la preferenza salvata. Per il client Mac consulta la [guida nativa](https://github.com/Wulfgardr/mediflow/blob/cd20934e20afaf37c283a18966ac5ea72b8d1a31/docs/native-launch.md).

Per `scripts/run-strip-types.mjs --test`, anche tramite npm, imposta `MEDIFLOW_DATA_DIR` su una directory sintetica posseduta dal run. Non usare la directory reale e pulisci solo dopo la fine dei processi figli, perché il launcher conserva il percorso fornito esplicitamente ma non pulisce la directory. Fuori dal launcher E2E imposta anche `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`. I test devono creare le proprie fixture. I motivi sono negli [ADR 0130](./docs/adr/0130-node-test-data-dir-preflight.md) e 0138, indicati nella [mappa degli ADR](./docs/README.md).

Se `MEDIFLOW_DATA_DIR` è assente o vuota, il launcher termina prima del target con `MEDIFLOW_TEST_DATA_DIR_REQUIRED`. Un import statico può aprire il database prima degli hook della fixture: il percorso esplicito impedisce al runtime la copia automatica di `medical.db` dalla directory di lavoro, mentre il preparatore E2E ha un controllo distinto e il launcher dei test imposta la variabile indicata sopra.

Il launcher verifica ogni percorso e glob incluso prima di avviare i test. Se una selezione richiesta non trova alcun file, l'intero comando fallisce anche quando gli altri percorsi sono validi.

Per la produzione il lanciatore costruisce la build quando serve. La pagina Avvio e Ctrl+C arrestano solo i figli che gli appartengono. `scripts/Launch_MediFlowMac.command` prepara il bundle come strumento interno, mentre la voce «App per Mac» è l’ingresso per l’utente e richiede un bundle costruito e un’identità coerente.

## Verifica

Per guidare una postazione sintetica dalla riga di comando, vedi il [banco di collaudo dell’interfaccia](./docs/ui-cli.md).

Il job `repository-guards` esegue `npm run check:test-selection`. Per la suite unit, il controllo segue `test:unit` in `package.json` fino a `scripts/run-unit-suite.mjs` e richiede la chiamata `npm run test:unit` nel job `web-core` di `.github/workflows/web-core.yml`, sulle PR e sui push a `main`.

Per i documenti parti da questi comandi:

```bash
git diff --check
rg --files -g '*.md' | sort
```

Aggiungi i controlli della CI e quelli pertinenti alla modifica. Per una PR sono richiesti `npm run lint`, `npm run build`, `npm run check:never-regress` e `npm run check:claims`. Consiglio anche `npm run typecheck`. `npm run lint:full` mostra gli avvisi non bloccanti.

Il never-regress blocca credenziali predefinite nel runtime, endpoint runtime non locali, telemetria attivata implicitamente e violazioni delle invarianti minime zero-knowledge. Il claims guard applica i limiti dell’ADR 0065 su autonomia clinica AI, applicazione senza revisione, affermazioni di integrazione regionale SISS/FSE come già esistente, cloud predefinito, cifratura dell’intero database, FHIR non qualificato, garanzie GDPR, topologia presentata come limitata a un solo dispositivo e codifica ICD obbligatoria.

Per chiudere il lavoro chiedo che i controlli applicabili siano verdi. Quando tocchi questi percorsi, esegui anche i controlli indicati:

- `/api/v1/*`: `npm run check:openapi:drift`. Aggiorna la specifica nello stesso diff o dichiara `no contract impact`. Incompatibilità e deprecazioni richiedono un ADR nuovo o l’aggiornamento di quello applicabile prima del merge. Il controllo usa `docs/openapi/contract-policy.json` per distinguere endpoint stabili, quelli fuori dalla parte stabile e deroghe tracciate.
- Concorrenza pazienti, `patients.version`, compare-on-write, payload `409 VERSION_CONFLICT` o write path `/api/patients/*` e `/api/v1/patients/*`: `npm run test:concurrency:patients`.
- Nuova anagrafica da documento: `npm run test:patient-document-import`.
- Document intelligence e allegati, compresa l’estrazione degli allegati per cui entrambi i controlli AnyDoc devono passare: `npm run test:document-synthesis`, `npm run test:ai-context`, `npm run test:pdf-service`, `npm run check:anydoc-local-only` e `npm run test:anydoc-local-only`.
- Percorsi Fabric, composizione production, contratto di scambio o UI di ricevute e provenienza: `npm run check:fabric-generative-runtime-crosswalk` e `npm run test:fabric-generative-runtime-crosswalk`. Per il confine dei modelli anche `npm run test:function-models`.
- Headless, AIP, MCP o Mini: `npm run check:headless-portable-imports`, `npm run test:headless-portable`, `npm run test:mcp:intelligent-host` e `npm run test:mini-cli`.
- `/api/v1/network/*`, `lib/network-*`, pairing o sessione home-base: `npm run test:network:home-base-readonly`, `npm run test:network:home-base-write` e `npm run test:network:home-base-diary-write`. Per le prove mobile vedi [native-testing](./docs/native-testing.md).

Se cambi l’interfaccia, verifica il percorso e la comprensibilità di etichette, descrizioni, azioni e stati per un medico senza conoscenze tecniche, secondo [DESIGN.md](./DESIGN.md#plain-language-for-physicians). Una funzione interagibile richiede un percorso UI esplicito e coerente, con pulsante o CTA e label comprensibile. Il medico deve capire significato, scelta e conseguenze senza spiegazioni dello sviluppatore: gergo non spiegato e azioni ambigue impediscono l’accettazione anche con test verdi. Se cambia il comportamento o anche solo il contratto, aggiorna la documentazione nella sede pertinente, README, ARCHITECTURE o ADR. Se aggiungi, togli o rinomini file Markdown, aggiorna `docs/markdown-index.md` con elenco e sintesi dei file e, se cambia ownership o priorità, `docs/README.md`.

La quarantena in `e2e/quarantine.json` ammette solo le firme registrate entro la scadenza: i test continuano a girare, errori diversi e cleanup falliti bloccano il gate. Non rinnovare automaticamente le scadenze. Prima del rilascio rimuovi le voci o ottieni la decisione prevista da WUL-735.

Nel registro di quarantena WUL-729 ogni voce ha responsabile, diagnosi e scadenza UTC. Tutte le asserzioni continuano a girare e i report list, HTML e `test-results/quarantine-*` conservano gli errori. Alla scadenza la deroga decade, e anche i processi interrotti restano bloccanti. Playwright usa il reporter condiviso e l’harness `node:test` legge lo stesso registro tramite `chatgpt-product-focused-tests.mjs`.

Per la nuova anagrafica esegui il test indicato anche se tocchi `components/patient-document-import-review.tsx`, `lib/domain/documents/patient-import-decision.ts`, `lib/domain/documents/patient-document-review.ts` o la persistenza prudente delle terapie nel create-flow. I test di document intelligence valgono anche per `lib/ai-providers/fabric/document-synthesis-production-operation.ts`, `lib/domain/documents/document-parse-evidence-artifact.ts`, `lib/ai-context.ts`, `lib/domain/documents/anydoc-*`, route OCR legacy, `components/document-upload.tsx`, `app/api/attachments/route.ts` e lettura o persistenza di `summarySnapshot` e `parseEvidenceArtifactSnapshot`.

## Confini tecnici

Per schema e migrazioni segui [ADR 0080](./docs/adr/0080-serialize-sqlite-schema-guards-at-bootstrap.md): conserva apertura esplicita, transazione e separazione della build dal database persistente. Preferisci migrazioni esplicite e verifica schema, route e client. Per dubbi su `drizzle-kit` consulta la documentazione Drizzle ORM, mentre per auth e dati consulta [SECURITY.md](./SECURITY.md). Gli endpoint web richiedono sessione valida, mentre quelli nativi richiedono un token API locale e restano versionati. Non mettere campi cifrati nei log. Se aggiungi un endpoint, ti chiedo di documentarlo almeno nella descrizione della PR, così la modifica è accompagnata dalle informazioni sul nuovo percorso.

Se cambi cifratura, derivazione delle chiavi, PIN, auth, sessioni, API native, discovery o networking, oppure un altro confine architetturale durevole, scrivi prima un ADR. Il [modello](./docs/adr/0000-template.md) è nella cartella degli ADR.

AnyDoc resta il primo passaggio locale: solo le pagine `needsOcr` arrivano all’elaborazione successiva, con controllo delle fonti e arresto se mancano i requisiti. Le route OCR legacy autenticate restano `410`. DeepSeek-OCR 2 è fuori dal perimetro 0.8.5: una futura promozione richiede adapter, benchmark sintetico italiano, soglie ed E2E con provenienza, hash e qualità per pagina, senza invii impliciti.

Nei percorsi intelligenti l’host governa provider, modello, endpoint, prompt, ripiego e applicazione. Il risultato resta `proposal_only`. Per le opzioni ammesse consulta [ADR 0129](./docs/adr/0129-function-model-catalog-preferences.md). I provider remoti restano disattivati per default e le prove non richiedono credenziali reali. Se li modifichi, mantieni distinti tipo, istanza, auth, modello, capability, gruppi, binding, allowlist e classi di credenziale. Un login consumer o una sottoscrizione consumer o dell’host non autorizzano inferenza via API. Non copiare codice GPL né implementare OAuth privati o ricostruiti da sessioni consumer.

Per Headless, AIP, MCP e Mini consulta l’[architettura](./ARCHITECTURE.md) e gli ADR pertinenti nella [mappa](./docs/README.md). Per F10 MCP può creare solo l’anteprima della transizione checkup e non riceve né la proof né l’autorità di commit. Proof e commit restano nella UI Web trusted, che rilegge i dati e richiede ruolo medico attivo, step-up, gesto specifico per l’operazione, validità corrente, CAS, idempotenza, audit e ricevuta.

Nel bootstrap del database conserva gli import senza apertura o migrazione dell’archivio e la serializzazione di schema e versione nella stessa transazione SQLite `IMMEDIATE`, dopo la verifica di un originale recuperabile. Durante `NEXT_PHASE=phase-production-build` i metadati usano SQLite in memoria: non introdurre effetti sul database persistente, seconde connessioni di controllo o aggiramenti della transazione. Le regressioni dedicate usano database temporanei sintetici. Lo schema runtime, le dichiarazioni ORM e le migrazioni storiche sono fonti distinte e queste ultime non vengono rieseguite automaticamente. Se aggiungi o rinomini colonne, verifica insieme schema e migrazione, route di lettura e scrittura e client. Mantieni stabili i contratti per i client nativi quando aggiungi endpoint.

Nel confine OCR della 0.8.5, instradamento, manifest, materializzazione, rendering e controllo preliminare devono rispettare i limiti e fermarsi se mancano i requisiti, senza ripieghi impliciti. Apple Vision sul Mac elabora solo le pagine PDF marcate `needsOcr` e l’host ricompone il risultato controllando la validità delle fonti. Gli input non supportati falliscono chiusi, AnyDoc non è un provider né una sede Fabric e DeepSeek-OCR 2/CUDA resta fuori dal perimetro, con soli contratti e raccordi sintetici. Treatment Reasoning resta nel catalogo come non disponibile e non richiede modelli, runner o installazioni aggiuntive, come spiegato nell’[ADR 0180](./docs/adr/0180-athena-fuori-dal-nucleo-modelli-per-dominio.md).

Nel crosswalk i quattro percorsi sono Patient Insight, Smart Import, Document Synthesis e Treatment Reasoning. Il chiamante non sceglie provider, modello libero, endpoint, sede di esecuzione, prompt, ripiego o applicazione. Il catalogo host ammette solo `modelOptionId` opaco con `expectedCatalogRevision`, risolto da `FunctionModelDispatch`, e preferenze e preset non ammettono provider.

Per F7, le prove amministrative Document Synthesis restano soggette a revisione e `default OFF`. Tieni distinte le credenziali `local_model`, `api_key`, `provider_oauth` tramite flusso ufficiale e `host_subscription`, che non equivale ad accesso API. Il modello provider v2 comprende secret broker e adapter HTTPS ufficiali OpenAI e Anthropic. La composizione production richiede ciclo di vita attivo, opt-in dell’host, condizioni esplicite di invio e conservazione e riferimento al segreto. I test usano trasporto simulato: non dichiarare verificati credenziali, rete reale o disponibilità cloud e non usare OAuth ricostruito tramite reverse engineering.

Tieni distinta l’esecuzione di un provider in MediFlow dall’invocazione di MediFlow da un host intelligente. Nel secondo caso il Supervisor Node locale avvia Web standalone e MCP `stdio` come figli distinti su IPC ereditato, e MCP usa solo RPC AIP e Application Services nominate, senza listener proprio o accesso diretto a SQLite. La lane WUL-696 usa `mini:production`, con Web e Mini figli, sessione NDJSON con gli stessi comandi della CLI e attivazione Web obbligatoria. Mini si arresta senza parent AIP. Per la 0.8.5 non dichiarare installer, onboarding o compatibilità con host MCP esterni e non introdurre broker residente o UDS.

## Aprire una PR

Apri una issue, proponi un piano piccolo che dica cosa cambia, quali file tocchi e come verifichi, e usa il [modello di PR](./.github/pull_request_template.md). Raccontami come hai accertato il problema, cosa hai cambiato, le prove svolte, cosa hai osservato e cosa resta non verificato. Chi apre la PR ne risponde e deve saper spiegare scopo e prove. Una consegna è completa quando il percorso funziona nella destinazione dichiarata, compresi avvio, configurazione e collegamenti necessari: distingui verifica, integrazione, pubblicazione e funzionamento.

### Contributi scritti con agenti

Uso anch’io gli agenti e accolgo questi contributi alle stesse condizioni degli altri. Se contribuisci con il loro aiuto, inserisci il trailer `Co-Authored-By` in ogni commit scritto con un agente, indica le fonti in [CREDITS.md](./CREDITS.md) e documenta le prove. Valuto problema, perimetro e prove, non lo stile di scrittura né il sospetto che abbia scritto un agente. L’attribuzione serve per il contributo, non lo stile di scrittura. Il codice va comunque verificato: i test verdi da soli non bastano senza prove sul comportamento cambiato. Indica modello e strumento in fondo alla PR e, per codice, testi o design ripresi da altri, fonte e licenza nella PR e aggiorna [CREDITS.md](./CREDITS.md). Spiego come lavoro nella [pagina sullo sviluppo assistito](./docs/development-usage.md#che-cosa-significa-assistito).
