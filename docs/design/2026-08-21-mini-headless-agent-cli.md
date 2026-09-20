---
summary: "Mini: CLI AIP e sessione Supervisor 0.8.6 con gli stessi comandi governati; authority Web, lease e revoca restano host-owned."
read_when:
  - "Usando o modificando Mini e il suo launcher Supervisor."
---

# Mini — la superficie CLI di MediFlow

## Contratto corrente

La proposta del 21 agosto è sostituita, per il runtime descritto qui, da
[ADR 0117](../adr/0117-headless-portable-agent-first-and-capability-first-fabric.md)
e dai confini di isolamento di
[ADR 0114](../adr/0114-intelligent-host-aip-mcp-isolation.md).
I manifest dei vecchi rami WUL-553/554/555 e i comandi proposti `grant`, `login`,
`whoami`, `patient show` e `apply` non descrivono il runtime attuale.
WUL-557 e i crosswalk referenziali restano evidenza del loro perimetro storico:
i loro conteggi non misurano le operazioni della sessione production.

La lane WUL-696 aggiunge un callsite production esplicito: il Supervisor
Node 24 avvia Web standalone e Mini come figli distinti, con IPC privato
ereditato. Il comando MCP predefinito continua ad avviare Web e MCP.
Ogni avvio possiede la propria coppia; non adotta Web già in esecuzione.
Il primo incremento `703e3d49f` provava soltanto la composizione stato/catalogo.
Il secondo collega alla sessione tutti i comandi esistenti della CLI: non
abbassa il DoD di ADR0117 a status-only e non amplia le capability host.

## Avvio e autorizzazione

Prerequisiti: dipendenze Node 24 e artifact Web standalone già costruito dal
checkout pertinente. Per la sessione Mini:

```sh
npm run mini:production
```

Equivale al launcher `scripts/mediflow-headless-supervisor.mjs --mini`.
Il processo rimane aperto e riceve una richiesta JSON per riga, per esempio:

```json
{"command":"status","args":{}}
{"command":"capabilities","args":{}}
```

Prima dell'attivazione, status mostra `transport: connected`,
`session: not_unlocked`, `ready: false`, capacità vuote e il passo
`AUTHORIZE_IN_OWNED_WEB`. Catalogo e operazioni sono negati con
`SESSION_NOT_UNLOCKED`.
L'operatore deve aprire il Web figlio su localhost:3000, autenticarsi, selezionare
il contesto e usare il controllo Intelligent Host. Un login da solo non attiva
AIP. Mini non accetta cookie, PIN, identità o selezione come argomenti.

Dopo l'ACK Web e il bootstrap AIP monouso, ogni richiesta interroga il catalogo
host; il launcher rilegge il mirror autoritativo anche per le richieste di
metadati. Status mostra `session: authorized` e `ready: true` soltanto con un
catalogo corrente non vuoto. `capabilities` restituisce il catalogo host e gli
stadi massimi: non è un grant di esecuzione. Le operazioni passano dagli stessi
metodi OperationClient, Application Services e gate già usati dalla CLI.

| Comando | Argomenti | Esito massimo |
| --- | --- | --- |
| `status` | `{}` | Connessione, sessione, catalogo e readiness osservati |
| `capabilities` | `{}` | Catalogo host corrente |
| `terminology search` | `system`, `query`, `limit` | Lettura del catalogo locale LOINC/UCUM |
| `open-loops` | `{}` | Lettura del contesto selezionato dall'host |
| `follow-up-proposal` | `{}` | Proposta review-first, `proposal_only`, nessun apply |
| `semantic-query` | `budget`, `explanation`, `steps` | Piano read-only di massimo due operazioni allowlisted |

Esempio innocuo dopo l'attivazione Web:

```json
{"command":"terminology search","args":{"system":"LOINC","query":"emoglobina","limit":2}}
```

Scope, patient ID, authority, provider e SQL non sono opzioni dei comandi.
Gli schemi strict rimangono quelli in `packages/mcp/src/contracts.ts`.

La connessione IPC da sola non prova l'autorizzazione. Senza parent valido,
Mini restituisce `TRANSPORT_UNBOUND`, `ok: false`, `ready: false` ed exit 69.
Un errore operativo restituisce un errore tipizzato, senza riusare il catalogo.

## Output e limiti

La sessione usa envelope `mediflow.mini.session.v1`: una risposta NDJSON per
richiesta. `ok` indica l'esito della richiesta; per status occorre leggere anche
`session` e `ready`. Nessun banner è scritto su stdout. La diagnostica Web e
Supervisor va su stderr. CLI e sessione condividono parsing, dispatch e
serializer in `packages/mini/src/protocol.ts`: i DTO operativi restano identici
e il serializer non invoca `toJSON` ereditati su oggetti o array.

Limiti: 16 KiB per frame UTF-8, schemi di comando chiusi, massimo 64
richieste sequenziali per processo. Ogni riga deve terminare con newline.
Input invalido o budget esaurito termina con exit 2. Un errore operativo termina
con exit 70 e scarta i comandi ancora in coda; perdita IPC o errore stream con exit 69. EOF ordinato termina con
exit 0 dopo le risposte; chiude Mini e la coppia posseduta dal Supervisor.
La terminazione imposta dal parent può essere osservata come segnale OS.

Lock, logout, reselection, expiry e perdita di Web o Mini revocano e chiudono
il runtime. Non c'è rebind: serve un nuovo avvio e una nuova attivazione Web.
Nessun broker residente, socket, listener Mini, accesso SQLite diretto,
credenziale persistita o potere apply clinico viene aggiunto.

## CLI a richiesta singola

`npm run mini` conserva l'envelope `mediflow.mini.transport.v1` e una sola
richiesta su stdin fino a EOF. Gli adapter esistenti comprendono status,
capabilities, terminology search, open-loops, follow-up-proposal e semantic-query;
richiedono comunque il parent AIP. La sessione riusa gli stessi adapter senza
nuove autorizzazioni. Lo status storico della CLI singola non è lo status di
readiness della sessione Supervisor.

## Punto d'innesto e prove

Il coordinatore può collegare onboarding/UI al controller Web esistente
`activateCurrentSelection` in
`lib/security/portable-supervisor-web-session-controller.ts`, preservando
H1a, capture owner, selezione e ACK. Nessuna UI o wizard è modificata qui.

`lib/security/portable-supervisor-mini-production.test.ts` compone il root
production con Mini reale e una fixture Web benigna: usa projection autentiche
del lifecycle owner, owner di selezione/capture, controller e bridge IPC reali.
Il gesto browser e l'acquisizione H1a sono sorgenti di test; non prova il login
HTTP o il server Next standalone costruito. Copre stato prima/dopo il binding,
catalogo, lock, reselection, EOF e perdita Web. Dopo il binding esegue una
ricerca terminologica tramite Application Service production, con receipt e
audit persistito su database sintetico. Tutti i comandi sono negati prima del
binding e dopo la revoca per drift della versione sintetica.

La parità dei DTO e l'arresto della coda dopo denial per tutte le operazioni
sono verificati anche via IPC con fixture di servizi in `cli.test.ts`.
`protocol.test.ts` verifica la serializzazione isolata. La sola ricerca
terminologica production non prova l'intero DoD clinico: letture Open Loops,
proposte e planner su fonti cliniche production richiedono prove end-to-end
separate per l'integrazione finale, senza ridurre quel gate.
Le regressioni Mini/MCP/Headless sono gate separati. Smoke tri-OS, onboarding,
integrazione nel candidato finale e release non sono attestati da queste prove.
