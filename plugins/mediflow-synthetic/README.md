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

### Prova opzionale dell'agente Codex reale

Con il solo prototipo sintetico già installato e abilitato nel marketplace
personale, una build locale e un login Codex già disponibile:

```sh
npm run test:codex -- --codex-cli /percorso/al/codex --marketplace /percorso/assoluto/al/marketplace.json
```

Questo comando usa la quota dell'account per un turno `gpt-6.1-sol` a effort
`low`; non è parte di `npm test` o della CI. Non installa plugin, non richiede
credenziali e non scrive impostazioni personali. Avvia un proprio app-server
stdio, controlla il plugin locale `mediflow-synthetic@personal` e limita il
thread effimero ai suoi due tool. Shell, ricerca Web, app e altri server MCP
sono disabilitati solo per la prova; richieste ulteriori dell'host fanno
fallire il test senza concedere permessi. Il processo viene terminato anche
in caso di errore, senza ritentare il turno. Il risultato PASS viene emesso
solo dopo la chiusura e il controllo che configurazione e marketplace
personali siano rimasti identici. Il controllo delle notifiche è una prova
osservazionale del percorso sintetico, non una barriera di autorizzazione
per dati reali.

Il riferimento strutturato `mention` con
`plugin://mediflow-synthetic@personal` esplicita il plugin nel `turn/start`.
La verifica richiede notifiche reali `item/started` e `item/completed` per
entrambi i tool, una sola chiamata ciascuno con `{}`, identità del plugin,
testo e dati strutturati identici alle fixture e un turno concluso. Prosa del
modello o chiamate manuali RPC non bastano. Prima del turno, la risorsa HTML
letta dall'host deve avere lo stesso SHA-256 della build locale. L'output
conserva solo fatti e hash; non registra configurazioni, testo dell'agente,
payload rifiutati o stderr del processo.

Il 30 settembre 2026, Codex CLI 0.159.2 ha superato una prova con riferimento
strutturato: due invocazioni effettive dell'agente, risultati sintetici e
configurazione personale invariata. La precedente prova con solo prompt
testuale aveva prodotto zero tool call; il nuovo risultato qualifica il
percorso con riferimento esplicito, non l'autodiscovery. Nelle notifiche
`mcpAppUi` era assente: nessuna prova di sidebar, pannello desktop o
`modelContext.update` è stata ricavata dalla CLI. I due risultati normali
inviano già entrambi gli estratti inventati al contesto dell'agente.

Il protocollo è quello generato dal binario installato (`app-server
generate-json-schema`); `plugin/read` è ancora indicato come in sviluppo
nella [documentazione app-server](https://developers.openai.com/codex/app-server).
Questo è un harness di qualifica locale, non un client production. Il seam
[Proposed di disclosure](../../docs/analysis/2026-09-30-synthetic-mcp-disclosure-seam.md)
rimane separato, non collegato al plugin e con valutatore runtime chiuso.

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
