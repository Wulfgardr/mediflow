# Contribuire a MediFlow

Se lavori al progetto, parti dai dati delle prove. Devono essere sintetici. Nessun paziente reale in repository, compresi screenshot, log, database esportati e campioni anonimizzati reversibili. Anche gli accessi e la storia delle modifiche vanno protetti. I dati veri restano fuori.

Una PR per problema. Riesco così a seguire la modifica e le prove. Dimmi cosa non hai verificato e riconosci le fonti esterne in [CREDITS.md](./CREDITS.md).

## Prima di iniziare

Ho scelto local-first. Per introdurre invii al cloud, telemetria, chiamate AI remote o sincronizzazione servono richiesta esplicita e documentazione. Se vuoi spostare un confine di sicurezza, prima serve un ADR. Prima il perimetro.

Il lavoro va nella repository pubblica [`Wulfgardr/mediflow`](https://github.com/Wulfgardr/mediflow). Quella privata precedente è archiviata e non va usata come mirror o destinazione di export. Dati ed artefatti sensibili restano fuori da Git: [SECURITY.md](./SECURITY.md) e [topologia del repository](./docs/repository-topology.md).

Verifica lo stato del worktree e del branch. Parti da una issue pertinente ed apri un branch dedicato. Lascia intatte le modifiche altrui e separa i lavori concorrenti. Tieni commit e diff piccoli e coerenti, senza refactor laterali. Ti chiedo di dividerli per risultato verificabile. In Linear tengo risultato, criteri di accettazione, sequenza e dipendenze. Consulta la [mappa della documentazione](./docs/README.md), l’[architettura](./ARCHITECTURE.md) e gli ADR pertinenti. Le prove valgono per la revisione verificata: se cambia un contratto, riesamina quelle interessate. Una consegna tecnica non autorizza da sola l’uso clinico o di dati reali. Un merge non basta.

<a id="-getting-started"></a>

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

Per `scripts/run-strip-types.mjs --test`, anche tramite npm, imposta `MEDIFLOW_DATA_DIR` su una directory sintetica posseduta dal run. Non usare la directory reale e pulisci solo dopo la fine dei processi figli. Il launcher non pulisce la directory. Fuori dal launcher E2E imposta anche `MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`. I test devono creare le proprie fixture. I motivi sono negli [ADR 0130](./docs/adr/0130-node-test-data-dir-preflight.md) e 0138, indicati nella [mappa degli ADR](./docs/README.md).

## Verifica

Per i documenti parti da questi comandi:

```bash
git diff --check
rg --files -g '*.md' | sort
```

<a id="type-checking-consigliato"></a>

Aggiungi i controlli della CI e quelli pertinenti alla modifica. Per una PR sono richiesti `npm run lint`, `npm run build`, `npm run check:never-regress` e `npm run check:claims`. Consiglio anche `npm run typecheck`. `npm run lint:full` mostra gli avvisi non bloccanti.

Quando tocchi questi percorsi, esegui anche i controlli indicati:

- `/api/v1/*`: `npm run check:openapi:drift`. Aggiorna la specifica nello stesso diff o dichiara `no contract impact`. Incompatibilità e deprecazioni richiedono un ADR prima del merge.
- Concorrenza pazienti o write path `/api/patients/*` e `/api/v1/patients/*`: `npm run test:concurrency:patients`.
- Nuova anagrafica da documento, compresi il componente di revisione, i moduli `patient-import-decision` e `patient-document-review` e la persistenza prudente delle terapie nel create-flow: `npm run test:patient-document-import`.
- Document intelligence e allegati, comprese la composizione di Document Synthesis, le evidenze di parsing, il contesto AI, AnyDoc, le route OCR legacy, il caricamento e la route degli allegati, la lettura e la persistenza di `summarySnapshot` e `parseEvidenceArtifactSnapshot`: `npm run test:document-synthesis`, `npm run test:ai-context`, `npm run test:pdf-service`, `npm run check:anydoc-local-only` e `npm run test:anydoc-local-only`.
- Percorsi Fabric, composizione production, contratto di scambio o UI di ricevute e provenienza: `npm run check:fabric-generative-runtime-crosswalk` e `npm run test:fabric-generative-runtime-crosswalk`. Per il confine dei modelli anche `npm run test:function-models`.
- Headless, AIP, MCP o Mini: `npm run check:headless-portable-imports`, `npm run test:headless-portable`, `npm run test:mcp:intelligent-host` e `npm run test:mini-cli`.
- `/api/v1/network/*`, `lib/network-*`, pairing o sessione home-base: `npm run test:network:home-base-readonly`, `npm run test:network:home-base-write` e `npm run test:network:home-base-diary-write`. Per le prove mobile vedi [native-testing](./docs/native-testing.md).

Se cambi l’interfaccia, verifica il percorso e la comprensibilità di etichette, azioni e stati per un medico, secondo [DESIGN.md](./DESIGN.md#plain-language-for-physicians). Una funzione interagibile richiede un percorso UI esplicito. Aggiorna la documentazione quando cambia il comportamento. Se aggiungi, togli o rinomini file Markdown, aggiorna `docs/markdown-index.md` e, se cambia ownership o priorità, `docs/README.md`.

Nella [quarantena E2E](./e2e/quarantine.json) ammetto solo le instabilità previste da WUL-729, con responsabile, diagnosi e scadenza UTC. I test continuano a girare con tutte le asserzioni. I report list, HTML e `test-results/quarantine-*` conservano gli errori. Alla scadenza la deroga decade automaticamente. Errori diversi dalla firma registrata, cleanup falliti e processi interrotti restano bloccanti. Non rinnovare automaticamente le scadenze. Prima del rilascio rimuovi le voci o ottieni la decisione esplicita prevista da WUL-735.

## Confini tecnici

Per schema e migrazioni segui [ADR 0080](./docs/adr/0080-serialize-sqlite-schema-guards-at-bootstrap.md): conserva apertura esplicita, transazione e separazione della build dal database persistente. Ti chiedo di mantenere i controlli di schema nella stessa connessione e transazione. Preferisci migrazioni esplicite e verifica schema, route e client. Per auth e dati consulta [SECURITY.md](./SECURITY.md). Gli endpoint web richiedono sessione valida e quelli nativi token locale e versione. Non mettere campi cifrati nei log. Se aggiungi un endpoint, ti chiedo di documentarlo almeno nella PR.

Se cambi cifratura, derivazione delle chiavi, PIN, auth, sessioni, API native, discovery o networking, oppure un altro confine architetturale durevole, scrivi prima un ADR. Il [modello](./docs/adr/0000-template.md) è nella cartella degli ADR.

AnyDoc resta il primo passaggio locale: solo le pagine `needsOcr` arrivano all’elaborazione successiva, con controllo delle fonti e arresto se mancano i requisiti. Le route OCR legacy autenticate restano `410`. DeepSeek-OCR 2 è fuori dal perimetro 0.8.5: una futura promozione richiede adapter, benchmark sintetico italiano, soglie ed E2E con provenienza, hash e qualità per pagina, senza invii impliciti.

Nei percorsi intelligenti l’host governa provider, modello, endpoint, prompt, ripiego e applicazione. Il risultato resta `proposal_only`. Per le opzioni ammesse consulta [ADR 0129](./docs/adr/0129-function-model-catalog-preferences.md). I provider remoti restano disattivati per default e le prove non richiedono credenziali reali. Se li modifichi, mantieni distinti tipo, istanza, auth, modello, capability, gruppi, binding, allowlist e classi di credenziale. Un abbonamento consumer non autorizza inferenza API. Non copiare codice GPL né implementare OAuth privati o ricostruiti da sessioni consumer.

Per Headless, AIP, MCP e Mini consulta l’[architettura](./ARCHITECTURE.md) e gli ADR pertinenti nella [mappa](./docs/README.md). Il [modello F7](./SECURITY.md#modello-provider-f7) e l’[ADR del Supervisor](./docs/adr/0117-headless-portable-agent-first-and-capability-first-fabric.md) raccolgono i vincoli dei due percorsi. MCP non riceve autorità di commit per la transizione checkup: proof e commit restano nella UI Web trusted, con ruolo, step-up, gesto, controlli di validità, CAS, idempotenza, audit e ricevuta.

## Aprire una PR

Apri una issue e dimmi cosa cambia, quali file tocchi e come verifichi il risultato. Usa il [modello di PR](./.github/pull_request_template.md). Raccontami come hai accertato il problema, cosa hai cambiato, le prove svolte, cosa hai osservato e cosa resta non verificato. Chi apre la PR ne risponde e deve saper spiegare scopo e prove. Una consegna è completa quando il percorso funziona nella destinazione dichiarata, compresi avvio, configurazione e collegamenti necessari: distingui verifica, integrazione, pubblicazione e funzionamento.

### Contributi scritti con agenti

Uso anch’io gli agenti. Accolgo questi contributi alle stesse condizioni degli altri. Se contribuisci con il loro aiuto, usa `Co-Authored-By` nei commit, indica le fonti in [CREDITS.md](./CREDITS.md) e documenta le prove. Valuto problema, perimetro e prove, non lo stile di scrittura o il sospetto che abbia scritto un agente. Il codice va comunque verificato. Indica modello e strumento in fondo alla PR e, per codice, testi o design ripresi da altri, fonte e licenza. Spiego come lavoro nella [pagina sullo sviluppo assistito](./docs/development-usage.md#che-cosa-significa-assistito).

Se la documentazione ti lascia un dubbio, fammi una domanda sul punto che resta aperto.
