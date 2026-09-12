# PROPOSED-ADR — bounded Mac execution custodian

Status: **PROPOSED / CANDIDATE_NOT_QUALIFIED**. RUN_ID da3845a52c1bbe75a43fcd5fde993592.
Base context SHA256: 25374bcdc057575c57018f3379e2d3e9245e0258ea3fad679f85f6716548dc00.
Written before implementation. This is a reviewable decision, not acceptance of this ADR.

## D1 — three independent claims; consumed projection, not reconstructed source

Keep ConfigToml source provenance (complete file, receipt, commit, loader) separate
from build and runtime observations. Validate ONLY the fixed input projection
against the pinned complete JSON schema. Do not derive a runtime allowlist from it.
Re-run the public app-server JSON-schema generator using the run-owned, hashed
0.153.4 executable; compare every C1 schema digest. This binds that RPC surface to
those executable bytes, not the entire Rust ConfigToml implementation. On the
same copied executable require actual --strict-config startup, initialize and an
exact config/read. The proposal calls this **consumed-projection behavioral
binding**; full source-to-binary reproducible-build provenance remains unqualified.
No metadata/receipt import can replace these operations. Unknown roots, nonempty
origins, layers, and previously unproved null roots continue to fail closed.
A rejected actual readback does not authorize automatic normalization or retries.

## D2 — in-process issuer and custody

A private WeakMap records authorities actually created by the Mac producer.
The reviewed platform verifies the brand, binary path, run identity and current
native custody; it never invokes a caller's qualification callback. JSON, cloned
objects and environment switches cannot mint authority. Receipts are audit-only
projections. The issuer binds base context, policy revision, source/schema pins,
OS, binary, native helper digest, profile/config/CA digests, actual regeneration,
initialize/readback and resource lifecycle to a random run nonce. Monotonic
expiry and synchronous withdrawal precede asynchronous teardown. No persistence,
revival or imported receipts. C7 is not part of this authority.

## D3 — prohibit descendants, rather than discover escaped process groups

Use a small nonprivileged native supervisor owning exactly one unreaped child.
The child sets hard and soft RLIMIT_NPROC=0, and the sandbox also denies fork.
UID 0 or elevated identity is refused. It cannot create a descendant that changes
session/group; waitpid retains direct identity even if the original child changes
group. No process-group signal, PID enumeration or external process termination.
A dedicated lease descriptor is never inherited by the provider; EOF, deadline,
malformed control or administrative change kills only that still-owned child.
The supervisor reports reaping and exits; absence is not inferred from timeout.
A native negative probe is necessary but not sufficient: limits are applied anew
to each real child and the same owned channel reports launch/drain.

Per-run profile: deny default; no shell, tools, fork, ambient Mach services or
local IPC. Read only run assets and minimum system runtime; writes only named
scratch directories. Protect configuration, CA, binary and their directory entries.
Only the existing OpenAI CONNECT proxy can be reached. A native hard wall-clock
lease protects against a stopped JS event loop. Mac compilation, behavior of the
pinned binary without child creation and all OS containment checks remain gates.

## D4 — same-run seam and completed proposal semantics

Preparation does account-free generation/probe/initialize/config-read with egress
closed. The platform hands this SAME host to the existing product service once,
after its existing owner/consent checks. There is no second, unobserved spawn.
Login consumes the authentic initialization observation once, then performs fresh
config/read and account/read before the official device-code flow. The normal
unprepared synthetic transports keep their original initialize handshake.
Successful intentional drain seals the witness for publication of an already
completed proposal, until expiry/owner revocation; it never permits another RPC
or another host handoff. Unknown or failed drain invalidates authority. Default
production, UI, routes, server-auth and browser spec remain unchanged and held.

## D5 — smallest dependency and native build trust

Two additional existing dependencies are indispensable: execution-egress-proxy.ts
gets an optional initially closed admission gate. It rejects CONNECT before DNS;
activation only occurs on the reviewed platform's consent-gated handoff. Existing
proxy policy/hosts/limits and default test behavior do not change. This is not a
second proxy/relay, provider exception or global configuration.

The product-service transport wrapper must forward the new optional, one-use
initialization observation (one added line). Otherwise it discards that capability
and login incorrectly sends initialize a second time to the prepared process.
No consent, session, publication, route, public DTO or dispatch behavior changes.
A test follows the actual product wrapper and owner, not just the login unit.

The native helper is delivered as pinned C source. The explicit Mac producer
independently builds those exact bytes inside the run, using the installed
Apple-signed compiler selected by the fixed system xcrun invocation and a fixed
argument list. It does NOT accept a caller's helper digest or attestation JSON as
a trust root. The compiler/SDK are part of the reviewed macOS host TCB; there are
no caller CFLAGS, inherited DEVELOPER_DIR, toolchain overrides or downloads.
The native-source digest is fixed in the producer; resulting helper/toolchain
measurements enter the run receipt. Separate manual build instructions support
review, but their output alone never issues an authority. A missing SDK, invalid
Apple compiler signature or build error holds before any provider launch. Build
timeouts retain the private build directory rather than claiming complete drain.
No notarization entitlement or compiled Mac artifact is fabricated here.

## D6 — unmanaged-host path without hiding administrative failures

Support only a host with no effective MDM Codex payload and no system Codex
configuration/requirements. A native preflight checks the exact three system
paths with lstat, accepting ONLY ENOENT; any existing object, PermissionDenied or
other error holds. The same CFPreferences domain/keys as the public pinned Mac
loader are checked outside the child sandbox, without decoding/exporting values.
Synchronize failure holds. Recheck during custody; any detected change withdraws
before publication. Managed hosts are unsupported, not silently overridden.

The child profile grants read access only to the exact administrative paths so
the actual loader can observe genuine absence instead of sandbox-generated EPERM.
No file is created/removed and no LoaderOverrides, alternate config, CLI fiction,
MDM exemption or global policy edit is used. A concurrent administrative update
invalidates the run. The parent must test this on its pinned host: if CFPreferences
cannot reliably distinguish absence from service failure there, STOP, not absent.
This absent-only policy deliberately does not promise managed-host support.

## Rejected alternatives and acceptance limits

Reject JS negative process-group signals, success from a single probe, callback
witnesses, replayed receipt JSON, personal CODEX_HOME, credential reuse, permissive
readback spreads, and global requirements fixes. No Windows/Linux/Mini/mobile,
WHO, browser or clinical changes. Browser F5 parent results are independent and
not live evidence. No claim C2-C7 / OS_QUALIFIED follows from this source package.

## Source basis

Frozen PROMPT, FROZEN-PREIMAGES, ConfigToml schema and loader are authoritative for
this change. Supplemental public primary references consulted, not runtime proof:
- OpenAI app-server and managed-configuration documentation (current, not a build pin):
  https://learn.chatgpt.com/docs/app-server
  https://learn.chatgpt.com/docs/enterprise/managed-configuration
- Pinned Mac loader CFPreferences implementation:
  https://raw.githubusercontent.com/openai/codex/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/config/src/loader/macos.rs
- Apple XNU fork1 resource-limit enforcement (main, NOT a pin for 26A5425a):
  https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/kern/kern_fork.c
These establish proposal rationale; only parent OS tests establish applicability.

## Implementation refinement: drain is not publication authority

The platform's bounded watcher grace and the execution publication predicate are
intentionally different: during `draining`, the host's `boundaryQualified()` is
false. Only an authenticated STOP, supervisor close, owned-resource teardown and
successful cleanup permit the sealed completed-proposal predicate. A best-effort
500 ms service timeout cannot turn an unfinished drain into a publishable result.
The native owner's `live()` also becomes false synchronously on local close.
The frozen product receipt continues to say escapedDescendants=not_attested and
ownedGroupCessation=unconfirmed; this change does not falsify those UI fields.
The additional whole-tree observation belongs to the host-only Mac audit.

The old direct createQualifiedExecutionHost export is deliberately quarantined:
its signature had no issuer/run custody and must not spawn a second host. The
actual functioning entry is prepareMacProductQualification followed by the
reviewed platform transfer; this is not an unimplemented replacement producer.
