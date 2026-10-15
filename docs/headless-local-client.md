# Headless locale: capacità e confine del client

Matrice v1, protocollo MCP `2026-07-28`. La fonte eseguibile è
[`OPERATION_DESCRIPTORS` e gli schemi](../packages/mcp/src/contracts.ts);
[`server.ts`](../packages/mcp/src/server.ts) registra anche i due tool di sistema.
`tools/list` elenca la superficie statica; `mediflow.system.capabilities.v1`
restituisce solo le operazioni effettivamente legate ai servizi del Supervisor.
Un tool elencato senza binding non è utilizzabile: restituisce un errore.

## Matrice del trasporto provato

Il client di qualifica è `mediflow-production-smoke` v1.0.0, JSON-RPC su stdio
nel [comando di smoke esistente](../scripts/mediflow-headless-supervisor-standalone-smoke.mjs).
Non contiene un modello. Versione dell'operazione e dello schema: `v1`, come
nei descrittori canonici; il server dichiara ancora la versione `0.8.5`.

| Tool | Tipo massimo | Limite osservabile |
| --- | --- | --- |
| `mediflow.system.headless_status.v1` | Lettura | Stato non clinico; richiede binding. |
| `mediflow.system.capabilities.v1` | Lettura | Catalogo dei binding esatti, non autorità di esecuzione. |
| `mediflow.terminology.search.v1` | Lettura | LOINC/UCUM locali; limiti di input/output negli schemi. |
| `mediflow.patient.open_loops.read.v1` | Lettura | Solo selezione Web attiva; riferimenti opachi e date, niente nomi/testi. |
| `mediflow.patient.open_loops.follow_up.propose.v1` | Proposta | Revisione richiesta; nessuna applicazione o scrittura clinica. |
| `mediflow.semantic_query_plan.execute.v1` | Lettura | Composizione delle sole due letture nominate, entro il budget richiesto. |
| `mediflow.patient.checkup.status.transition.v1` | Proposta | Preview; conferma separata nel Web trusted, mai nel client MCP. |

Nessun commit è esposto da MCP. La scrittura SOAP autorizzata ha un contratto
separato ([ADR 0103](./adr/0103-headless-clinician-authorized-soap-entry-write.md)):
non è un ottavo tool. Le 66 anchor della
[matrice semantica storica](./headless/semantic-plane.v1.json) e del
[catalogo manuale](./capability-mapping/headless-plane-inventory.v1.json)
restano `manual_only`, non concedibili e non disponibili tramite discovery.
Mini è un'altra superficie, non una configurazione MCP.

## Avvio e prova locale

Da checkout Git pulito (clone o bundle Git), con Node previsto dal contratto e
dipendenze fisiche. Gli ZIP/TAR senza metadati Git non sono un input supportato
della build di produzione:

```sh
npm run build
npm run mcp:intelligent-host:production
```

La build prepara gli asset e il registro completo del payload. Non modificare
lo standalone dopo la preparazione: Web (`npm start`) e Headless verificano
lo stesso contenuto prima dell'avvio. Vedi l'[ammissione sorgente](./runtime-payload-ledger.md#source-production-startup).

Il Supervisor possiede Web standalone e MCP come figli separati, con IPC
ereditato. Ogni backend ascolta su `127.0.0.1` con una porta libera assegnata
dal kernel. Dopo la readiness, stderr riporta
`MEDIFLOW_HEADLESS_WEB_READY {"url":"http://127.0.0.1:<porta>"}`. Aprire
quell’URL nel browser e autenticarsi e selezionare un paziente prima
dell'attivazione; la preview checkup richiede inoltre il ruolo e la selezione
specifici del Web. Non passare PIN, cookie, chiavi, ID paziente o conferme nel
client MCP. Il comando `mcp:intelligent-host` da solo non crea autorità.

La prova sintetica riproducibile è `npm run smoke:intelligent-host:production`,
dopo la build. Prepara archivi temporanei isolati, senza copia legacy, esegue
due supervisor contemporanei su porte diverse e archivi separati, con login
sugli URL annunciati e discovery/`tools/list` ripetuti dopo la readiness; esegue
poi le cinque operazioni reali e confronta discovery/catalogo con i descrittori.
Verifica scope e conferma contraffatti, input troppo grande, revisione errata,
lettura ripetuta, revoca e chiusura. I negativi condivisi di cancellazione,
frame malformati e budget vivono anche in `test:mcp:intelligent-host` e
`test:headless-portable`: non sono prove di un modello remoto.

Una sessione Web ordinaria indipendente, sullo stesso archivio sintetico,
continua lettura e scrittura dopo la chiusura della coppia agentica. Il Web privato del Supervisor termina
insieme al suo agente: non è la sessione ordinaria. I provider sono spenti e
la prova esistente ne verifica il rifiuto della sonda cloud.

## Dove arriva la sentinella

La prescrizione sintetica contiene `SYNTHETIC_C16_PRIVATE_SERVICE_NOT_FOR_AGENT`.
Il client Web ne verifica la presenza nel record selezionato. Il servizio
produce un'attesa con riferimento opaco; il client MCP riceve quel riferimento,
la data e la proposta corrispondente. Lo smoke verifica che il testo privato
non compaia nei frame stdio conservati nella memoria del client né in stderr.
Questo prova la proiezione e la consegna locale, non l'anonimato del payload:
anche riferimenti, tempi e stato sono informazioni del paziente.

Dopo la consegna, il client può conservare o inoltrare il risultato. MCP non
impone una politica di retention, né limita shell, file o altri server del suo
host. La [guida ufficiale MCP sui server locali](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/tutorials/security/local-server-security.mdx)
spiega il contesto condiviso e i permessi dei processi locali. Questo client
non scrive i payload in un registro persistente e non chiama modelli; contesto
modellistico, forwarding e retention di un host esterno restano **non noti**.
Codex, ChatGPT e altri host non sono client compatibili provati da questo run.
Per un eventuale host OpenAI, verificare la configurazione effettiva e le
[regole dati del prodotto](https://help.openai.com/en/articles/5722486-how-your-data-is-used-to-impr)
e, se usa l'API, i [controlli di retention dell'API](https://developers.openai.com/api/docs/guides/your-data):
non addestramento e assenza di conservazione non sono la stessa garanzia.
