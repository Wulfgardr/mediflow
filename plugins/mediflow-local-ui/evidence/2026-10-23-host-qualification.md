# Qualifica host del telecomando locale MediFlow

Data: 23 ottobre 2026. Ambito: WUL-756 e percorso U1 di WUL-757.
Base `64e190438da8287928f0903b9b719c18b329a7ec`; candidato eseguibile
`36d7f8f86b101dcd414444d038f877d1919380a8`, Node 24.21.0.
Le evidenze grezze e le catture sintetiche restano nel dossier privato del collaudo.

## Canali e decisione

Il canale U1 è un tool MCP stdio locale che riceve soltanto uno dei quattro
intenti e restituisce una ricevuta tecnica fissa. Login, CF, selezione, anagrafica,
storia con fonti e guida prescrittiva sono nella UI fidata separata di MediFlow.
Il modello non riceve tali dati; non ragiona sulla storia del paziente.

R indica rendering inline nell'host; L indica lettura diretta da loopback dalla
vista inline. Nessuno dei due è provato dalla riuscita del telecomando.
La qualifica clinica inline e i suoi criteri di divulgazione restano in WUL-788,
secondo ADR 0160. Questa matrice consolida il percorso local-ui di WUL-756;
non dichiara soddisfatta la parte inline trasferita.

| Host | Canale U1 | Prova corrente | R / L | Limiti |
| --- | --- | --- | --- | --- |
| Codex locale CLI 0.163.0-alpha.11.1 | Plugin di sviluppo, MCP stdio | PASS: agente reale e percorso UI completo | Non provati da U1 | Thread locale, dipendenze/build locali ammesse; nessun supporto cloud dedotto. |
| Codex nell'app ChatGPT desktop 26.1016.61520 (21421) | Plugin locale e MCP stdio | Non provato: Computer Use indisponibile | Separati, ADR 0160 | Versione letta dal bundle. `cgWindowNotFound` persiste dopo un solo reset; nessuna conversazione o chiamata desktop eseguita. |
| Claude Code CLI 2.1.308 | Plugin di sviluppo `--plugin-dir`, MCP stdio | PASS: agente reale e percorso UI completo | Non provati da U1 | A freddo il primo turno può precedere la connessione MCP. Attendere la connessione e fare una nuova richiesta esplicita. |
| Claude Desktop 3.1623.4 | Collegamento locale disponibile da qualificare | Non provato: Computer Use indisponibile | Separati, ADR 0160 | Non dedurre dal supporto dei plugin una capacità uniforme delle chat e delle sessioni Code. |
| ChatGPT/Codex web o cloud | Nessun canale U1 qualificato | Escluso da questa consegna | Non provati | Nessun tunnel, endpoint remoto o adozione di listener arbitrari. |

Per U1 non è composto alcun pannello, sidebar o schermo intero nell'host.
Il collegamento diretto è la sola apertura della pagina locale fissa, senza CF,
patientId o token nella richiesta del modello. Supporto e funzionamento di altre
superfici rimangono ignoti dove non provati; non sono requisiti impliciti del
telecomando. Il lifecycle osservato nelle CLI è indipendente dall'host, con
riuso della stessa istanza ordinaria e arresto del solo raccordo MCP.

Decisioni per percorso: procedere con il collaudo privato sintetico local-ui;
uso clinico privato in attesa dell'ammissione dedicata; distribuzione pubblica
in attesa della decisione di Leonardo e dei gate di WUL-759. Per l'esperienza
inline procedere nel filone distinto WUL-788, mantenendo gli esiti R/L separati.

Gli esiti storici R/L del demo sintetico sono riportati in ADR 0160 con le loro
versioni e limitazioni. Non vengono aggiornati o estesi con questo collaudo.
Uso clinico reale e pubblicazione nelle directory rimangono WUL-738 e WUL-759;
non è stato effettuato alcun contatto o invio a una directory.

La riserva del Mac è stata confermata. Il primo accesso Computer Use a Codex ha
restituito `Computer Use server error -10005: cgWindowNotFound`; lo stesso errore
è rimasto dopo l'unico reset autorizzato. Per istruzione del collaudo le prove
desktop si sono fermate, senza ulteriori tentativi su Claude e senza modifiche
alle configurazioni desktop. Nessun esito desktop viene dedotto dalle CLI.

## Percorso osservato nelle CLI

Pacchetti sottili installati su fixture isolate. Codex usa un home e un marketplace
locali del collaudo; Claude Code usa il pacchetto di sviluppo immutabile, le sole
permissioni del tool ammesso e connettori di account disabilitati per la sessione.
Account della prova: Codex autenticato tramite ChatGPT, piano restituito
`prolite`; Claude tramite `claude.ai`, provider first-party, abbonamento Pro.
Gli identificativi degli account rimangono privati. Non sono stati modificati
i file di impostazioni personali dei due client. Claude ha aggiornato il proprio
contatore di uso del plugin, ripristinato limitatamente alla chiave del collaudo;
gli aggiornamenti di cache del client sono stati conservati.

Per entrambi, chiamata effettiva dell'agente prima del binding, login nella UI,
ricerca per CF inventato, selezione, conferma locale per anagrafica, storia con
fonte della visita inventata e guida con i tre percorsi farmaco/prestazione/protesica.
Codex ha eseguito sei chiamate e Claude cinque sul candidato, compresi i negativi
di contesto. Le prove UI usano Chromium headless sulla medesima istanza ordinaria;
non sono una prova delle app desktop. Nessuna prescrizione è stata prodotta.

Il cambio paziente ha ritirato la richiesta Codex; lock e nuovo sblocco hanno
ritirato la richiesta Claude. La richiesta Codex lasciata in attesa è scaduta
senza navigazione. I test di epoch, revoca e cancellazione coprono inoltre il
confine applicativo già esistente.

## Lifecycle: difetto, correzione e falsificazione

La baseline arrestava il Web alla chiusura dell'host; il controllo di sicurezza
successivo smontava l'editor e perdeva la bozza non registrata. Il test UI ha
riprodotto il difetto su entrambi i client; i record salvati restavano integri.

Decisione di coordinamento: il plugin è un telecomando e il runtime è autonomo.
Il plugin riusa il launcher ordinario della stessa sorgente e dello stesso
archivio, oppure lo avvia staccato con build ammessa e decisione `reuse`.
Non installa, costruisce o scarica nulla in modo implicito. Possiede soltanto
il raccordo MCP. Non cambia autorità clinica, sessioni o single-writer.

Sul candidato, entrambe le CLI si sono collegate alla stessa istanza ordinaria.
La chiusura di entrambi gli host ha lasciato runtime e bozza aperti; hash dei
record salvati e audit erano invariati. La bozza è stata poi registrata
esplicitamente dalla UI ordinaria senza AI, attraverso il writer e l'audit correnti.

Il test di ownership è rosso con la vecchia composizione (due figli anziché uno)
e verde con la correzione. La falsificazione in memoria che ripristina quella
composizione torna rossa. Anche il comando finito del launcher è stato prima
provato rosso (404), poi verde; input extra, intenti estranei e origini estranee
restano negati.

Una prova del pacchetto reale ha fermato temporaneamente soltanto il launcher
del collaudo: timeout di circa otto secondi con errore fisso e nessuna ripetizione
al ripristino. Sono stati negati sei nomi di tool nascosti, quattro input invalidi
e RPC forgiato. Risorse e prompt sono assenti. Chiudere il raccordo lascia vivo
il runtime ordinario. Runtime assente e duplicati restano coperti anche dai test
mirati; l'avvio da freddo di Codex ha acceso il launcher ordinario.

Il recupero cifrato delle bozze dopo riavvio è una proposta separata: U1 preserva
il lavoro alla chiusura dell'host, senza introdurre un deposito delle bozze.

## Confine osservato

Sul candidato: zero corrispondenze delle sentinelle sintetiche nei nove file
osservati (eventi, stderr, inventario, debug e cronologia accessibile delle due
sessioni). Codex espone content, structuredContent e `_meta`; le risposte riuscite
sono sempre la ricevuta fissa. Claude proietta il risultato del tool come testo:
i blocchi MCP completi sono verificati separatamente sul wire del pacchetto reale,
insieme a errori, URL, risorse/prompt e diagnostica. Gli input invalidi non sono
ristampati. Le URL della UI locale contengono legittimamente gli identificativi
sintetici e restano fuori dai canali del telecomando.

Non osservabili: conservazione interna del provider e stato interno non esposto
agli strumenti dei client. Non si promette isolamento del Mac dagli altri tool,
da file, browser o screenshot autorizzati in altri contesti.

## Verifiche e accettazione residua

Node 24.21.0. Il comando integrale `npm run test:unit` sul candidato ha concluso
il primo gruppo con 7.768 test: 7.750 PASS, 4 FAIL, 14 skip. Il runner si ferma
sul primo gruppo rosso: i due gruppi seriali successivi sono stati quindi eseguiti
separatamente, entrambi verdi (61 e 66 test), senza alterare il runner.

Errori già riprodotti sulla base `main` iniziale, con dipendenze fisiche e umask
ordinaria: i tre test `execution-mac.test.ts` alle righe 23, 33 e 50 richiedono
`MEDIFLOW_MAC_PUBLIC_SOURCE_DIR`, `MEDIFLOW_MAC_C1_RECEIPT` e
`MEDIFLOW_MAC_NATIVE_SOURCE`, non configurati in questo ambiente.

Il quarto errore finale è `portable-supervisor-mini-production.test.ts`,
`currentness:semantic-query`: sessione negata nella suite completa. Lo stesso
test passa isolato sia sulla base sia sul candidato; resta un errore osservato,
senza attribuzione causale al diff e senza dichiararlo corretto.

Nella precedente esecuzione sul primo fix erano comparsi anche due errori P3
`session_unavailable` e un errore FHIR `kill EPERM` anziché terminazione SIGTERM.
Non si sono riprodotti nel confronto mirato sulla base né nell'ultima suite.
Le prime baseline con umask restrittiva e dipendenze tramite alias non sono
comparabili: i loro errori di fixture e percorso restano nel dossier, esclusi
come prova di regressioni del prodotto.

Verdi: `test:inventory-browser`, lint, typecheck, never-regress, claims,
database-import-boundary, headless-portable-imports, test-selection,
schema-writers, ai-clinical-writes, api-error-leak, schema-drift,
audit-quality-gate e standalone-runtime-bundle. Build del candidato riuscita.

| Criterio WUL-757 | Stato | Evidenza / residuo |
| --- | --- | --- |
| 1. Contratto e pacchetti | PASS | ADR 0159 rettificato; pacchetti sottili, identità e build locali ammesse. |
| 2. Negazione reale | PASS | MCP reale, nomi nascosti/RPC/input avversari negati; nessun servizio clinico composto. |
| 3. Percorso sintetico | PASS | Entrambe le CLI e UI separata; fonti, conferma, contesto, lock e scadenza osservati. |
| 4. Confine osservato | PASS | Canali accessibili delle CLI e wire del pacchetto; limiti dichiarati. |
| 5. Client reali | Non provato | CLI PASS; app desktop non provate per `cgWindowNotFound` persistente. |
| 6. Lifecycle e autonomia | PASS | Prove CLI sul runtime ordinario, bozza preservata dopo chiusura di entrambi gli host, uso senza AI. Non esteso alle app desktop. |
| 7. Accettazione | FAIL | Suite unit rossa; review indipendente e CI pendenti. Merge, identità dopo merge e consegna installata non eseguiti. |

La qualifica è ancorata alla revisione eseguibile indicata all'inizio; il commit
successivo aggiunge soltanto questa evidenza e il collegamento nel README.
La PR non chiude WUL-757 e non autorizza merge, ammissione clinica o pubblicazione.

## Fonti ufficiali

Consultate il 23 ottobre 2026: [pacchetti OpenAI](https://developers.openai.com/plugins/build/plugins),
[plugin locali desktop](https://developers.openai.com/plugins/deploy/desktop-only),
[manifest Claude Code](https://code.claude.com/docs/en/plugins-reference),
[MCP Claude Code](https://code.claude.com/docs/en/mcp),
[variabili Claude Code](https://code.claude.com/docs/en/env-vars),
[plugin in Claude](https://support.claude.com/en/articles/13837440-use-plugins-in-claude),
[MCP locale Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).
Le fonti stabiliscono le possibilità del prodotto; gli esiti sopra derivano dalle
prove sulle versioni indicate.
