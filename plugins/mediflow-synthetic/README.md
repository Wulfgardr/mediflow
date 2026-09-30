# MediFlow — prototipo con esempi inventati

Prototipo di fattibilità [WUL-756](https://linear.app/wulfgardr/issue/WUL-756),
separato dal runtime clinico. Due ingressi MCP Apps mostrano esempi inventati:
uno nella navigazione globale e uno nel pannello della conversazione. I tool
restituiscono anche testo utilizzabile da un host MCP senza interfaccia.

Il medico sceglie un esempio, legge il testo e può confermare la sua aggiunta
al contesto del modello. Selezione, apertura e annullamento non inviano questo
aggiornamento. L'host riceve comunque esempi inventati nei normali risultati
dei tool. Un server locale non garantisce elaborazione locale del modello.

Il prototipo non legge cartelle cliniche, directory dati, variabili cliniche,
credenziali o file scelti dall'utente. Non avvia Web, Supervisor o Mini e non
ha listener HTTP, persistenza, applicazione clinica o chiamate a provider.
Gli oggetti simili a ricevute sono fixture inventate: non provano
autorizzazione, integrità o provenienza clinica. Il campo `egress: none` della
fixture descrive soltanto il calcolo simulato, non il destino del contesto
della conversazione.

## Preparazione locale per sviluppo

Da questa directory, con Node 24 e npm:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
npm run test:browser
```

La prova browser richiede il Chromium della versione Playwright fissata:
quando manca, provisionarlo esplicitamente con
`npx --no-install playwright install chromium`. Lo script non lo installa
automaticamente. `npm start` espone MCP su stdin/stdout e attende un client;
non è un server Web da aprire nel browser. La build deve precedere l'avvio.

Dipendenze dirette fissate nel lockfile separato: `@openai/mcp-extensions`
0.1.0, `@modelcontextprotocol/sdk` 1.31.0, `@modelcontextprotocol/ext-apps`
1.7.5 e Zod 4.4.3. MCP Apps 2.0.3 non soddisfa il peer `^1.7.5`
dell'extension SDK 0.1.0. Questo pacchetto non modifica MCP 2.0 production.

## Pacchetto e limiti delle prove

`plugin.json` e `mcp.json` seguono i JSON Schema Agent Plugins 1.0.0, conservati
in `schemas/` e verificati offline con Ajv. Il manifest legacy
`.codex-plugin/plugin.json` e `.mcp.json` mantengono la compatibilità; i test
verificano identità, presentazione e configurazione server equivalenti tra le
due rappresentazioni. I percorsi sono relativi alla radice del plugin.

Il validator ufficiale plugin-creator non ha un percorso Mac verificato in
questo ambiente. Il parent ha eseguito il proprio helper cloud con esito PASS
sull'esatta coppia legacy manifest/companion fornita il 30 settembre 2026.
Quella prova non comprende skill, codice, asset, installazione o host reale.
Non è stata dichiarata esecuzione locale dell'helper.

I test Node esercitano client/server MCP reale in memoria e su stdio, il
contratto output production con una fixture, gli schemi del pacchetto e
l'interfaccia DOM. La prova Chromium usa l'App e le OpenAI Extensions
rilasciate, con un host simulato via postMessage: verifica conferma, annulla,
ripetizione, capability assente, viewport stretto e assenza di richieste rete.
La schermata prodotta in `dist/` è materiale locale sintetico, escluso da Git.
Queste prove non qualificano installazione o funzionamento in Codex reale.

Nessun marketplace o installazione personale viene creato. L'artefatto sorgente
richiede preparazione esplicita delle dipendenze e della UI; non è una ZIP
pronta per il pubblico. Install/update/removal appartengono a WUL-758.
La qualifica del percorso WUL-757 resta soggetta alle dipendenze WUL-731,
WUL-756 e WUL-590. La directory pubblica WUL-759 resta HOLD: le pagine correnti
[submission](https://developers.openai.com/plugins/deploy/submission),
[packaging](https://developers.openai.com/plugins/build/plugins) e
[conversione Claude](https://developers.openai.com/plugins/guides/submit-claude-plugin)
non attestano l'ammissibilità di questo pacchetto locale. Non creare tunnel
o esporre un database per soddisfare requisiti di distribuzione.

Decisione e confini: [ADR 0140](../../docs/adr/0140-synthetic-plugin-feasibility.md).
