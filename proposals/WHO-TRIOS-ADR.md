# WHO-TRIOS — local host, engine and launcher boundary

Status: **PROPOSED**. Run: `989f06de3f2341be87d202cc2ee55652`.
Base: sanitized attached snapshot of `eb41b5158c4097efe0367f2748a9f5f9e6c52199` plus its recorded dirty files.
This proposal is written before its dependent candidate code. Parent alone accepts,
integrates or promotes it. No accepted ADR is edited by this delivery.

## Current rule and replacement

ADR 0115 currently limits ordinary setup to macOS ARM64, Unix Docker sockets and
`linux/arm64`. The technical manifest v1 also pins ARM64. Replace only the ordinary
host provisioning boundary with a named, operator-run Node 24 CLI on darwin,
linux and win32 (Node x64/arm64). Select the image from the **Linux engine** arch,
not the Node host arch. Neither Windows nor Linux uses a Mac, relay or remote host.

A Unix endpoint is an absolute canonical local socket on POSIX hosts. Windows
accepts only `npipe:////./pipe/docker_engine` and
`npipe:////./pipe/dockerDesktopLinuxEngine`. These exact pipe names are candidates,
not a claim about any installed runtime. Reject remote pipe authorities, arbitrary
pipe names, TCP (including loopback), SSH, URL encoding, query/fragment and malformed
paths. Keep explicit `--context` on every engine operation; do not change the global
context, install/start Docker, install a VM, elevate or accept Docker terms.
Recheck endpoint and daemon identity before each operation on an owned installation.
The local Docker administrator remains trusted: a socket/pipe is not proof against a
local administrator relaying it. No absolute security or remote-daemon attestation is claimed.

## Evidence and versioning

Release-lock v2 has two entries checked against the supplied OCI index:
ARM64 `sha256:7555e43478202d3f9a25eeb2914cc5053414c9464ec6a9a7628c01375d5b0a5e`;
AMD64 `sha256:a63a4c1c73329ff2ebff616a0cde2089b6b0595dec25255844f57f5b1903a4b8`.
Follow-up 1 supplies the exact public AMD64 child manifest and readback as well
as context-only index/config bytes, verified by the parent. Both engine targets
may now reach **verified_metadata**, never acquired, licensed or qualified from
these files. Copy the two authorized AMD64 evidence files byte-for-byte and bind
the readback hash and observation time in lock v2. Preserve the raw microsecond
observation in the readback; the lock uses its canonical JavaScript ISO millisecond
representation, not a new observation. The index remains byte-identical.
`missing_evidence` still blocks an absent child/readback/lock binding **before
pull, consent recording or container creation**; altered evidence is invalid.
An index descriptor or config does not prove availability. No registry call is
made by the verifier. Only per-install real dataset, restart and restore receipts
can enable a runtime. No config file is added to source or implied to attest a
running engine.

Manifest v1 and its fixed validator remain supported unchanged. New ordinary
installations use manifest v2, with the same closed field set and stronger linkage
to verified release evidence. V2 permits only an evidence-verified engine target.
It does not weaken listener, license, dataset, mounts, options or lifecycle gates.
Installation/qualification v2 bind the local engine identity and host to the existing
installation UUID, container IDs, image and newly measured inventory. No dataset
hashes are distributed or assumed equal between architectures.

## Host filesystem and recovery

POSIX private state keeps 0700 directories/0600 metadata; snapshot payload retains
0644 inside the private directory. Windows paths must be local drive paths, not
UNC/device/ADS/relative/traversal/reserved-name paths. Reject symlink/junction/reparse
components and hardlinked state files. On Windows use a bounded, fixed PowerShell
ACL operation, with the path passed as data, not interpolated into source. Create
an explicit private DACL only for a **new** setup/snapshot directory; never repair
an existing directory's ACL silently. Require NTFS and current-user ownership,
FullControl, and no allow ACEs for other principals except SYSTEM/Administrators.
Existing broad/unknown ACLs fail closed with an actionable prerequisite.

Windows ACLs protect host copies; they do not replace the Linux container's 0:0,
0644 metadata checks. Restore may normalize only the newly owned restore container's
five named files to 0:0/0644 before comparing metadata and hashes. It never changes
foreign resources or the original dataset's permissions.

Keep explicit WHO acceptance and install gesture, separate app-start gesture,
private snapshots, incomplete receipts and retry. Cancellation is cooperative at
operation boundaries and polling waits, not a promise to interrupt synchronous
Docker instantly. Recovery may finish only for already-owned touched resources.
Hard interruption can leave the private mutex; never automatically delete locks
or containers. Failed requalification disables the next-launch configuration before
mutations and does not retroactively change an already-running server's environment.

## Launchers and Web boundary

`node scripts/who-local-onboarding.mjs [setup|status|qualify|start]` is the neutral
entrypoint. Keep `Setup_WHO.command`; add thin `.ps1` and `.sh` launchers. Ordinary
application launch delegates to existing `Start_MediFlow.command`,
`Start-MediFlow.ps1` or `scripts/start-mediflow.sh`, using argument arrays, inherited
unrelated settings and the three existing WHO variables. No shell interpolation
of operator paths, execution-policy bypass, privilege elevation or CLI arguments
chosen by the browser. Windows execution policy remains operator-owned.

The UI asks which computer **hosts MediFlow**, never infers that from the browser.
It only displays/copies commands and transient acknowledgement. Configured,
downloading, qualifying, missing prerequisites and an observed direct response are
different. Browser close/cancel cannot stop a host job. No Search/CodeInfo DTO,
transport, provider authority, clinical write, DB, account or network API changes.

## Migration

V1 technical manifests keep existing behavior. Existing ordinary v1 installation
records are preserved, not adopted into a new daemon. `status` does not promote
them and `start` denies. On explicit `setup`/`qualify` confirmation only, revalidate
legacy ownership and ARM64 image on the local engine, bind the new identity,
reset the private activation file and requalify with a new snapshot/receipt.
Foreign, changed-engine or inconsistent records require operator investigation;
no name-based adoption, deletion or automatic migration to another architecture.

## Alternatives, risks and acceptance

Rejected: always ARM64 under emulation; selecting by host CPU; remote Docker/Mac
relay; marking AMD64 qualified from the index; using POSIX mode bits on Windows;
installing Docker or changing its terms automatically; running Docker from Web.
Keeping ARM64/macOS-only is the unchanged-contract alternative.

Risks: local daemon trust, context drift between observable checks, disk exhaustion,
partial Docker operations, Windows ACL semantics/tool availability, launcher and
execution-policy differences, image download failure and dataset variation. Fail
closed and retain resources. Full checks and clean-machine trials are parent gates.

Acceptance: table-driven host/engine tests, endpoint denials, missing/invalid evidence,
identity drift, interrupted download/cancel/resume, occupied/foreign resources,
fresh inventory, offline/restore failures, Windows path/ACL fixtures and UI assertions.
Real per-OS trials must record runtime versions, target image, explicit consent,
per-install inventory, offline restart/restore and authenticated synthetic Search.
All live OS trials remain NOT_RUN until observed; fakes are not deployment receipts.

## Exact dependent candidate files

`Setup_WHO.ps1`, `Setup_WHO.sh`, `scripts/who-local-platform.mjs`,
`scripts/who-local-platform.test.mjs`, `scripts/who-local-onboarding.mjs`,
`scripts/who-local-onboarding.test.mjs`,
`scripts/who-local-onboarding-portability.test.mjs`,
`scripts/who-local-qualification.mjs`, `scripts/who-local-setup.mjs`,
`scripts/check-who-local-sidecar-manifest.mjs`,
`docs/who-local-release-lock.json`, `docs/icd-who-setup.md`,
`components/settings/who-local-setup-guide.tsx`,
`components/settings/who-local-setup-guide.test.ts`,
`lib/reference-data/repertory-guides-ui.test.ts`,
`docs/who-lock-evidence/2.6.0-amd64.json`,
`docs/who-lock-evidence/2.6.0-amd64-readback.json`.
The delivery's machine-readable dependency map is authoritative for actual changed
files; any further change must be within the frozen run allowlist.

Named assertion decision D1: retain the test previously titled “Mac ARM boundary
and missing Docker…” but change its unsupported-host fixture from Linux ARM64 to
an unsupported OS. Linux ARM64 is covered as supported by new portability tests.
No other negative gate is removed. V1 manifest/technical-engine mismatch assertions
remain intact; multiarchitecture behavior is explicitly v2 only.


Implementation refinements within this proposal: neutralize Docker override keys
case-insensitively; bind every v2 status read to the same observed engine; verify
local image metadata before create/requalification; persist a confirmed create ID
before a cancellation checkpoint. Windows generated launcher includes UTF-8 BOM
for Unicode paths in Windows PowerShell. SIGINT/TERM/readline close request
cooperative cancellation, not immediate interruption of synchronous operations.
Original onboarding tests now use a canonical run-owned MEDIFLOW_DATA_DIR scratch
root rather than an OS temporary-directory alias; assertions are retained.
The UI source-boundary tests are not mounted React tests. Full source runner and
clean-host trials are explicit parent gates, not inferred from these fixtures.

## Follow-up 1 amendment — before dependent edits

Named assertion decision D2: the parent now authorizes updating
`lib/reference-data/repertory-guides-ui.test.ts` against its supplied original
bytes. Verify the neutral Node command first, then explicitly select macOS,
Windows and Linux. Preserve fresh consent, clipboard copy-only behavior, reset,
focus restoration, minimum target size and zero unexpected requests. AIFA cases
are context and remain untouched.

Named assertion decision D3: remove only the obsolete assertion that the canonical
checkout lacks AMD64 metadata. Test both canonical verified targets; use explicit
read fixtures for absent, corrupt and cross-architecture evidence. Use each engine's
actual pinned manifest digest in the synthetic Docker matrix. Invented dataset
bytes and acceptance answers remain labeled test fixtures, not real receipts.

The clipboard cleanup uses one stable lifetime cell, captured inside the effect;
cleanup invalidates pending copy generations without reading a changing ref in the
cleanup callback. Test late fulfillment/rejection, reset/host switch and unmount,
including StrictMode lifetime replay. Do not suppress the ESLint rule.

The new component test retains its browser opt-in
`MEDIFLOW_WHO_UI_ACCEPTANCE=1`. Parent verification of the previous candidate is
historical input (115 PASS/1 SKIP focused; 6/6 separate browser; typecheck PASS),
not a result of this replacement. Actual validation of this candidate is reported
separately in VALIDATION.md. Clean-host trials stay NOT_RUN until observed.

No additional product decision or permission is introduced by this follow-up.
ADR promotion and canonical index updates remain parent-owned. Delivery remains
split COMPATIBLE / PROPOSED-CONTRACT and is a FULL REPLACEMENT against the
original sanitized snapshot, never a cumulative application to prior postimages.

## Follow-up 2 amendment — PROPOSED, written before dependent repair

D4: replace unverified in-image `curl` for all qualification searches with a fixed
Node built-in HTTP client on the host. Node 24 is already required, not a new host
dependency; no helper image, compiler, SDK, wget, Python, BusyBox or TCP shell is
assumed. The new minimal host helper is `scripts/who-local-probe.mjs`, with
`scripts/who-local-probe.test.mjs` as its focused tests; both are absent in the
original snapshot. They are the only conditional scope additions. The helper is
in-process, has no daemon or CLI entrypoint, and closes each request/socket on
completion, timeout or cancellation. It has no arbitrary URL/proxy interface.

D5: propose qualification receipt v3 for **ordinary** onboarding only. Keep all
WHO image/release/manifest pins, API contracts and accepted ADRs unchanged. Bind
each distinct acquisition/offline_restart/restored/original_recovered observation
to installation UUID, exact container, engine, inspected loopback mapping and
container start epoch, checked before AND after the HTTP request. Production uses
only IPv4 literal 127.0.0.1, fixed WHO search path/terms/headers, a private direct
agent, no redirect, proxy or DNS, five-second absolute deadline and 65536-byte
response limit. Validate status, JSON media type, complete stream and WHO URI
schema; only explicit transport startup conditions may poll, up to the unchanged
60-attempt bound. Unknown errors and missing executables are terminal on attempt 1;
retain bounded structured cause/status rather than raw Docker output.

D6: use an owned `--internal --driver bridge` Docker network for offline restart,
restore and the final original service. Original publishes only 127.0.0.1:8382:80;
the temporary restore container publishes only an engine-assigned host-loopback
port, read from its exact inspected ID. No host network, guessed VM address,
remote bridge, relay or additional image. Never reconnect the acquisition bridge
to recover a failed offline operation. Successful recovery means a separate
stop/start and fresh search plus hash/metadata readback of the ORIGINAL container
on the owned internal network, not reuse of the restored copy's observations.
Failure retains receipts/snapshots/IDs and stops only proven-owned running
containers; ambiguous ownership or foreign attachments stop automation.

Internal-network metadata and loopback publication alone do NOT qualify isolation.
Read actual IPv4 and IPv6 routes (existing `cat` prerequisite, verified by actual
command success), reject default/routed egress and unexpected attachments, and
retain route hashes in pre/post observations. Existing dataset `stat`, `sha256sum`
and Windows restore-only `chown`/`chmod` remain explicit, unverified target
prerequisites; a missing one is terminal, never substituted. No network/container
is adopted by name or removed, including failed resources. Validate daemon,
network ownership/membership and container before mutations. Preserve recorded
network IDs for resumed owned attempts. Old v1/v2 qualification cannot authorize
v3 start: require a new explicit qualification gesture; retain old disk receipts.

Linux native Engine and local Docker Desktop/VM-backed engines are **candidates**,
not demonstrated equivalents: whether a published port remains reachable on an
internal-only network, routing, IPv6 and Windows ACL/metadata behavior require
separate real per-OS gates. A failure is a blocker, not permission to relax
isolation or install tools. The private Node transport tests use synthetic local
HTTP peers, never label their responses WHO qualification. Parent approval of
this concrete proposal precedes all guest execution and accepted-ADR changes.


D7 — explicit limitations and non-promotion: Engine >=28 is a newly proposed
prerequisite (loopback publishing semantics), not an installed runtime claim.
Internal-only port reachability is an **unresolved feasibility gate**, not generic
readiness certified by flags. The supplied historical Mac report already says
that internal networking did not publish the host port; Moby issue 36174 describes
a related limitation. A verified port inspection must be followed by actual HTTP;
no publication means terminal `probe_endpoint_unavailable`. This candidate may
therefore stop at offline qualification. The parent must review this known risk
before any guest attempt; code completion must not be labeled tri-OS success.
No static probe binary, helper image or proxy service is silently added to evade it.

D8 — changed assertions are explicit contract changes, not skipped regressions:
prior tests expected source recovery to the egress-capable bridge and no restore
publication. V3 instead expects the source on its recorded internal network, a
loopback-only ephemeral restore port, four distinct request/binding observations,
and owned stopped resources on failure/cancellation. A restore mismatch never
substitutes original-recovery evidence. Primary recovery-probe failure is now
`failure`; errors from the later stop-only cleanup remain separate. V1/v2 saved
qualification requires a new user gesture and new v3 proof. Accepted v1 technical
manifest gates, UI/clipboard/repertory/AIFA files and release evidence are unchanged
from follow-up1. Review/acceptance of D4–D8 is parent-owned.

Dependency/lifecycle detail: default production request implementation is imported
statically from the host-only helper. The injectable request function appears only
in private module dependencies used by explicit synthetic tests, never flags/env,
Web input, license data or runtime state. All four successful probes have separate
GETs and distinct container-start bindings. On errors, stop only still-proven-owned
containers; retain all networks, snapshots and IDs. A failed stop is not reported
as stopped. HTTP abort closes its socket immediately; synchronous Docker calls
remain bounded and cooperatively cancelled between operations, not falsely
represented as interruptible. Existing 60-attempt/59-wait readiness maxima remain,
but only connection-startup/503/timeout codes are eligible. Exit127 is one attempt,
zero additional waits, and keeps its bounded executable/exit cause.


## Follow-up 3 — Mac host access correction (PROPOSED BEFORE CODE)

Status: **PROPOSED**, not accepted; this amendment supersedes D6/D7 only for Mac.
The accepted ADR0115 and application contracts remain byte-identical. Integration
and real Mac execution require the parent's review of this topology change.
0.8.6 scope: Mac, localhost on Mac and the shared backend/Headless on that Mac.
Windows, Linux, Mini and mobile are deferred to 1.0. Existing cross-platform
sources are retained, not newly qualified. Linux r3 is diagnostic evidence only.

### D9 — F-WHO2 / F-WHO3 and authorship

Review and carry the four-file pre-directive local Codex correction explicitly:
qualification IDs may consist of at most sixteen canonical same-origin,
2026-01/mms numeric URI components separated by the exact ` & ` delimiter,
with the 1536-character ID and existing 32-character code/64KiB response bounds.
No URL normalization or application Search-contract broadening. Use the current
`docker container stop --timeout 30` spelling; retain exact returned container ID
and independent stopped-state inspection. This local delta is prior authorship,
not a new runtime proof or silently reattributed code. New corrections below are
produced in this follow-up. The supplied 106 PASS/lint0 remain prior evidence.

### D10 — host-only, owned, read-only EXEC bridge

F-WHO4 is an absent *effective* Docker publication on an internal-only network.
Do not treat HostConfig requests or null NetworkSettings ports as availability.
New Mac-owned containers have NO Docker port publication, including acquisition
and restore. WHO stays on the same pinned image; online seed alone uses bridge.
Offline restart, restore and original recovery remain on the single owned
internal bridge with no routed IPv4/IPv6 egress and no foreign network members.

One new essential host helper, `scripts/who-local-loopback.mjs`, provides a
process-owned IPv4 listener (127.0.0.1:8382; ephemeral for restore tests) and a
one-shot read-only Docker EXEC transport to 127.0.0.1:80 *inside the exact WHO
container*. This is not a routed network path, another container, reverse proxy
with arbitrary destinations, host networking, VM-address discovery, firewall
change or WHO-image modification. No mount, socket mount, privilege, capability,
image pull or package installation is added. No service-initiated connection can
use this one-way request/response interface to reach the host or Internet.

#### D10 amendment F4 — PROPOSED, supersedes the F3 GNU/Bash prerequisite

The parent observed BusyBox1.37.0, no `/bin/bash`, and rejected GNU timeout
options in the exact pinned ARM64 image. This amendment changes only the fixed
EXEC implementation, not topology, image, accepted ADRs or application APIs.
The following is an argv vector, NOT shell code:

```
/bin/busybox timeout -s KILL 4 /bin/busybox nc -n -w 5 127.0.0.1 80
```

There is no shell, `/dev/tcp`, GNU option, `nc -e`, listener mode, caller command,
DNS destination, extra image or installed executable. Docker EXEC still uses
UID:GID65534, an exact64hex ID, the pinned engine socket and data-only stdin.
The separate BusyBox deadline sends KILL to the one request program after four
seconds. We do **not** claim GNU process-group semantics. The fixed client has
no command-execution/listen mode and must not leave a request descendant. The
watchdog's lifetime and exit after client disconnection must be observed on the
pinned image, not inferred from a host CLI's termination. Four seconds is an
inner deadline, not proof that cleanup has occurred at the instant of abort.
The host's original five-second deadline and 250ms CLI-kill escalation remain.

`nc -w 5` is not the absolute deadline: its connect/final-read timer is longer
than the independent four-second KILL deadline. No success is derived from an
idle timeout, help text, pipe closure or a surviving partial body. Stdin receives
one canonical complete GET then EOF; the required nc behavior is write-side TCP
shutdown while continuing to read the response. A response is released only
after a successful EXEC exit, exact Content-Length or strict complete chunked
framing, JSON/UTF8/caps and fresh before/after identity checks. EOF-delimited
unframed responses are now rejected because nc exit alone cannot disambiguate
all network termination cases. HTTP `Connection: close` remains mandatory in the
request. No deadline/abort/nonzero exit releases even a fully buffered body.

Preflight is three bounded observations on the owned container: (1) the fixed
BusyBox timeout/cat command echoes an exact marker after stdin EOF, (2) nc help
under the same short-option timeout verifies the required1.37.0 applet shape,
(3) timeout kills a cat whose stdin is deliberately held open, after its marker
was observed, within the test's bounded elapsed interval. Missing/unsupported
BusyBox, nc syntax, short-option timeout or deadline evidence fail explicitly.
These observations only establish executable/stdio/deadline capabilities; they
are **not** TCP, image process-lifetime or WHO/dataset qualification. Fresh
ownership/engine/container/epoch checks bracket preflight as well as HTTP.
The prerequisite/transport identifiers advance to BusyBoxv2 within the existing
PROPOSED Macv4 schema; an F3 receipt is never promoted or rewritten automatically. A ready Macv4 receipt
with obsolete F3 fields remains `private_state_invalid` under the existing
validation gate; do not edit it or claim it was requalified. A failed/incomplete
installation can use the existing explicit-consent resume path.

On cancellation/output-limit failure, discard output and end stdin. For a fixed
bounded EXEC retain the attached CLI until exit or the original host deadline;
this keeps the host operation slot occupied while the inner deadline operates.
At host deadline kill only the owned CLI, never PID guesses or process groups in
the container. That fallback yields failure, not an inner-process-closure receipt.
Listener close waits for its tracked operations; it does not turn CLI closure
into runtime evidence. The real-image acceptance test below independently checks
that the request nc and watchdog no longer run after disconnection. Kernel
TIME_WAIT is not a running process. The temporary cat PID1 is not a reaper; any
exited/zombie watchdogs are reported separately, never treated as WHO lifecycle
qualification. Repeated-request reaping on the real WHO PID1 is a separate Mac gate.

Before promotion, the parent must run the opt-in pinned-image test in
`scripts/who-local-probe.test.mjs`: owned no-network/no-volume temporary peers,
UID65534, fixed127.0.0.1:80, delayed reply only after client EOF, exact request
bytes, non-closing/partial/trickling peers, CLI detach and finite internal process
readback. No WHO service, dataset or existing container is involved. Presence,
help, synthetic Docker adapters and Linux host BusyBox tests cannot satisfy this
gate. Then run the real Mac WHO acquisition/offline/restore/recovery and backend
checks; a transport-only success creates no installation or qualification.

The helper resolves the approved local context and pins each async command to
that exact Unix socket (`--host`, no context/environment override). Revalidate
the hashed daemon and endpoint, exact container ID/owner/image/start epoch,
network owner/membership and offline routes before and after EVERY response.
Buffer the bounded response until all checks pass. Never read Config.Env or
credentials. Host/client disconnect, SIGINT/TERM, timeout or guard mismatch aborts
the owned host request/socket; container-side closure is bounded and independently
qualified as specified above, never inferred from CLI exit. No other resource is killed.

The HTTP surface accepts only canonical GET search, codeinfo and numeric entity
paths already constructed by the shared backend (2026-01 MMS, English). Fixed
upstream headers, no caller-supplied executable/URL/host/port, no redirects,
proxying, cookies/authorization, browser Origin or body; cap query/header/body,
concurrency and duration. No request text, titles, codes or raw bodies are logged
or persisted. Code-check and empty Search replies remain application-validated;
qualification separately requires real nonempty validated public Search replies.

### D11 — qualification and lifecycle

Mac receipt v4 separates the new transport from v3 Docker-published observations.
Four independent fresh GETs remain compulsory: acquisition, offline restart,
restored copy, recovered original. Each observation binds the actual listener
instance, engine/container epoch, response digest and proof of EXEC transport.
Acquisition of a legacy Mac container may use its genuinely published port;
all offline phases use the new bridge. Inherited requested ports are NOT an
observed listener. Old ready receipts require explicit `qualify` consent, never
automatic promotion. Snapshot hashes, restore metadata, license and enable gates
are unchanged. A failed acquisition/restore/recovery cannot activate WHO.

The ordinary Mac launcher holds the owned bridge while the app launcher runs.
`serve` supplies the same qualified WHO endpoint in the foreground for an already
started Mac app/shared backend; Ctrl-C closes only this bridge. No background
agent, LaunchAgent, daemon auto-install or PID-file adoption. Configuration and
past qualification never imply that a bridge is currently serving. Status is
read-only and states that distinction. When no bridge is running WHO is optional
and unavailable; normal patient UI/startup is unmodified. One bridge only: a port
conflict is terminal and never a reason to stop an existing process.

### Required evidence before promotion

Node24 unit/protocol tests are not Mac or Docker qualification. On the target Mac,
verify exact tools and engine, seed from public queries, observe NO native Docker
publication yet successful HTTP at the owned listener, stop/restart and repeat
real Search, restore five files to the separate pinned container and compare
hashes, recover the original and query it, prove no default/routed egress before
and after, then check shared-backend Search/code-check and cancellation/cleanup.
All missing observations are NOT_RUN; Xcode/appMac acceptance is parent-owned.
No Windows/Linux/Mini/mobile qualification is authorized by this amendment.

## Follow-up 5 — D12 PROPOSED: owned first-start diagnosis and bounded retry

This amendment is written before its dependent implementation. It adds no accepted
ADR, permission, topology, image, catalog, language, proxy setting or qualification.
D10 BusyBox transport and D11 four-observation lifecycle remain unchanged. Exact F4
parent Mac transport: four scenarios passed; real WHO first startup failed. These
are different observations. The supplied pre-cleanup log records a catalog-load
failure and WHO exit134/noOOM, not a demonstrated networking or dataset root cause.

### Decision and scope

Separate **ownership**, **process liveness**, **transport capability**, **WHO HTTP
readiness** and **dataset/offline/restore qualification**. A stopped owned process
must not be called a foreign container or a broken timeout executable. Actual
operations retain their expectedRunning guards; a diagnostic read without that
expectation never authorizes EXEC, startup, copying or activation.

Only scripts/who-local-qualification.mjs and scripts/who-local-onboarding.mjs need
product edits, with their two existing onboarding test files and setup documentation.
The BusyBox helper, all four pinned-image transport scenarios, probe/response
validation, F-WHO2, F-WHO3 stopOwned block, pins, five-file catalog and other source
files stay byte-identical. There is no new project helper and no new delegation.

### Runtime observation and failure precedence

Inspect only the recorded container on the already-bound local engine. Extend the
existing selected inspect projection with status, exit code, OOM flag, finished
stamp and a boolean indicating a runtime error. Never fetch Config.Env, raw error
strings, raw logs, URLs, request bodies, tokens, patient data or dataset contents.
Before and after a startup/prerequisite/readiness operation revalidate ownership,
image, engine, topology and start epoch. Missing/malformed evidence fails closed.
An observed same-epoch process exit takes precedence over a simultaneous relay137
error, but the original minimized relay cause is retained. Ownership/engine/epoch
mismatch and cancellation remain terminal; they cannot turn into readiness retries.
An independently still-running unchanged process retains its original transport
failure. A successful transport or inspection never yields a WHO observation.

Record the minimized runtime failure **before** cleanup. Cleanup stops the exact
owned resources and cannot overwrite that observation with the exit caused by
Docker stop. Additive diagnostic fields in private v4 receipts do not satisfy or
change any completeness/activation criterion. The underlying runtime cause stays
undetermined; exit134 is not a network, memory, proxy or catalog-integrity diagnosis.

### Cold startup and recovery

For Mac qualification, persist the incomplete attempt and disabled configuration
before the original start. Start a retained stopped original at most once per
explicit setup/qualify invocation; confirm the returned exact ID. A self-exited
process never enters a blind restart or readiness loop. If it remains running,
only the existing three startup-unavailable error classes permit polling, bounded
by 60 attempts and a 15-minute monotonic budget. The budget is cooperative around
bounded synchronous Docker reads (not a promise of instant interruption); cleanup
has its existing separate bound. No timeout is increased inside BusyBox or HTTP.
A resume uses the same UUID, image, license and container; a new attempt records
its predecessor ID, leaving old snapshot/qualification files untouched. Unresolved
interrupted resource topology must be investigated, never silently reconnected,
adopted or erased. Offline restart/restore/original recovery still need independent
real WHO searches and all five measured files/hashes.

Add a host-only `diagnose` action: read-only selected runtime evidence and a minimized
previous-failure summary, no start/stop, EXEC, log collection, port adoption, download,
license change, receipt creation or activation. Do not run it concurrently with an
active installer. An inspected stopped process is not by itself evidence of why it
stopped; the prior pre-cleanup receipt/log remains the relevant original evidence.
No changes to Web UI, Fabric, shared-backend contracts or launchers are needed.

### Official documentation, uncertainty and external prerequisites

WHO ICD-API Docker documentation consulted for this defect:
https://icd.who.int/docs/icd-api/ICDAPI-DockerContainer/
It documents ARM support, `include=2026-01_en`, Internet access at first run and,
where a network requires it, an explicit `https_proxy` container setting. None of
that proves the supplied crash was network-related. Do not copy the documentation's
unpinned image, publish-all-interfaces example, analytics opt-in or container-removal
steps. No proxy address/credential is supplied or inferred. A needed proxy/certificate
or other new external prerequisite requires a separate exact reviewed change before
application to this governed installation. No private download endpoint is invented.

Acceptance requires synthetic regressions for an early crash, crash during held-open
preflight, unchanged live transport failure, delayed-but-live readiness, bounded
exhaustion, cancellation, identity/epoch drift, exact-ID start, read-only diagnosis
and explicit same-container retry with old evidence preserved. Mac actual startup,
acquisition, five files, offline restart, restore/recovery and backend searches remain
NOT_RUN in this delivery. If the pinned WHO service still exits134, stop with the
new diagnosis and the discriminating operator recipe; never manufacture green.

D13 named assertion decision: initial Mac start now occurs after disabled who.env
and an incomplete receipt are persisted. The existing create/start failure test
must therefore require absent who.env for a failed create, but exact enabled=0
plus an incomplete start_failed receipt for a failed initial start. It still
requires the phase error, no raw output, mutex release and no resource removal.
This is stronger failure evidence, not a successful-start substitute.
