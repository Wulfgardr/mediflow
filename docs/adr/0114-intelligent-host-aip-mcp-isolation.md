# ADR 0114: isolamento AIP e MCP per Intelligent Host

Date: 2026-09-01
Status: Accepted

Issue: [GitHub #285](https://github.com/Wulfgardr/mediflow/issues/285)
Decisione packaging macOS:
[GitHub #329](https://github.com/Wulfgardr/mediflow/issues/329)
Program line: candidata `0.8.5`
Evidence base: `1452603ab6f3f53f25bc0788f7c09a8b024a4b59`
Evidence packaging macOS: `7f4cc6da6be9951f36db4ae274f0813215638619`,
Xcode `26.6` (`17F113`), SDK macOS `26.5`

Related: [ADR 0094](./0094-intelligence-fabric-headless-contract-085.md),
[ADR 0095](./0095-broker-projection-e-servizi-host-per-capability.md),
[ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md),
[ADR 0097](./0097-active-role-session-and-step-up-authorization.md),
[ADR 0100](./0100-fabric-vs-headless-semantic-plane.md),
[ADR 0103](./0103-headless-clinician-authorized-soap-entry-write.md),
[ADR 0105](./0105-web-auth-process-integrity-assumption.md),
[ADR 0108](./0108-piano-canonico-headless-read-only-085.md) e
[ADR 0110](./0110-riapertura-governata-programma-intelligente-085.md).

Protocol baseline:
[MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28),
[trasporto `stdio`](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio),
[discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover),
[tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) e
[autorizzazione](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

## Problema

ADR 0110 riapre la candidata `0.8.5` a MediFlow dentro un host intelligente
tramite Model Context Protocol (MCP). Il tree di base non contiene ancora un
server MCP o un runtime Agent Interface Plane (AIP): le 109 righe AIP sono
`observe` e `not_grantable`; i 66 anchor Headless restano `manual_only`, senza
`operationId` o `applicationServiceRef`; i 32 `GET` osservati sono soltanto
evidence candidate.

L'unico Application Service di scrittura Headless già integrato è
`mediflow.clinical_diary.append_soap.v1`. Le sue identità, approval e proof
sono process-local e non serializzabili. I production root dei quattro smart
path dipendono inoltre dall'auth Web e, in alcuni casi, da SQLite. Importarli
in un server MCP separato trasformerebbe l'adapter in un secondo composition
root con authority e dati non previsti.

ADR 0105 accetta per l'auth Web H1a un'assunzione di integrità process-global
limitata al processo server trusted. Eseguire un host intelligente, un client
MCP o un parser di input agentico nello stesso processo allargherebbe questa
assunzione a codice e input nuovi. Occorre scegliere un isolamento che renda
questa estensione non necessaria.

## Confine di minaccia

Il client MCP, il modello, `clientInfo`, prompt, tool arguments e tool output
sono input non fidati. Un processo locale dello stesso utente può tentare
launch non autorizzati, replay, handle guessing, frame oversized, flooding,
confusione di capability o uso dopo revoca. Log, stderr e crash report sono
considerati superfici leggibili da terzi.

Sono trusted soltanto:

- il launcher MediFlow che avvia il processo locale;
- il broker AIP dedicato e il suo codice verificato;
- gli Application Services nominati e i relativi owner host;
- il processo Web entro il confine già dichiarato da ADR 0105.

Restano fuori dal contratto un sistema operativo compromesso, un attaccante
con privilegi superiori all'utente, dipendenze trusted malevole e modifica del
binario dopo la verifica. Questi casi richiedono una nuova threat review.

## Opzioni considerate

1. **Server MCP dentro Next.js.** Riduce i processi, ma porta input e runtime
   agentici nel realm coperto dall'assunzione process-global di ADR 0105.
2. **Processo MCP separato con broker AIP separato.** Mantiene il parser di
   trasporto fuori dal processo Web e concentra authority, lease e revoca in
   un owner locale dedicato.
3. **Server MCP HTTP su loopback o LAN.** Introduce listener, lifecycle di
   sessione e un nuovo confine di autorizzazione prima che esista un tool
   clinico grantable.

## Decisione

Si adotta l'opzione 2. La prima slice usa un processo MCP `stdio` distinto dal
processo Next.js e non contiene authority clinica. I tool successivi possono
raggiungere MediFlow soltanto tramite un broker AIP locale, anch'esso distinto
dal processo Web e dal processo MCP.

```text
host intelligente non fidato
  -> stdin/stdout MCP adapter process
  -> IPC locale autenticato
  -> AIP broker process trusted
  -> Application Service nominato
  -> owner di dominio / Fabric host-owned
```

Il processo MCP non importa né riceve:

- `next/headers`, cookie, sessioni Web o
  `@mediflow/web-auth-lifecycle-owner`;
- `lib/security/server-auth*`, master key, PIN o bearer locali;
- `lib/db-server`, `lib/schema` o un owner SQLite;
- production root Fabric legati alla sessione Web;
- production root, approval, proof o identità SOAP H2-H7.

Su macOS il target del broker è il Mach service per-user definito sotto. Un
porting può usare Unix domain socket con permessi `0600` e peer credentials
oppure named pipe con access control list equivalenti. Ogni alternativa deve
autenticare il peer e conservare gli stessi denial; un listener TCP non è
equivalente.

### Packaging macOS e identità pubblica del peer

Il broker Node.js deve essere lo stesso processo che possiede i listener
`libxpc`. L'addon Node-API chiama il core AIP TypeScript in-process. Non è
ammesso un XPCService Swift che inoltra frame al broker tramite pipe, socket,
HTTP o un altro canale: sarebbe un secondo IPC non attestato e un secondo
composition root. Non è ammessa neppure una replica Swift delle decisioni di
owner, lease o revoca.

Il bundle firmato `MediFlow.app` contiene questi artefatti:

- `Contents/Library/LaunchAgents/com.mediflow.aip-broker.plist`;
- `Contents/Library/LaunchServices/com.mediflow.aip-broker`, launcher nativo
  che sostituisce il processo con il broker Node.js;
- `Contents/Library/LaunchServices/com.mediflow.mcp-launcher`, launcher nativo
  usato come comando MCP dall'host intelligente;
- `Contents/Frameworks/mediflow-aip-xpc.node`, addon Node-API firmato;
- `Contents/Resources/AIPRuntime/`, con broker, adapter MCP e manifest di
  versione, architettura, ABI Node e digest.

Il plist usa `BundleProgram`, non un path assoluto, ed è registrato dal
`MediFlowMacApp` con `SMAppService.agent(plistName:)`. Ha label
`com.mediflow.aip-broker`, `RunAtLoad=false`, `KeepAlive=false`, umask `077` e
due `MachServices` on-demand:

- `com.mediflow.aip.control.v1`, accessibile soltanto al parent host-owned già
  attestato, per staging e health del lancio;
- `com.mediflow.aip.rpc.v1`, accessibile al processo Node approvato che esegue
  l'adapter MCP.

Il plist non contiene bootstrap reference, token, path clinici, `NODE_OPTIONS`,
`NODE_PATH`, variabili `DYLD_*`, credenziali o endpoint di rete. I launcher
risolvono path solo dentro il bundle verificato e usano `execve` con un ambiente
nuovo e allowlisted. Il launcher MCP conserva soltanto home e directory
temporanea canoniche, locale, marker di runtime, nomi dei Mach service e una
bootstrap reference opaca. Non eredita l'ambiente dell'host intelligente.

Il parent host-owned usa il servizio control per creare lo stage già governato
da questa ADR e avvia il launcher MCP con la bootstrap reference casuale e
monouso nell'ambiente sostitutivo. Il launcher non può creare uno stage, un
owner o una capability e fallisce se la reference non è presente. Esegue subito
`execve` del Node approvato mantenendo il PID. La prima connessione RPC deve
presentarsi sul canale con PID, effective UID e audit session ID (ASID) attesi,
soddisfare il requisito di firma del Node e consumare la reference entro il
timeout. Il frame non può dichiarare o sovrascrivere questi attributi. PID e
reference, presi singolarmente, non sono authority.

L'addon usa soltanto API pubbliche disponibili dal deployment target macOS 14:
`xpc_connection_get_pid`, `xpc_connection_get_euid`,
`xpc_connection_get_asid` e
`xpc_connection_set_peer_code_signing_requirement`. Il requisito viene
applicato prima di accettare messaggi. Il servizio control richiede il
designated requirement esatto dell'app firmata e il binding della current host
generation. Il servizio RPC richiede il code directory hash esatto del binario
Node selezionato; un requisito generico sul nome `node`, sul solo team o sul
solo UID non è sufficiente, perché lo stesso eseguibile può avviare script
diversi. Il binding PID/EUID/ASID e la bootstrap reference monouso restano
obbligatori anche quando il requisito di firma è soddisfatto.

La build Developer ID usa identifier e Team ID attesi per i launcher, verifica
la firma dell'intero bundle e registra nel manifest il requisito esatto del
Node. Una build di sviluppo deve essere almeno firmata ad hoc e usa i code
directory hash esatti del candidato. Un bundle unsigned, un Node senza firma
verificabile, `SMAppService.Status.requiresApproval`, un requisito non valido o
un mismatch di manifest negano AIP. Non esiste un profilo permissivo per
aggirare il gate.

Il SDK pubblico Xcode 26.6 non espone un raw audit token da
`xpc_connection_t`. Sono vietati simboli privati, KVC, SPI, introspezione di
layout e serializzazione di `audit_token_t`. ASID indica la sessione audit, non
è il raw audit token. Se un SDK futuro aggiunge una API pubblica, il suo uso
richiede un nuovo ADR e non cambia retroattivamente questo contratto.

`MediFlowMacApp` è l'unico owner del lifecycle:

1. **Installazione.** Dopo un'azione locale esplicita verifica bundle,
   manifest, architettura, ABI e firme; registra il LaunchAgent con
   `SMAppService`; tratta l'approvazione di sistema come gate e completa un
   handshake di versione sui due Mach service.
2. **Aggiornamento.** Un bundle nuovo non modifica file dentro un bundle già
   registrato. L'app attende il completamento di `unregister`, registra il
   plist del nuovo bundle e accetta il cambio soltanto dopo l'handshake con il
   digest atteso. La disconnessione revoca prima owner, handle e bootstrap.
3. **Rollback.** Se registrazione o handshake falliscono, l'app disabilita il
   nuovo servizio. La candidata 0.8.5 non introduce un updater automatico: il
   rollback operativo ripristina il precedente bundle firmato conservato dal
   processo di distribuzione, poi ripete registrazione e handshake. Non combina
   launcher, addon, JavaScript o manifest di versioni diverse. Se il bundle
   precedente non è disponibile o il suo handshake fallisce, lo stato resta
   disabilitato.
4. **Disinstallazione.** L'azione locale di rimozione chiama `unregister`,
   attende la terminazione del job e verifica `notRegistered` prima di
   rimuovere il solo stato tecnico non sensibile. Trascinare l'app nel Cestino
   senza questa azione non prova una disinstallazione completa.

Il broker conserva bootstrap, connection binding, lease e generation soltanto
in memoria. Invalidazione XPC, cancel, timeout, uscita del peer, update,
unregister e restart revocano la connection generation prima di altre call. Un
restart non ricarica reference, owner o handle precedenti. Log e receipt di
lifecycle contengono soltanto versione, digest abbreviato, stato
`SMAppService`, outcome e denial code; non contengono raw identity, PID, EUID,
ASID, requirement, reference, frame o dati clinici.

Questa decisione autorizza il solo packet runtime
[GitHub #330](https://github.com/Wulfgardr/mediflow/issues/330). Non consegna
addon, plist, launcher, registrazione, test cross-process o disponibilità AIP.

Il processo Web può chiedere al broker di attivare un owner figlio soltanto
dopo un gesto esplicito e una verifica Web riuscita. Il bridge passa un comando
monouso minimizzato su IPC autenticato. Non passa cookie, oggetti sessione,
closure, owner, proof o grant process-local. Il broker crea e possiede la nuova
identità agentica; il bridge Web non la ricostruisce.

Questa topologia non modifica ADR 0105. La sua assunzione resta confinata
all'acquisizione auth nel processo Web. Il processo MCP e l'host intelligente
non entrano nello stesso realm JavaScript e non possono estendere quel claim.

## Thin slice MCP modern-only

La prima slice implementa MCP `2026-07-28` modern-only su `stdio`:

- usa il server SDK v2 e `serveStdio` con legacy rifiutato;
- implementa `server/discover`, `tools/list` e `tools/call`;
- rifiuta `initialize` legacy e versioni protocollo diverse;
- usa JSON-RPC UTF-8 delimitato da newline, senza newline incorporati;
- riserva stdout al protocollo e stderr a log tecnici redatti;
- applica un frame massimo di `64 KiB`, un timeout bounded, cancellazione e
  uscita ordinata alla chiusura di stdin;
- non apre socket, porte, browser, filesystem clinico o rete.

Il solo tool è `mediflow.system.headless_status.v1`. Ha input vuoto e restituisce
solo dati non clinici: versione del contratto, versione applicativa, 66 anchor
canonici, zero operazioni Headless generali grantable, binding SOAP MCP
`unavailable` e claim `MCP_PROTOCOL_SLICE_ONLY`.

Il risultato usa `structuredContent` validato dallo schema di output e una
rappresentazione testuale equivalente per i client che la richiedono. La
revisione finale `2026-07-28` non espone `resultType`. Le annotazioni
dichiarano read-only, non distruttivo,
idempotente e closed-world; restano hint e non autorizzazione.

Discovery, catalogo e stato non creano una sessione AIP o un grant. La slice
non legge pazienti, provider readiness, credenziali, audit clinico o database.
Il trasporto `stdio` non usa OAuth HTTP. L'ambiente figlio viene scrubbed e non
contiene credenziali del medico, cookie, PIN, provider secret o master key.
Un packet successivo può ricevere dall'ambiente soltanto un bootstrap reference
opaco, monouso e legato al processo, emesso dal launcher trusted. Il broker deve
comunque autenticare il peer: il bootstrap reference non è un lease e non
autorizza da solo alcun tool.

## Owner, lease e revoca AIP

Prima di un tool grantable, il broker AIP deve creare un owner agente figlio
distinto dall'owner Web. L'owner lega almeno:

- `agentRef` e `runtimeRef` opachi;
- finalità e `purposeCode`;
- operation e capability ID esatti;
- massimo stadio, budget e rate limit;
- patient, ambulatory e field scope quando applicabili;
- venue `local_intelligent_host` ed egress ammesso;
- expiry, generation, revocation generation e selection epoch.

Il chiamante non può fornire questi valori come authority. Riceve soltanto un
handle opaco, breve e process-bound. L'handle è un nome, non una prova: a ogni
call il broker autentica il peer, risolve l'owner, verifica capability, scope,
budget, currentness, expiry e generation e poi invoca l'Application Service.

Lock, logout, revoca esplicita, expiry, cambio paziente o ambulatorio, cambio
epoch, modifica della policy, disposal del padre e restart revocano prima della
richiesta successiva. Un restart non ripristina owner o handle. Il padre revoca
tutti i figli; un figlio non estende scadenza o authority del padre.

## Application Services e tool successivi

Un tool grantable richiede tutti i 13 campi di ADR 0100 e ADR 0108:
operation e capability ID, Application Service, schemi input/output, massimo
stadio, authority, sessione, CAS, idempotenza, limiti, receipt e dipendenza
Fabric. Una route HTTP o un ID OpenAPI non sostituisce questo contratto.

Il primo read candidato dopo la slice di protocollo è
`mediflow.terminology.search.v1`, basato sul catalogo locale LOINC/UCUM e privo
di PHI. Il primo read clinico candidato è
`mediflow.patient.open_loops.read.v1`: usa la selezione broker-owned, non
accetta `patientId` e restituisce riferimenti opachi e dati minimizzati.

Il read terminologico riserva il permit nel broker condiviso prima della
lettura e riceve un execution handle opaco. Dopo l'audit, il broker rivalida
revoca, restart, currentness e binding subito prima della pubblicazione; un
denial successivo al begin tenta sempre un audit terminale PHI-safe senza query
o item. Il budget di `250 ms` limita Promise pendenti e aggiunge un fence
cooperativo dopo callback sincrone. Non interrompe in modo hard una callback
sincrona ostile o bloccante, che resta dentro il boundary host trusted.

Patient Insight, Smart Import, Document Synthesis e Treatment Reasoning possono
diventare tool `proposal_only` soltanto tramite nuovi Application Services AIP
che riusano factory puri. L'adapter non importa i production root Web e non
accetta provider, modello, venue, endpoint, prompt, fallback o apply.

Nessun write entra nella thin slice MCP. L'append SOAP resta indisponibile via
MCP: il bridge non può serializzare o ricreare identità, approval o proof
process-local. ADR 0110 richiede una scrittura non-SOAP nominata, ma l'operation
ID e il relativo Application Service non sono ancora decisi. Questa decisione
aperta blocca la promozione del packet agentico, non la slice di protocollo.

Ogni futuro write richiede un ADR operation-specific con preview, conferma
esplicita, expected revision, idempotenza, audit, receipt e denial di replay.
Prompt, voce, chat, provider output, tool annotation e assenso conversazionale
non sono proof.

## Audit PHI-safe

Il broker usa una porta audit AIP; il processo MCP non scrive direttamente nel
database audit. Ogni call grantable registra soltanto:

- event type, outcome, operation e capability ID;
- riferimenti hash di agent e lease;
- purpose code, massimo stadio, generation ed epoch;
- receipt reference, timestamp, denial code e conteggi bounded.

Audit e log non contengono input o output del tool, query libera, prompt,
testo clinico, patient ID, handle, proof, cookie, token, segreto o payload del
provider. Un errore audit prima del commit nega l'operazione protetta. Un tool
read-only deve dichiarare la propria policy audit prima della promozione.

## Split di implementazione

La slice di protocollo resta sotto circa 300 LOC runtime e usa:

- `packages/mcp/src/server.ts`, `stdio.ts` e `contracts.ts`;
- `packages/mcp/src/tools/headless-status.ts`;
- test unitari e un E2E che avvia il processo `stdio` reale;
- `scripts/check-mcp-import-boundary.mjs` e relativo self-test.

Le dipendenze ammesse sono `@modelcontextprotocol/server` v2 fissato a versione
esatta, `@modelcontextprotocol/client` v2 fissato come dev dependency e Zod già
presente. Un upgrade del protocollo o una nuova dipendenza runtime richiede una
review separata.

Owner, lease, revoca, audit e IPC appartengono a un packet successivo in
`packages/aip/`. Il read terminologico, il read clinico e ogni proposal o write
restano packet separati con test e owner dei file distinti.

La porta macOS è ulteriormente separata in #329, decisione di packaging e
identità, e #330, implementazione Node-API/libxpc e prove cross-process. #330
non può introdurre un proxy Swift, un secondo IPC o un requisito di firma più
debole di quello deciso qui.

## Matrice di prova

| Gate | Prova positiva richiesta | Falsificatore bloccante |
| --- | --- | --- |
| Isolamento processo | PID distinti; import guard verde | import Web auth, DB, schema o production root nel processo MCP |
| Protocollo | `server/discover`, `tools/list` e `tools/call` su `2026-07-28` | legacy accettato, version mismatch tollerato o risposta fuori schema |
| `stdio` | stdout contiene solo JSON-RPC single-line; log solo su stderr | listener, rete, frame oltre `64 KiB` o testo extra su stdout |
| Discovery | output non-PHI e zero operation grant generali | catalogo, route o annotation trattati come authority |
| Input | schema strict, unknown tool e JSON malformato negati | campi inattesi ignorati o caller authority accettata |
| Risorse | timeout, cancellation, rate e frame bound provati | flood o completamento tardivo produce lavoro osservabile |
| Owner AIP | peer e owner figlio distinti verificati a ogni call | `clientInfo`, cookie, token locale o handle usato come identità |
| IPC macOS | Mach service per-user; PID/EUID/ASID dal canale, firma e bootstrap monouso verificati | identità dal frame, raw audit token, API private, TCP o secondo IPC |
| Lease | capability, purpose, scope, budget, expiry ed epoch esatti | lease condiviso, esteso dal figlio, ricostruito o cross-session |
| Revoca | lock, logout, expiry, epoch change e restart negano la call successiva | handle consumabile dopo revoca o restart |
| Application Service | un solo servizio nominato esegue regole e currentness | adapter, route o planner accede a SQLite o duplica business logic |
| Audit | record strutturato PHI-safe per successo e denial | prompt, testo clinico, patient ID, handle, proof o segreto nel record |
| Write | nessun write MCP nella slice; SOAP negata | proof process-local serializzata o write senza ADR dedicato |

Tutte le fixture sono sintetiche. Una matrice verde prova soltanto l'esatto SHA
testato; non prova installazione, interoperabilità con ogni host, sicurezza del
sistema operativo, uso clinico o release readiness.

## Conseguenze

- L'host intelligente può verificare il protocollo senza ricevere dati o
  authority clinica.
- ADR 0105 non assume l'integrità dell'host intelligente o del parser MCP.
- I tool clinici richiedono un broker e Application Services espliciti; la
  discovery non anticipa il loro grant.
- La prima integrazione aggiunge processi e IPC locali da monitorare e
  pacchettizzare.
- SOAP e la scrittura non-SOAP restano bloccate da decisioni separate.

## Stop rule e claim ceiling

Fermare il packet se compare un import Web/DB nel processo MCP, codice agente
nel processo Web, listener o egress, segreto clinico nell'ambiente, sessione o
authority caller-supplied, identità H2-H7 serializzata, handle valido dopo
revoca, audit con contenuto clinico, SQL diretto, provider selection, fallback,
write non deciso o un secondo boundary nello stesso diff.

Fino alla matrice completa della sola thin slice, il claim massimo è:
**ADR accettato per isolamento MCP/AIP; nessun server o tool è consegnato**.

Per la porta macOS, dopo #329 e prima della prova runtime #330, il claim massimo
è: **topologia LaunchAgent/XPC e identità peer pubblica decise; nessun addon,
servizio installato o flusso cross-process consegnato**.

Dopo una thin slice verificata il claim massimo diventa:
**MCP `stdio` locale modern-only con un tool di stato non-PHI; nessuna sessione
AIP clinica, operazione Headless generale, proposta, write, Intelligent Host
clinico, release readiness o release**.
