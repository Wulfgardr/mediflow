---
summary: "Mini: CLI AIP e sessione Supervisor 0.8.6 per stato e catalogo governati; authority Web, lease e revoca restano host-owned."
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
`AUTHORIZE_IN_OWNED_WEB`. Il catalogo è negato con `SESSION_NOT_UNLOCKED`.
L'operatore deve aprire il Web figlio su localhost:3000, autenticarsi, selezionare
il contesto e usare il controllo Intelligent Host. Un login da solo non attiva
AIP. Mini non accetta cookie, PIN, identità o selezione come argomenti.

Dopo l'ACK Web e il bootstrap AIP monouso, ogni richiesta interroga il catalogo
host; il launcher rilegge il mirror autoritativo anche per le richieste di
metadati. Status mostra `session: authorized` e `ready: true` soltanto con un
catalogo corrente non vuoto. `capabilities` restituisce il catalogo host e gli
stadi massimi: non è un grant di esecuzione né abilita altri comandi in questa
sessione. Il protocollo sessione ammette solo `status` e `capabilities`.

La connessione IPC da sola non prova l'autorizzazione. Senza parent valido,
Mini restituisce `TRANSPORT_UNBOUND`, `ok: false`, `ready: false` ed exit 69.
Un errore operativo restituisce un errore tipizzato, senza riusare il catalogo.

## Output e limiti

La sessione usa envelope `mediflow.mini.session.v1`: una risposta NDJSON per
richiesta. `ok` indica l'esito della richiesta; per status occorre leggere anche
`session` e `ready`. Nessun banner è scritto su stdout. La diagnostica Web e
Supervisor va su stderr.

Limiti: 16 KiB per frame UTF-8, argomenti vuoti e schema chiuso, massimo 64
richieste sequenziali per processo. Ogni riga deve terminare con newline.
Input invalido o budget esaurito termina con exit 2. Un errore operativo termina
con exit 70; perdita IPC o errore stream con exit 69. EOF ordinato termina con
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
richiedono comunque il parent AIP. La nuova sessione production non promuove
questi adapter clinici. Lo status storico della CLI singola non è lo status di
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
catalogo, lock, reselection, EOF, perdita Web e drift della versione sintetica.
Le regressioni Mini/MCP/Headless sono gate separati. Smoke tri-OS, onboarding,
integrazione nel candidato finale e release non sono attestati da queste prove.
