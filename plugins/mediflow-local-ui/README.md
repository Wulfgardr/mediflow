# MediFlow locale — pacchetto privato 0.1.0

Target qualificati nel dossier U1: Codex CLI 0.163.0-alpha.11.1 e Claude Code 2.1.308. Un solo server MCP e
Supervisor, profilo fisso `plugin_local_ui`. Il pacchetto apre la UI separata;
non incorpora una cartella nell'host, non restituisce CF/storia alla chat e
non permette al modello di ragionare su dati che non riceve.

La [matrice host del 23 ottobre](evidence/2026-10-23-host-qualification.md)
riporta prove CLI, lifecycle, canali osservabili e limiti delle app desktop.

## Preparazione locale

Node **24.x**, secondo `.nvmrc` e `engines >=24 <25`, dipendenze locali dal lockfile e build sorgente ammessa sono
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
fissa eseguibile Node, revisione e archivio in `runtime.json`. I manifest
portabile e Codex avviano `./bin/mediflow-local-ui`: il launcher POSIX legge il
Node fissato e avvia `src/launch.mjs`, indipendentemente dal PATH del client.
Il percorso Node deve essere assoluto, eseguibile e rappresentabile in JSON
senza escape (niente virgolette, backslash o caratteri di controllo); gli spazi
sono ammessi. Un percorso mancante o non eseguibile produce soltanto
`MediFlow navigation unavailable.` su stderr. L'ingresso successivo è
`source-runtime.mjs local-ui`, che verifica nuovamente il payload e la revisione
prima del Supervisor. File o ledger alterati, runtime assente e input extra
falliscono con errore fisso. Non avvia MCP bare e non aggiunge un HTTP generico.

La compatibilità delle patch **24.21.0** e **24.22.0** è verificata con fixture
sintetiche di packaging e avvio. Il verificatore canonico conserva i controlli
su major, ABI, piattaforma, architettura, ledger, identità e SQLite `:memory:`;
il pacchetto continua a richiedere il percorso fisico Node fissato alla preparazione.

Il pacchetto sorgente senza `runtime.json` è una template, non un'installazione
operativa. Una build bloccata dal controllo dati non va aggirata: la preparazione
richiede una build pulita ammessa. Non modifica le impostazioni globali dei client.

## Configurazioni dei client

`plugin.json`/`mcp.json` sono il formato portabile Agent Plugins 1.0.0.
`.codex-plugin/plugin.json` usa `.mcp.codex.json` con lo stesso launcher relativo.
`.claude-plugin/plugin.json` usa `.mcp.claude.json` e `${CLAUDE_PLUGIN_ROOT}`.
Identità, versione e istruzioni sono gli stessi. Il manifest Claude mantiene
il comando Node assoluto e il placeholder nativo già qualificati; il nuovo
launcher POSIX riguarda soltanto i manifest portabile e Codex. Per Claude Code,
caricamento temporaneo:

```sh
claude --plugin-dir /percorso/assoluto/plugin-pronto
```

Codex richiede il proprio caricamento locale del plugin; l'installazione
persistente va approvata separatamente. Per uno smoke con sola configurazione
MCP di sessione, usa il Node assoluto di `runtime.json` e il percorso assoluto
del file `src/launch.mjs`: questo prova il raccordo MCP, non il caricamento
del plugin o la UI nativa dell'app Codex. CLI, app Codex, Claude Chat/Cowork e
Desktop sono superfici distinte. Nessuna directory submission o ammissione
clinica è inclusa; WUL-759 riserva il contatto a Leonardo.

## Percorso del medico

Chiedi “Apri la ricerca locale di MediFlow”. Il tool accetta soltanto un
intento fra `search`, `identity`, `history`, `prescribing` e torna sempre
`continue_in_mediflow`. La ricevuta non attesta apertura o un esito clinico.
Il primo comando avvia il launcher ordinario staccato, con lo stesso ingresso di
`MediFlow.command`. L'invocazione effettiva è:

```sh
node scripts/mediflow.mjs --riusa
```

Conserva preferenza e selettore ordinari, senza riscrivere le preferenze.
Una scelta Mac o agenti può rendere la navigazione indisponibile: non viene
sostituita con Web. `reuse` richiede una build già ammessa e conserva l'avvio
ordinario dei servizi facoltativi, incluso Ollama se installato ma fermo.
La navigazione usa solo l'IPC ereditato dal launcher avviato in questa sessione.
Un runtime già aperto separatamente, o sopravvissuto a un precedente host, viene
rifiutato: arrestarlo dal suo launcher prima di una nuova sessione plugin.
Attende soltanto la readiness tecnica, entro il timeout; non attende lookup o rendering di un paziente.

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

Il raccordo possiede soltanto il figlio MCP. Il launcher ordinario possiede il Web:
chiudere l'host o rimuovere il plugin non arresta quel runtime né il lavoro aperto.
Il raccordo non adotta listener da `instance.json`: PID, porta e fingerprint
pubblico non sono credenziali. Il canale ereditato collega direttamente il
processo avviato alla sessione, senza discovery o POST di navigazione HTTP. Il runtime si arresta dal proprio launcher.
Rimuovere questo pacchetto non elimina archivio o chiavi. Aggiornamento/rimozione e qualifica
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
{"mcpServers":{"mediflow-local-ui":{"type":"stdio","command":"/percorso/node24","args":["/percorso/plugin-pronto/src/launch.mjs"]}}}
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

Per qualificare il caricamento effettivo del plugin Claude Code, usare
`--plugin-dir` e l'allowlist `mcp__plugin_mediflow-local-ui_mediflow-local-ui__mediflow_local_ui_navigate_v1`.
`--strict-mcp-config` esclude anche i server forniti dal plugin: non usarlo per
questa prova. Per escludere i connettori dell'account nella sola sessione usare
`ENABLE_CLAUDEAI_MCP_SERVERS=false` e `--setting-sources ''`.
Un server ancora `pending` non prova disponibilità del tool: attendere la
connessione e richiedere esplicitamente un nuovo intento, senza riprendere il precedente.
