# Errori unit già presenti sulla base

Confronto locale con Node 24.21.0 e dati sintetici temporanei. Runtime della base
`0a1980f323d62b4a7c2e1f01e0950a3ac5da218f` invariato durante il primo run.
Il run con il fix esegue lo stesso primo gruppo: 7.765 test, 7.723 passati,
28 falliti, 14 saltati in entrambi. Nessun nuovo fallimento.
Il runner si ferma su questo gruppo rosso. I due gruppi seriali residui sono
stati completati separatamente: 61/61 e 66/66 verdi.

I 25 casi del motore portabile ricevono `artifact_tampered` nella fixture locale
o falliscono le attese collegate. I tre casi macOS richiedono riferimenti
esterni al sorgente consegnato (`MEDIFLOW_MAC_PUBLIC_SOURCE_DIR`,
`MEDIFLOW_MAC_C1_RECEIPT`, `MEDIFLOW_MAC_NATIVE_SOURCE`), assenti in questi run.
Questi esiti non dimostrano un errore introdotto dal pannello, né qualificano
le funzionalità che restano rosse.

## Elenco completo

- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:53:1` — only Windows/Linux supported architecture combinations are admitted as candidates.
- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:60:1` — offline import requires digest-bound consent and does not select or activate.
- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:82:1` — revocation persists and is terminal for the same release.
- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:92:1` — tamper and undeclared artifact files cannot pass staging; old admitted version survives.
- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:134:1` — cancellation before and during import leaves no selectable partial object.
- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:147:1` — interrupted staging is not auto-promoted or erased without explicit recovery.
- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:159:1` — live lock is not removed by recovery or concurrent import.
- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:230:1` — physical-memory gate blocks activation of even synthetic fixtures; no admission is emitted.
- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:254:1` — host root is lazy for status but mandatory for consent-bound offline worker verification.
- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:267:1` — explicit host root, not the library source, binds worker integrity at import and activation.
- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:279:1` — default host cwd is captured once; later chdir cannot rebind the worker.
- `lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.test.ts:295:1` — host-root aliases and traversal remain rejected at artifact verification, never canonicalized into authority.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:62:1` — inference never acquires/installs an artifact, and never launches when missing or unadmitted.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:73:1` — one-shot invocation uses isolated args, offline allowlisted environment and true local identity.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:105:1` — single flight blocks concurrent preparation until the verified lease is closed.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:115:1` — authority lookup is deadline bounded even before process launch.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:123:1` — malformed, wrong-engine, oversized and empty stdout never succeed.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:137:1` — stderr is discarded and bounded; errors never include the raw process output.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:154:1` — controlled execution deadline kills the child and awaits close before releasing the slot.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:195:1` — request cancellation and revocation terminate pending local work.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:221:1` — unconfirmed termination poisons single flight until the actual close event.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:241:1` — artifact changed after execution is not published as a successful invocation.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:257:1` — real synthetic Node child exercises stdin/stdout and process close, NOT model inference.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:271:1` — mid-flight catalog change and pre-dispatch cancellation prevent output without a fallback.
- `lib/ai-providers/fabric/treatment-reasoning-portable-runtime.test.ts:297:1` — synchronous launch failure clears poll, returns provider_failed and permits a later explicit prepare.
- `lib/chatgpt-execution/execution-mac.test.ts:23:1` — pinned complete source, receipts and 24 C1 comparisons validate only the fixed projection.
- `lib/chatgpt-execution/execution-mac.test.ts:33:1` — source truncation, wrong receipt and unknown or invalid typed inputs are rejected.
- `lib/chatgpt-execution/execution-mac.test.ts:50:1` — native source pin is over the complete delivered C bytes, never a caller helper digest.

## Verifica della correzione P2

Nuovo run completo con Node 24.21.0: 7.765 test nel primo gruppo,
7.748 passati, **3 falliti**, 14 saltati. I due gruppi seriali sono verdi:
61/61 e 66/66. Restano soltanto i tre casi di
`lib/chatgpt-execution/execution-mac.test.ts` elencati sopra, riprodotti
anche nella checkout separata di `origin/main` a
`0a1980f323d62b4a7c2e1f01e0950a3ac5da218f`.

I 25 errori portabili del run storico si riproducono usando `/tmp` come
directory dati: su macOS è un alias simbolico di `/private/tmp`, rifiutato
dai controlli di integrità dei percorsi. Ripetendo le due suite portabili
su main con `/private/tmp` esplicito: **33/33 verdi**. Anche nella suite unit
completa del fix i casi portabili passano, usando la directory sintetica
canonica gestita dal runner. Non sono nuovi errori del fix né errori ancora
presenti nel run completo corrente.
