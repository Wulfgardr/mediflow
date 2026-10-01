# Proposed synthetic MCP disclosure seam

Status: **Proposed**, standalone feasibility evidence for WUL-756; not an accepted
production security contract. Base: main `3cc6eda1245a33946cda2e512f2e5b551669ffe7`.

The existing production MCP serializes results directly. Fabric's generic egress
gate remains closed, and the ordinary ChatGPT boundary admits four named task
profiles rather than MCP payloads. This experiment tests one complete outbound
application representation before an in-process synthetic sink. It introduces
no production integration, database access, host registration or clinical
authority. The installed synthetic plugin is unchanged.

## Proposed contract

The only selections are two fixed invented cases. Their projection has schema
`mediflow.synthetic.open-loops-disclosure.v1`, `synthetic:true`, a demo case
reference, snapshot revision, truncation flag and one fixed open-loop item.
Item fields are opaque `loopRef`, kind, temporal state, opening/due timestamps
and revision. This is a small fixture-shaped subset, not a general parser of
the production contract's maximum 32 items. It has no patient ID, identity,
diagnosis, medication, document or owner/lease/receipt hashes.

Supported channels are `mcp_tool_result` and `model_context`. Each carries
exactly `content` (one text block generated from the projection) and
`structuredContent` (that same projection). Both presently have identical
payload shapes; the private grant independently binds its channel. Unknown
fields, hidden properties, accessors, proxies, symbols, extra blocks, altered
text/structured values and alternate cases fail closed. Errors, progress,
`_meta`, attachments, resources and identity maps are unsupported; they never
reach a sink. Denials are bounded local outcomes, not host error payloads.

The module constructs and recursively freezes payloads before serializing.
It hashes UTF-8 canonical bytes of the whole representation, evaluates those
same bytes, verifies the result's digest, then revalidates the payload. It
rechecks currentness immediately before consumption and sink invocation.
There is no await or caller callback in that last section. Selection, consent
records and opaque handles remain module-owned and absent from outbound data.

Explicit confirmation binds the prepared payload hash, fixed destination
`in_process_synthetic_sink`, channel, private selection generation and a
60-second wall/monotonic expiry. Preparations are bounded to 64 per session.
Cancellation, reselection, revocation, expiry or backward wall-clock movement
invalidates stale authority. Concurrent dispatch cannot duplicate a grant.
An observed expiry or rollback is terminal even if the wall clock recovers,
including when another dispatch is still evaluating. Later valid work needs
a fresh preparation and explicit confirmation; the stale grant cannot revive.
The grant is consumed before sink invocation: synchronous failure or rejected
delivery cannot retry, reconfirm or automatically create another authorization.
Already dispatched bytes cannot be recalled by later cancellation/revocation.
`dispatched` means the in-process sink completed, not confirmed network delivery.

## Fabric reuse and proof limits

`evaluator.ts` uses the lower-level pure `evaluateEgress()` on the full serialized
payload. It discards redaction maps/spans locally and rejects altered bytes.
The real policy denies both channels even after explicit synthetic consent.
There is no evaluator parameter, environment enable flag or model-callable
policy override. Positive dispatch tests replace the evaluator only using the
repository's existing process-local Node test module hook. They do not open
the real gate or exercise a provider/host.

A separate deterministic test exercises `createRedactionSession()` with
invented identifiers and local round-trip/close behavior. It does not compose
redaction into an admitted MCP path, qualify a neural model or assert privacy
eligibility. Reversible tokenization is pseudonymization assistance; no claim
of anonymity, global PII removal or public clinical-directory eligibility is
made. Dates and clinical workflow metadata may remain sensitive.

The sink is a trusted caller-supplied in-process test transport. This proof
covers bytes handed to it, not what it subsequently does, SDK JSON-RPC framing,
global filesystem/browser access or model retention. No actual Codex tool call,
modelContext transmission, UI action, clinical-data test or network dispatch
is part of this slice. Future WUL-731 work must provide a reviewed clinical
read-only admission/disclosure boundary and destination isolation. This
evidence neither completes WUL-731 nor bypasses WUL-757 dependencies.

## Focused verification

Run using Node 24 and an explicit run-owned synthetic data directory:

```sh
MEDIFLOW_DATA_DIR=/absolute/run-owned/synthetic-directory node scripts/run-strip-types.mjs --test lib/headless/synthetic-disclosure/contract.test.ts lib/headless/synthetic-disclosure/seam.test.ts lib/headless/synthetic-disclosure/dispatch.test.ts
```

Tests cover closed real policy, complete bytes for both synthetic channels,
text/structured mismatch, unsupported surfaces at nested levels, hostile
object shapes, foreign/forged consent, preparation bounds, wrong digest,
evaluation failure, cancellation/reselection/revocation/expiry during the
evaluation await, final-boundary expiry, immutable sink payload, pre-dispatch
consumption, sink failure/replay and post-dispatch revocation limits. They do
not load models, open databases, send patient content or write audit payloads.

Initial verification on Node 24.21.0: focused suite **29 passed**, headless portable
**261 passed**, MCP **33 passed**, Mini **20 passed**, all with zero failures or
skips. Full repository lint and typecheck passed, as did headless import,
never-regress and claims guards. Existing installed dependencies were reused;
TypeScript 5.9.3 and react-hooks 7.0.1 matched the lockfile. Full build, UI,
actual host and CI were not run for this local review slice; required PR build
validation remains pending before publication. No commit or PR was created.

After independent review, observed staleness became terminal before evaluation
and at both post-evaluation dispatch checks. The focused suite now has **33
passes**, including expiry/recovery, rollback/recovery, concurrent expiry while
evaluation awaits, and fresh confirmation for later valid work. Full typecheck,
focused lint and the static guards passed on this revision. Broader prior test
results belong to the initial bytes. On those initial bytes, a production build
using physical pinned dependencies stalled at compile and was stopped with
exit 130; standalone validation did not run. Cause remains unresolved. No build
had been retried on the revised bytes at that review checkpoint. Production
behavior remained unchanged.

After source re-review, the complete production build and standalone runtime
bundle guard passed on the revised bytes (Node 24.21.0, ABI 137). The build used
physical pinned dependencies, the default `.next` output, approved execution
outside the restricted sandbox and a short empty synthetic data directory.
An earlier retry compiled and typechecked but rejected the long synthetic data
path because PM2's Unix socket path exceeded 103 bytes. Fixing the run-owned
path required no production source/configuration change. The exact cause of
the original restricted-sandbox stall remains unqualified. Full lint and the
headless **261**, MCP **33**, Mini **20** suites also passed on revised sources.
Actual-host/UI and CI qualification remain separate from these local checks.
