# Storia con fonte e prove del plugin

Refs WUL-757. Contratto 0.9.1, P-2 e P-3; ADR 0159 e 0171.

La timeline mostra il contenuto sintetizzato della voce e la fonte registrata,
con la stessa lettura del diario. Il titolo apre il diario per leggere il testo
completo. Una fonte non leggibile resta non disponibile. La ricevuta MCP rimane
`continue_in_mediflow`: contenuto e fonte restano nella UI locale.

## Prove automatiche

Solo dati sintetici, Node 24.18.0 e Chromium. Nessun host CLI o plugin globale.
Il runtime isolato sceglie una porta loopback propria e rifiuta la porta 3000.

Dopo `npm ci` e `npm run build` su sorgente committata e pulita:

```sh
E2E_BASE_URL=http://127.0.0.1:3197 npx playwright test e2e/plugin-local-ui-history.spec.ts e2e/plugin-local-ui-pairing.spec.ts --workers=1 --retries=0
MEDIFLOW_LIFECYCLE_REAL=1 MEDIFLOW_PRESERVATION_REAL=1 node --test --test-concurrency=1 --test-name-pattern='simultaneous plugin leases|real browser and plugin launcher' scripts/local-ui-lifecycle.test.mjs scripts/local-ui-work-preservation.test.mjs
```

La build segue l'esclusione sparse della fixture nativa prevista dalla CI.
I dati vengono creati in directory temporanee vuote; la copia legacy è disabilitata.
Web Core esegue i due harness reali dopo la build; E2E esegue gli spec isolati.

| Criterio | Prova ripetibile | Confine |
| --- | --- | --- |
| P-2 storia con fonte | Intento IPC, consenso UI, data, titolo, contenuto, fonte e accesso al diario | Web standalone reale, abbinamento locale; nessuna qualifica dei manifest CLI |
| P-3 cambio paziente | Cambio cartella e selezione cambiata da altro consumatore sulla stessa sessione | Conferma vecchia rimossa o negata prima della navigazione |
| P-3 lock e revoca | Richiesta pendente ritirata, successive richieste negate | Sessione Web e autorità di abbinamento reali |
| P-3 scadenza e timeout | IPC già scaduto, conferma oltre 15 secondi, risposta epoch ritardata | Nessuna navigazione tardiva; una richiesta nuova funziona |
| P-3 duplicato | MCP stdio reale, RPC originale reiniettata nel parent prima e dopo conferma UI | Una sola consegna al Web, conflitto esplicito, nessuna conferma riaperta |
| P-3 annullamento | Cancellazione IPC della richiesta corrente | Conferma ritirata senza registrare una seconda voce |
| P-3 lease simultanei | Tre client plugin attivi, entrambi gli ordini di disconnessione | Web vivo fino all'ultimo lease, poi arrestato; launcher reali senza host CLI |
| P-3 bozza e lease UI | UI aperta per 17 secondi dopo uscita host, chiusura, riavvio, recupero cifrato, scadenza senza saluto | Browser e launcher reali, nessuna voce clinica registrata |

`lib/security/plugin-local-ui-boundary.test.ts` copre inoltre il timeout reale
MCP, cancellazione e limiti delle richieste in volo. Il driver E2E della prova
duplicati usa lo stesso MCP e supervisor: simula il trasporto verso il launcher,
mentre abbinamento, IPC Web, SSE e UI sono reali. Non prova la retention di un provider.
Lo scarto esplicito e il fallimento dello storage restano coperti da
`e2e/entry-draft-discard.spec.ts`.

## Stato P-2 e P-3

P-2: corretto il difetto di presentazione della storia osservato nel collaudo.
P-3: aggiunte prove sui negativi e sui lease concorrenti; gli harness esistenti
provano recupero e conservazione della bozza. Nessuna modifica al prodotto per
lease, lock, bozze o autorizzazioni. Nessuna nuova API o autorità clinica.

Restano alla qualifica con Leonardo, separatamente per Codex CLI e Claude Code:

1. Versione esatta del client, pacchetto, manifest, build e caricamento nativo
   del plugin; l'override del solo MCP non prova il caricamento del plugin Codex.
2. Percorso completo dal tool: avvio, selettore, abbinamento, login, ricerca per
   CF sintetico, selezione, anagrafica, storia con fonte e guida prescrittiva.
   Acquisire anche la prima ricerca durante avvio e abbinamento e il suo esito.
3. Cambio paziente, lock, revoca, duplicato, richiesta vecchia o scaduta, timeout
   e annullamento attraverso ciascun host reale, inclusa la ripresa della sessione.
4. Due host contemporanei, entrambi gli ordini di uscita e disconnessione;
   distinguere i lease degli host da quello UI, misurare la scadenza dopo
   chiusura di tutte le schede, riavviare e verificare bozza recuperata e scarto.
5. Stream completi, stderr separati, wire MCP e cronologie/debug accessibili
   per ogni host, con sentinelle sintetiche di identità, diagnosi e testo.
   Dichiarare i canali inaccessibili e i limiti della retention dei provider.
6. Copie iniziali delle configurazioni, differenze finali riconciliate senza
   sovrascrivere modifiche concorrenti, processi iniziali/finali e loro proprietà.

P-2 e P-3 restano parziali fino a tale qualifica. Il plugin Codex globale
rimane disattivato. Nessun dato reale o database primario è necessario.
