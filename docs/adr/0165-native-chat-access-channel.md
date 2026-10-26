# ADR 0165 — Canale di accesso della chat alla sessione GPUI

Stato: **Proposed**. Data: 26 ottobre 2026. Refs WUL-788.

## Decisione candidata

C4a aggiunge soltanto il protocollo e l'esito di accesso, senza proiezioni
cliniche, mapping, inferenza o writer. Non completa C4 né il broker di ADR 0160.
La GPUI già sbloccata possiede un listener Unix locale, abilitato da un percorso
esplicito in una directory privata. Lo stesso eseguibile offre un adapter MCP
`--chat-access-stdio PERCORSO`, privo di accesso al DB. Non viene collegato
`card-owner.mjs`, che rimane sintetico.

Il listener acquisisce dal kernel `LOCAL_PEERTOKEN` e `LOCAL_PEERPID`.
Security.framework risolve il codice dinamico dal token, ne verifica la
validità e confronta l'hash del codice con quello dell'eseguibile GPUI.
Una firma ad hoc generica o un percorso uguale non bastano. La catena dei
processi viene riletta con start time; un antenato vivo deve soddisfare il
requisito Developer ID esatto dell'host. I requisiti osservati sul target sono
`com.openai.codex` / team `2DC432GLL2` e
`com.anthropic.claudefordesktop` / team `Q6L2SF6YDW`.
La cattura viene confrontata di nuovo prima dell'uso; PID riutilizzati,
eseguibili sostituiti, app assente o riavviata negano l'accesso.
Anche l'hash del codice dell'antenato viene congelato nella cattura.

L'adapter espone una vista statica e strumenti app-only. Il tool di apertura
restituisce testo fisso. Il frame correla le richieste; non contiene endpoint
HTTP, bearer, cookie, PIN, chiave, nonce di approvazione o proof e non aggiorna
il contesto del modello. Le risposte contengono soltanto stati finiti.
La sola operazione ammessa è `mediflow.chat.access-status.v1`.
Il bridge usa il [protocollo MCP Apps 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).

La GPUI acquisisce dalla propria RuntimeSession la sessione operatore,
generazione archivio e selezione corrente. Il riepilogo nativo mostra host,
archivio, paziente e operazione, senza ricevere nomi dal chiamante.
La challenge interna dura 30 secondi. Touch ID usa LocalAuthentication con
policy biometrica; il PIN si inserisce soltanto nella GPUI e viene verificato
sul canale paired esistente da `verifyHostCredentials`, purpose confirmation,
con il lockout persistente comune. Nessun nuovo login, key wrapping o sblocco
a freddo: dopo riavvio serve il primo accesso v3.
Il GET della route privata `/api/auth/native/chat-access-confirmation` verifica
soltanto l'ammissibilità dell'account e il lockout; il POST verifica il PIN.
Nessuna delle due risposte è una proof. Anche il consumo dopo Touch ID rilegge
l'ammissibilità, per non aggirare un lockout del PIN sullo stesso account.

La concessione resta RAM e appartiene alla connessione OS, alla richiesta e
alla selezione catturata. Una sola operazione può consumarla. Il consumo
ricontrolla autorità e selezione, anche dopo attese asincrone. Una vista
inattiva termina dopo cinque minuti, senza rinnovo automatico. EOF, reload,
revoca, lock della sessione/Mac, cambio selezione anche A→B→A, cambio archivio
e riavvio ritirano richieste e concessioni; una risposta tardiva non le ricrea.

## Minacce e limiti

Un altro processo dello stesso utente, un booleano nel frame, l'origine HTML,
un UUID, un link o una firma ad hoc diversa non attestano il peer.
La connessione e l'hash del codice impediscono di riusare una concessione in
un'altra istanza. Nessun riferimento intercettato è una capability esportata.
Il modello o un frame ostile possono chiedere una conferma, ma non produrla.
Codice già iniettato in MediFlow o nell'host firmato resta fuori dal confine:
il protocollo non attesta l'integrità del renderer dell'host né cancella byte
già acquisiti. Perimetro e assunzioni richiedono review indipendente del diff.

L'abilitazione locale non è installazione globale o distribuzione. Le prove
unitarie non attestano il gesto biometrico, il PIN reale, la ricezione/rendering
MCP Apps dei due host o il ritiro osservato al lock del Mac; queste prove vanno
registrate sulla revisione e sul bundle effettivamente eseguiti.

## Preparazione e verifica circoscritta

Sul solo Mac target, creare una directory socket privata con nome breve,
per esempio usando `mktemp -d /private/tmp/mediflow-c4a.XXXXXX` e permessi
`0700`. Il percorso del socket deve rientrare nel limite Unix di macOS.
Avviare il candidato con `MEDIFLOW_CHAT_ACCESS_SOCKET` impostato al file
`access.sock` di quella directory e `--server` riferito a un host sintetico
isolato. Pairing e primo sblocco v3 avvengono nella GPUI. Configurare il client
MCP per invocare **lo stesso identico eseguibile** con gli argomenti
`--chat-access-stdio PERCORSO_SOCKET`; un altro build, anche firmato dallo stesso
sviluppatore, viene negato. La route privata deve esistere nell'host candidato.
La directory non viene creata o ripulita automaticamente; un socket esistente
non viene sostituito. Non usare un archivio reale per questa qualifica.

Le prove native aggiuntive, ignorate di default perché la CI non ospita
Codex/Claude firmati, si eseguono con `cargo test -p mediflow-gpui-patient-pilot
chat_access::owner::tests -- --include-ignored`. Verificano il peer reale, mentre
l'esito di presenza dei casi di grant rimane dichiaratamente sintetico.
`node scripts/run-strip-types.mjs --test lib/security/native-chat-access-confirmation.test.ts`
richiede `MEDIFLOW_DATA_DIR` isolato e prova il verifier e la route reali.
`npx playwright test --config e2e/native-chat-access-frame.config.ts` prova
il frame con un host di test a 390 e 1440 px, senza attestare R su un host desktop.

Rilevazione del 26 ottobre: macOS `27.2 (26B118)`, Codex `26.1021.31345`
build `21828` e Claude `3.6556.2`. La rilevazione identifica installazioni e
requisiti di firma, non qualifica il percorso interattivo dei due host.
