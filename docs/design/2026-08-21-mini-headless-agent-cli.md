---
summary: "Mini: CLI AIP e sessione Supervisor 0.8.6 con gli stessi comandi governati; authority Web, lease e revoca restano host-owned."
read_when:
  - "Usando o modificando Mini e il suo launcher Supervisor."
---

# Mini — la superficie CLI di MediFlow

## Contratto corrente

Per comprendere il runtime descritto qui occorre partire da
[ADR 0117](../adr/0117-headless-portable-agent-first-and-capability-first-fabric.md)
e dai confini di isolamento di
[ADR 0114](../adr/0114-intelligent-host-aip-mcp-isolation.md), che sostituiscono
la proposta del 21 agosto. I manifest dei vecchi rami WUL-553/554/555 e i
comandi allora proposti — `grant`, `login`, `whoami`, `patient show` e `apply` —
non descrivono il runtime attuale. WUL-557 e i confronti referenziali
conservano il proprio valore storico: i loro conteggi non misurano le
operazioni della sessione production.

WUL-696 aggiunge un punto esplicito di avvio production: il Supervisor
Node 24 avvia Web standalone e Mini come figli distinti, collegati da IPC
privato ereditato. Il comando MCP predefinito continua invece ad avviare Web
e MCP. Ogni avvio possiede la propria coppia e non adotta un Web già aperto.
Il primo incremento `703e3d49f` provava soltanto la composizione stato/catalogo;
il secondo collega alla sessione tutti i comandi esistenti della CLI,
senza ridurre il DoD di ADR0117 al solo stato né ampliare le capability host.

## Avvio e autorizzazione

La sessione Mini richiede le dipendenze Node 24 e l'artefatto Web standalone
già costruito dalla checkout pertinente. Per avviarla:

```sh
npm run mini:production
```

Il comando equivale al launcher `scripts/mediflow-headless-supervisor.mjs --mini`.
Il processo rimane aperto per ricevere una richiesta JSON per riga, per esempio:

```json
{"command":"status","args":{}}
{"command":"capabilities","args":{}}
```

Prima dell'attivazione, status distingue connessione e autorizzazione:
mostra `transport: connected`, `session: not_unlocked`, `ready: false`,
capacità vuote e il passo `AUTHORIZE_IN_OWNED_WEB`. Catalogo e operazioni
sono negati con `SESSION_NOT_UNLOCKED`. L'operatore deve aprire su
localhost:3000 il Web figlio, autenticarsi, selezionare il contesto e usare
il controllo Intelligent Host: il solo login non attiva AIP. Cookie, PIN,
identità e selezione non sono accettati da Mini come argomenti.

Dopo l'ACK Web e il bootstrap AIP monouso, ogni richiesta consulta il
catalogo host; il launcher rilegge il mirror autorevole anche quando vengono
chiesti soltanto metadati. Status può mostrare `session: authorized` e
`ready: true` solo con un catalogo corrente non vuoto. `capabilities`
restituisce quel catalogo e gli stadi massimi, senza concedere l'esecuzione.
Le operazioni attraversano gli stessi metodi OperationClient, Application
Services e controlli di accesso già usati dalla CLI.

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

I comandi non permettono di scegliere scope, patient ID, authority, provider
o SQL. Gli schemi restano chiusi e definiti in `packages/mcp/src/contracts.ts`.

Essere collegati via IPC non basta a essere autorizzati. Se manca un parent
valido, Mini restituisce `TRANSPORT_UNBOUND`, `ok: false`, `ready: false`
ed exit 69; un errore operativo produce invece un errore tipizzato, senza
riusare il catalogo.

## Output e limiti

La sessione risponde a ogni richiesta con una riga NDJSON nell'envelope
`mediflow.mini.session.v1`. Il campo `ok` descrive l'esito della richiesta;
per status occorre leggere anche `session` e `ready`. Stdout non contiene
banner, mentre la diagnostica di Web e Supervisor va su stderr. CLI e
sessione condividono parsing, dispatch e serializer in
`packages/mini/src/protocol.ts`, mantenendo identici i DTO operativi;
il serializer non invoca `toJSON` ereditati da oggetti o array.

Ogni frame UTF-8 ha un limite di 16 KiB e segue uno schema di comando chiuso;
un processo ammette al massimo 64 richieste sequenziali, ciascuna terminata
da newline. Input invalido o budget esaurito portano a exit 2. Un errore
operativo porta a exit 70 e scarta i comandi in coda; perdita IPC o errore
dello stream portano a exit 69. Con EOF ordinato, le risposte precedono
exit 0, che chiude Mini e la coppia posseduta dal Supervisor. Una terminazione
imposta dal parent può apparire come segnale OS.

Lock, logout, nuova selezione, scadenza e perdita di Web o Mini revocano
e chiudono il runtime. Non è previsto rebind: per riprendere servono un nuovo
avvio e una nuova attivazione Web. Il percorso non aggiunge broker residente,
socket, listener Mini, accesso diretto a SQLite, credenziali persistenti
o autorità per applicare modifiche cliniche.

## CLI a richiesta singola

`npm run mini` conserva l'envelope `mediflow.mini.transport.v1` e legge
una sola richiesta da stdin fino a EOF. Gli adapter esistenti — status,
capabilities, terminology search, open-loops, follow-up-proposal e
semantic-query — richiedono comunque il parent AIP. La sessione li riusa
senza nuove autorizzazioni, ma il significato storico dello status della
CLI singola non coincide con la disponibilità operativa della sessione
Supervisor.

## Punto d'innesto e prove

Il coordinatore può collegare configurazione iniziale e UI al controller Web
esistente `activateCurrentSelection` in
`lib/security/portable-supervisor-web-session-controller.ts`, purché conservi
H1a, capture owner, selezione e ACK. Questo intervento non modifica UI
né wizard.

`lib/security/portable-supervisor-mini-production.test.ts` compone il root
production con Mini reale e una fixture Web benigna. Usa proiezioni autentiche
del lifecycle owner, owner di selezione/capture, controller e bridge IPC reali,
mentre gesto browser e acquisizione H1a provengono dal test: non prova quindi
il login HTTP né il server Next standalone costruito. Copre stato prima e
dopo il binding, catalogo, lock, nuova selezione, EOF e perdita Web. Dopo il
binding esegue una ricerca terminologica attraverso l'Application Service
production, con ricevuta e audit persistito su database sintetico. Tutti i
comandi sono negati prima del binding e dopo la revoca dovuta al cambiamento
della versione sintetica.

La parità dei DTO e l'arresto della coda dopo un diniego sono verificati
per tutte le operazioni anche via IPC, con fixture di servizi in `cli.test.ts`;
`protocol.test.ts` verifica separatamente la serializzazione. La ricerca
terminologica production non esaurisce il DoD clinico: letture Open Loops,
proposte e planner su fonti cliniche production richiedono prove end-to-end
separate per l'integrazione finale, senza ridurre il criterio di accettazione.
Le regressioni Mini/MCP/Headless restano controlli separati e queste prove
non attestano smoke tri-OS, onboarding, integrazione nel candidato finale
o release.