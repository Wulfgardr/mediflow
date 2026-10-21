# MediFlow locale — pacchetto privato 0.1.0

Target: Codex CLI 0.163.0 e Claude Code 2.1.306. Un solo server MCP e
Supervisor, profilo fisso `plugin_local_ui`. Il pacchetto apre la UI separata;
non incorpora una cartella nell'host, non restituisce CF/storia alla chat e
non permette al modello di ragionare su dati che non riceve.

## Preparazione locale

Node **24.21.0**, dipendenze locali dal lockfile e build sorgente ammessa sono
prerequisiti. Non usa `npx` né scarica runtime al primo utilizzo. Da una
checkout sintetica pulita e ammessa:

```sh
export MEDIFLOW_DATA_DIR=/percorso/assoluto/archivio-sintetico
export MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1
npm ci
npm run build
node scripts/package-local-ui-plugin.mjs /percorso/assoluto/plugin-pronto "$MEDIFLOW_DATA_DIR"
```

Il preparatore verifica il ledger esistente prima di creare il pacchetto,
fissa eseguibile Node, revisione e archivio in `runtime.json` e rende assoluto
il comando nei manifest. Il launcher richiede il Node fissato e l'ingresso
`source-runtime.mjs local-ui`, che verifica nuovamente il payload e la revisione
prima del Supervisor. File o ledger alterati, runtime assente e input extra
falliscono con errore fisso. Non avvia MCP bare e non aggiunge un HTTP generico.

Il pacchetto sorgente senza `runtime.json` è una template, non un'installazione
operativa. Una build bloccata dal controllo dati non va aggirata: la preparazione
richiede una build pulita ammessa. Non modifica le impostazioni globali dei client.

## Configurazioni dei client

`plugin.json`/`mcp.json` sono il formato portabile Agent Plugins 1.0.0.
`.codex-plugin/plugin.json` usa `.mcp.codex.json` e `${PLUGIN_ROOT}`.
`.claude-plugin/plugin.json` usa `.mcp.claude.json` e `${CLAUDE_PLUGIN_ROOT}`.
Identità, versione, istruzioni e launcher sono gli stessi; il placeholder
Claude non è quello Codex. Per Claude Code, caricamento temporaneo:

```sh
claude --plugin-dir /percorso/assoluto/plugin-pronto
```

Codex richiede il proprio caricamento locale del plugin; l'installazione
persistente va approvata separatamente. Per uno smoke con sola configurazione
MCP di sessione, usa il comando Node assoluto generato in `.mcp.codex.json`
e l'argomento `src/launch.mjs`: questo prova il raccordo MCP, non il caricamento
del plugin o la UI nativa dell'app Codex. CLI, app Codex, Claude Chat/Cowork e
Desktop sono superfici distinte. Nessuna directory submission o ammissione
clinica è inclusa; WUL-759 riserva il contatto a Leonardo.

## Percorso del medico

Chiedi “Apri la ricerca locale di MediFlow”. Il tool accetta soltanto un
intento fra `search`, `identity`, `history`, `prescribing` e torna sempre
`continue_in_mediflow`. La ricevuta non attesta apertura o un esito clinico.
Il primo comando attende soltanto la readiness tecnica privata del Web, con
timeout; non attende lookup o rendering di un paziente.

Prima del login, o senza un documento connesso, si apre l'URL locale fisso
`/plugin-local-ui`, senza query o frammenti. Login/PIN, ricerca anche per CF e
scelta del paziente restano in MediFlow. Apri la cartella: un successivo intento
richiede una conferma locale sulla cartella visibile. Anagrafica riusa
PatientIdentityLens, storia la Timeline clinica con fonti. La guida distingue
farmaco, prestazione e protesica e rimanda ai gestori esistenti. Il medico
resta responsabile di terapia, conferma, firma e trasmissione.

Nessun intento viene conservato o ripreso alla riconnessione/login. Le
notifiche sono volatili, scadono dopo 15 secondi e vengono ritirate al cambio
contesto, revoca o disconnessione. L'interfaccia verifica l'epoch corrente prima
e dopo la conferma asincrona; non rinnova automaticamente un'intenzione superata.
Il profilo non compone operazioni, owner, lease o porte cliniche. Il precedente
grant profilo `none` rimane distinto e non viene chiamato local-only.

## Limiti del confine

Nessun dato paziente nei risultati, metadati, risorse, progress, errori o URL
del raccordo. La diagnostica Web non viene inoltrata all'host in questo profilo.
Un identificativo scritto direttamente nella chat è già fuori da questo canale.
Altri strumenti dell'host possono accedere a file, browser o screenshot se
hanno autorità propria: il plugin non isola il Mac e non garantisce anonimato.
Non usarli come ripiego a un tool negato.

Ogni istanza possiede i propri figli Web/MCP: non adotta processi preesistenti,
non crea broker residente e termina soltanto i figli posseduti. Rimuovere questo
pacchetto non elimina archivio o chiavi. Aggiornamento/rimozione e qualifica
clinica completa restano risultati separati, WUL-758/WUL-738. Il prototipo
`mediflow-synthetic` rimane indipendente e contiene soltanto esempi inventati.

### Nomi tool nel client Claude Code

Nel server MCP l'identità resta `mediflow.local_ui.navigate.v1`. Claude Code
2.1.306 normalizza il nome esposto all'agente con underscore. In una
configurazione MCP di sessione con server `mediflow-local-ui`, l'allowlist usa
esattamente `mcp__mediflow-local-ui__mediflow_local_ui_navigate_v1`, non il
nome con i punti. Il file di sessione deve usare Node e launcher assoluti,
senza placeholder riservati al caricamento del plugin:

```json
{"mcpServers":{"mediflow-local-ui":{"type":"stdio","command":"/percorso/node24.21.0","args":["/percorso/plugin-pronto/src/launch.mjs"]}}}
```

```sh
claude --print --no-session-persistence --setting-sources '' --tools '' \
  --strict-mcp-config --mcp-config /percorso/sessione-mcp.json \
  --allowedTools mcp__mediflow-local-ui__mediflow_local_ui_navigate_v1 \
  'Chiama soltanto il tool MediFlow con intent search e riporta lo stato tecnico.'
```

Questo è uno smoke del raccordo MCP, distinto dal caricamento del plugin.
La validazione del manifest non prova l'invocazione dell'agente. Un limite
`429 usage_limit_reached` interrompe la qualifica: non autorizza cambi di
account, overage, pagamenti o nuovi tentativi automatici. Lo stato locale del
client può aggiornarsi anche con impostazioni caricate solo per la sessione;
non ripristinare file globali sopra lavoro concorrente.
