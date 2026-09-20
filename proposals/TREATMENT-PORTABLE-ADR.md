# Treatment Reasoning portable local engine

Status: **PROPOSED** — run 542972899b0244b8b7c345bcb219f1f5. Parent alone approves.

## Current contract and decision

ADR 0073 and the frozen production composition admit only `athena_mlx` for
Treatment Reasoning. ADR 0129 allows only opaque host-catalog choices. Clinical
output is `mediflow.treatment_reasoning.v1`, with the source-binding validator
in `treatment-reasoning-athena-output-contract-v2.ts`. These clinical rules,
review requirement, uncertainty semantics, kill switch and zero-write ceiling
are unchanged.

Propose a second, explicit `athena_transformers` CPU local-process engine on
`win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`. This is an implementation
matrix, NOT evidence that any runtime/model combination is available. On
supported macOS preserve MLX unchanged. No cross-engine fallback. No Mac relay,
Ollama substitution, network client, tool execution or acquisition in inference.

Compare: (1) original safetensors plus a fully inventoried offline Python /
Transformers / torch runtime, selected as the implementable seam; (2) llama.cpp
plus GGUF, deferred because neither verified conversion nor serving distribution
is supplied; (3) MLX on Windows/Linux, rejected, not asserted supported. Original
model identity is only the source declaration `mims-harvard/ATHENA-R1-Qwen3-8B`.
No runtime version, acquired-artifact digest or license approval is invented here.

## Host-owned provisioning and authority

A dependency-free host CLI imports a complete local bundle only after explicit
consent bound to the SHA-256 of a host-supplied release manifest. It stages and
hashes files, validates exact model identity, safetensors inventory, runtime
versions and license references, then atomically promotes an immutable object.
A separate consent-bound activation command verifies again and creates a local
admission receipt; importing never enables a clinical switch. Recovery removes
only this service's interrupted stage. Revocation is terminal for that object.
Missing evidence yields NEEDS_CONTEXT; absent object yields model_not_provisioned.
No browser can supply a filesystem path, command, URL, manifest or executable.
The CLI works without a Next server and requires an explicit MEDIFLOW_DATA_DIR.

Manifest acceptance is an operator trust boundary, not proof of authenticity:
the parent must validate upstream source, permission, weights and complete
runtime closure. Filesystem integrity is rechecked before and after execution.
Same-user hostile filesystem replacement is not claimed prevented. The Node adapter enforces wall-time and process I/O bounds; the Python
worker applies CPU/thread/input/output/memory bounds, local-only
loading and disabled remote code; Windows Job Objects and Linux rlimits must
be exercised on their actual operating systems. Offline library flags are not
a kernel network sandbox or clinical qualification.

## Versioned metadata; no v1 laundering

Retain all existing MLX v1 validators and exports. Add exact closed portable
attestation `mediflow.ai.treatment-reasoning-engine-attestation.v2`, including
provider, model, artifactDigest, runtimeDigest, workerDigest and platform.
Add `mediflow.ai.treatment-reasoning-engine-receipt.v2` and
`mediflow.ai.treatment-reasoning-engine-provenance.v2` under a separate
`mediflow.ai.treatment-reasoning-publication.v2`. Never mint an athena_mlx
receipt for portable execution. The generic Fabric v1 provider union and
resolver remain unchanged: the portable lane has a named, strict host-owned
resolution, not a cast or rewrite of an MLX resolution.

New on-disk schemas: `mediflow.treatment-portable-release.v1`,
`mediflow.treatment-portable-state.v1`. Dedicated namespace
`treatment-reasoning-portable/`, no DB/schema changes. Existing provider
lifecycle stores remain unchanged; the dedicated admission is read-only to
clinical consumers and disclosed with the selected portable option.

ModelOptionId binds provider + model + manifest digest. CatalogRevision binds
portable manifest/state revision as well as all existing sources. No automatic
migration of saved choices, no resetting stale defaults. Read-back and explicit
reselection are required after admission/revocation/change. macOS and legacy
fixtures without portable sources preserve their previous revision calculation.
An existing explicit MLX default on Windows is denied, not replaced.

## Follow-up 1: negotiated projections (written before dependent source edits)

The earlier proposal to extend the closed provider enum inside preferences v1 is
withdrawn. `mediflow.function-preferences.v1` continues to contain ONLY `ollama`
and `athena_mlx`. An absent or `1` `x-mediflow-function-preferences` header selects
that projection. Explicit `2` selects `mediflow.function-preferences.v2`, with a
closed `athena_transformers` option and bounded provisioning prerequisites. The
v2 client can read a genuine legacy response, but must reject a portable option
inside v1. Commands and previews use matching v1/v2 schema names. Unsupported
headers or mismatched command versions fail before any settings write.

Both projections carry the SAME opaque authoritative catalog revision. Filtering
v1 options does not manufacture an alternative catalog for dispatch. A hidden
portable host default projects to null/unsupported; a saved opaque default is
retained but stale/unsupported when absent from that client's view. A v1 command
cannot bind or enable a hidden engine, including via host_defaults. It may turn
an already-saved choice off without rebinding. All-off remains available. No
legacy MLX default is promoted, reset or silently converted. The existing v1
preference STORE is unchanged: it contains opaque IDs/revisions, not a provider
enum. Preference re-selection after a genuinely changed catalog is explicit.

Generic Fabric v1 status/provider/receipt contracts are unchanged. The negotiated
`x-mediflow-fabric-status: 2` response is
`mediflow.ai.fabric-status.v2` containing the unmodified `legacy` snapshot and a
separate strict `mediflow.ai.treatment-reasoning-disclosure.v2`. Its provider is
exactly `athena_transformers`; lifecycle/configuration, hardware prerequisites,
and runtime observation are separate. It never claims a successful execution.
The new page parses the legacy subobject with the EXISTING v1 parser, and the
capability-local disclosure separately. The generic provider union is not cast
or extended. Historical receipts retain their exact interpretation.

Official metadata supplied by the parent identifies commit
`acacc6b08e341aaf03c9639097255013ac65ebf2`, four original BF16 safetensors shards,
and their published LFS checksum/size declarations. These are metadata, NOT
acquired weights, runtime qualification, license approval or consent receipts.
The offline inventory command validates local bytes against those declarations
and requires operator-supplied exact runtime versions and existing license files.
It writes a draft manifest only; import and activation remain distinct actions.

Hardware policy is a conservative admission budget, not a benchmark: reserve a
second weight-sized load allocation, bounded KV cache for 8192+1600 tokens, 4 GiB
process overhead and 4 GiB host reserve. No memory or thread ceiling is relaxed.
The supplied 12 GiB Linux ARM64 / 18 GiB Windows ARM64 VMs do not meet that policy.
Native machine architecture is recorded separately from Node architecture (x64
Node emulation is not evidence of an x64 host or ARM64 torch support). The worker
checks Python build ABI with sysconfig.get_platform as well as platform.machine. Worker
request v2 binds the declared target platform; worker result v1 is unchanged.
No quantization, alternate model, remote Mac or unverified wheel is substituted.

Standalone tracing includes the Python worker, the offline CLI, provisioning
source, model identity and the Node runtime-contract source. A dedicated bundle
check validates physical source closure and source checksums, route trace links,
and excludes local model/runtime/secret payloads. The package.json Node contract
must be present and semantically match .nvmrc/source (formatting may differ in
the built package). It does not launch inference.
The original crosswalk and historical digest checks remain intact; a separately
versioned capability-local v2 mapping records the proposal and its exact wiring.

## Exact dependent code and integration

New core: `lib/ai-providers/fabric/treatment-reasoning-portable-{provisioning,runtime}.ts`,
`scripts/treatment-reasoning-portable-{setup.mjs,worker.py}`.
Existing integration: `treatment-reasoning-production-http.ts`, `function-model-{preferences,preferences-production,dispatch}.ts`,
`treatment-reasoning-{athena-output-contract-v2,athena-execution,production-operation,production-root,browser-controller}.ts`
(all under `lib/ai-providers/fabric/`), `lib/function-models/browser.ts`,
`components/{treatment-reasoning-panel,treatment-reasoning-portable-setup}.tsx`,
`components/function-models/{function-model-picker,function-preferences-panel}.tsx`,
and `docs/treatment-reasoning-athena-integration.md`. Exact patch dependency map
and changed tests are in delivery `CONTRACT-DEPENDENCIES.json`.

Follow-up 1 now implements the additional allowlisted status route, disclosure,
preferences HTTP boundary, shared Fabric page, Next tracing, standalone guard,
and generative crosswalk. `lib/fabric-settings-view.ts`, generic Fabric contract
and resolver, auth-owner, OpenAI account/product/execution, package/lock files and
accepted ADRs remain unchanged. Parent still owns ADR indexing in
`docs/README.md` and `docs/markdown-index.md` and actual build/OS promotion.

The clinical production root resolves the worker from the launcher-owned app
cwd under `scripts/`; it never derives deployed paths from a bundled chunk.
CLI closure is explicitly traced and checked, with no external package install.

The runtime is single-flight per host adapter instance, not across multiple
Node server processes. Deploy a single instance for this lane; multi-worker
concurrency coordination is a separate prerequisite before claiming a global
resource ceiling. Atomic promotion prevents partial visible object selection;
power-loss durability of a complete runtime distribution is not asserted.

## Risks, alternatives, acceptance and stop rules

CPU-only BF16 original weights may exceed time/memory budgets; bounds are policy,
not measured sizing. No custom model code or model-generated tool calls. Reject
unsupported schemas, tampering, missing license, runtime version mismatch,
stale selection, revoked admission, invalid output or source binding. A stopped
worker must not publish late output. Any test double proves only its explicit
contract, not real inference, qualification or offline OS isolation.

Acceptance: focused fixtures plus original regression tests, clean Windows/Linux
synthetic local inference under an enforced outbound network deny, observed
process termination/resource limits, restart/recovery/revocation, real output
source binding and physician review. Mac regression on real supported hardware.
Full-tree checks, runtime distribution evidence and synthetic OS acceptance are
separate parent promotion gates. All are BLOCKED when prerequisites are absent.
