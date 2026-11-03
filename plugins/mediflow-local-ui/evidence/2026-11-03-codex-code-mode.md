# Codex 0.166: scoperta e invocazione del tool locale

Prova del 3 novembre 2026 su Codex CLI `0.166.0-alpha.5.1`, Node 24.18.0.
Ambito: telecomando locale ADR 0159, WUL-756 e WUL-757. Nessuna estensione
alle capacità cliniche o inline previste dall'ADR 0160.

## Risultato della diagnosi

Il plugin installato e abilitato compare in `codex mcp list` e fra le skill.
Un messaggio generico di collaudo che non nomina MediFlow non ne espone i tool;
il prompt originale del pacchetto che nomina MediFlow e il richiamo esplicito
`$mediflow-local-ui:local-ui` funzionano entrambi. La prova non dimostra un
difetto del caricamento e non richiede di cambiare il prompt iniziale.

Il server pubblica `mediflow.local_ui.navigate.v1`. Codex lo accetta e nel
code mode lo espone come
`mcp__mediflow_local_ui__mediflow_local_ui_navigate_v1`, disponibile in
`ALL_TOOLS` e invocabile tramite `tools[nome]` dentro `functions.exec`.
Usare invece il nome MCP originale come proprietà JavaScript produce
`TypeError: ... is not a function`. Il test locale riproduce questo errore;
la scoperta del nome esposto raggiunge lo stesso server e riceve
`continue_in_mediflow`.

Il catalogo reale contiene un oggetto di input con il solo campo obbligatorio
`intent`, enum stringa, e `additionalProperties: false`. L'output è un oggetto
con il solo stato costante `continue_in_mediflow`. Sono presenti i suggerimenti
`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` e
`openWorldHint: false`. Codex converte questi schemi nella dichiarazione
JavaScript ed esegue la chiamata. Non è emerso uno schema rifiutato né un
marcatore di differimento nel catalogo emesso da MediFlow.

Il differimento riguarda la scoperta dei tool nel client e non equivale a
indisponibilità del server. La skill ora spiega la scoperta in `ALL_TOOLS` e
contiene una ricetta eseguibile. Il nome MCP e il server rimangono invariati,
anche per Claude Code. Il pacchetto passa a 0.1.1.

## Prova ripetibile senza inferenza

```sh
MEDIFLOW_DATA_DIR=<directory-sintetica-assoluta> \
MEDIFLOW_CODEX_BIN=<percorso-assoluto-di-codex> \
MEDIFLOW_CODEX_EVIDENCE_DIR=<directory-evidenze-privata> \
node --test scripts/package-local-ui-plugin.test.mjs
```

I due test facoltativi richiedono il binario indicato esplicitamente. Avviano Codex
con `CODEX_HOME` temporaneo, server MCP reale e composizione parent sintetica.
Un endpoint Responses esclusivamente su loopback restituisce una chiamata
predefinita a `functions.exec`: il codice è estratto dalla skill distribuita.
Il secondo installa il plugin in un marketplace locale temporaneo, mantenendo
manifest, skill e prompt del pacchetto e collegando il launcher al server MCP
con parent sintetico. Esegue proprio il prompt iniziale del plugin.
Entrambi richiedono una ricevuta positiva dal tool, senza errori, ed esercitano
quindi catalogo, conversione degli schemi, normalizzazione del nome,
code mode, trasporto MCP e risposta. Nessun modello genera codice, nessun
account viene usato e nessun token viene copiato. Le evidenze facoltative
contengono richieste di protocollo e log Codex e restano fuori da Git.

La suite ordinaria continua a verificare manifest Codex/Claude, avvio,
identità del runtime e rifiuto dei pacchetti alterati. Senza il binario il solo
percorso Codex viene saltato esplicitamente.

Questa prova dimostra l'invocabilità attraverso Codex, non la capacità di un
modello remoto di scegliere il tool né una sessione autenticata Claude Code.
La precedente prova con quattro risposte del modello non conserva qui il
codice delle chiamate fallite: il meccanismo del `TypeError` è riprodotto,
ma non si attribuisce una specifica espressione JavaScript a ciascun tentativo.
