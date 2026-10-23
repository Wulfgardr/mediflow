# Errori unit preesistenti su main

Node 24.21.0, `npm run test:unit` completo come da script CI, senza esclusioni aggiunte.
Directory dati sintetica distinta per ogni run; nessun database clinico usato.

Sulla base `64e190438`: 7.765 test, 7.717 passati, 34 falliti, 14 saltati.
Sulla composizione modificata: 7.765 test, 7.722 passati, 29 falliti, 14 saltati.
I 29 rossi del secondo run sono un sottoinsieme esatto dei 34 della base.
Nessun nuovo rosso unit. Il comando termina con exit 1 al primo gruppo rosso,
come in CI; questo non qualifica i gruppi successivi eventualmente non raggiunti.

## Rossi comuni ai due run (29)

I primi 25 riguardano il provisioning/runtime portabile (`artifact_tampered`),
3 richiedono fonti pubbliche e ricevute Mac non configurate, 1 richiede
l'esito `extracted` dell'OCR Apple Vision ma osserva `review_required`.

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
- `lib/domain/documents/anydoc-current-source-composition.test.ts:204:1` — continues a real AnyDoc image_or_scan result through offline Apple Vision.

## Rossi osservati solo nel run iniziale di main (5)

Sono prove di errore sulla base, non errori introdotti né corretti da questa PR.
I tre casi OCR hanno superato il timeout o restituito `review_required`;
il caso Mini ha restituito `OPERATION_DENIED`; il cleanup della sonda nativa
ha restituito `ENOTEMPTY`.

- `lib/domain/documents/anydoc-apple-vision-ocr.test.ts:35:1` — recognizes a synthetic image offline with bounded PHI-safe provenance.
- `lib/domain/documents/anydoc-apple-vision-ocr.test.ts:118:1` — fails closed for blank, malformed, oversized, and hostile image inputs.
- `lib/domain/documents/anydoc-current-source-composition.test.ts:510:1` — encrypted scanned PDF reaches real Apple Vision only after AnyDoc needsOcr.
- `lib/security/portable-supervisor-mini-production.test.ts:220:5` — production Mini uses genuine Web authority and terminates on logout.
- `scripts/run-native-probe.test.mjs:176:5` — stops the synthetic app on SIGTERM.
