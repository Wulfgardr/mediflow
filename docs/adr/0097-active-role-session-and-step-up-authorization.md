# ADR 0097: ruolo attivo e step-up per la scrittura SOAP Headless

Date: 2026-08-25
Status: Accepted

Issue: WUL-282, WUL-522
Program line: candidato `0.8.5`

Related: [ADR 0094](./0094-intelligence-fabric-headless-contract-085.md),
[ADR 0095](./0095-broker-projection-e-servizi-host-per-capability.md),
[ADR 0096](./0096-owner-sessione-selezione-e-lifetime-broker.md),
[ADR 0098](./0098-physician-terminal-review-authority.md),
[ADR 0100](./0100-fabric-vs-headless-semantic-plane.md) e
[ADR 0103](./0103-headless-clinician-authorized-soap-entry-write.md).

Historical candidate evidence only: commit
`89645257fd76b08009ddb6d4533b8bde608d0f9d`. Its ADR 0097 candidate informed
this reconciliation but is neither an accepted base nor a whole-blob source.

## Problema

ADR 0103 permits exactly one Headless write contract:
`mediflow.clinical_diary.append_soap.v1`. It needs a host-owned active-role
and fresh-step-up prerequisite without turning a browser session, role label,
review decision, provider result, conversational exchange, or transport into
clinical authority.

Without this boundary, a proposal or a technical credential could be replayed
as a broad clinical write grant. Conversely, applying step-up to ordinary
reads or Fabric proposals would conflate consultation with authorization.

## Decision

### Narrow scope and default denial

The default is deny. In `0.8.5`, a Headless active-role session can be made
eligible only for the sole operation
`mediflow.clinical_diary.append_soap.v1`, with policy
`clinician_confirmed_single_use`. It is not a general clinical-write grant and
does not permit a second operation by similarity, delegation, fallback, or
policy downgrade.

All other Headless operations remain read, query, orchestration, preview,
proposal, or denial. Fabric capability rows, including all five named smart
paths, remain `applyPolicy=none`. Mini remains `proposal_only`. This ADR does
not create a Fabric-to-Headless authority bridge.

### Host-owned active-role attestation

An `ActiveRoleAttestationV1` is inactive by default. Only the host can resolve
the authenticated local principal to an opaque `actorRef` and validate that it
is eligible for the controlled `physician` role and the sole SOAP operation.
The attestation binds at least:

- opaque actor and attestation references;
- fixed role `physician` and fixed operation identifier;
- policy version and issuer reference;
- attestation version, expiry, and revocation generation; and
- the minimum PHI-safe state needed for host validation.

It is never a role string, cookie, PIN, pairing record, token, device identity,
provider status, receipt, proposal, or caller field. A missing, shared,
ambiguous, expired, revoked, mismatched, or unverified host binding denies.

The attestation does **not** grant a patient, ambulatory scope, SOAP fields,
payload, command, idempotency key, expected revision, commit, apply, or
authorization proof. Those bindings remain host-generated in ADR 0103 and its
later packets.

### Session projection and fresh step-up

After host validation, a process-local `ActiveRoleSessionGrantV1` may project
only the attestation facts needed for the current authenticated session:
`actorRef`, attestation reference/version/revocation generation, fixed role and
operation, principal/authentication generation, session generation, policy
version, expiry, and terminal state. It is opaque, non-serializable,
non-transferable, and restart-denying.

The host must invalidate it before the next authorization attempt after lock,
logout, expiry, principal or authentication-generation change, role/policy
change, revocation, or confirmed session disposal. Restart denies; there is no
restore, replication, silent re-enrollment, or cached fallback.

A fresh host-authentication step-up is required later at the explicit
clinician approval boundary. It is operation-bound, short-lived, single-use,
and cannot be supplied, performed, inferred, or replayed by chat, voice,
planner, agent, provider, Mini, Web adapter, receipt, proposal, PIN text, or
any transport. A conversational assent is not an approval artifact.

### Separation from review and Fabric

`physician_terminal_review` in ADR 0098 authorizes only an accept/reject
review disposition. Its attestation, gesture, route, receipt, or PIN check is
not an active-role attestation, SOAP step-up, SOAP proof, or clinical-write
authority. It cannot be reused across these boundaries.

Fabric resolves named smart capability execution and records provider,
readiness, venue, provenance, and receipt. None of those facts proves a
physician role, a clinician request, an approval, or a SOAP authorization.
Likewise, a SOAP role attestation neither selects a Fabric provider nor proves
any Fabric path delivered.

## Required implementation order

This ADR is a normative contract only. The split is sequential and each packet
has one owner boundary:

| Packet | Boundary and required result |
| --- | --- |
| `H2a-S` | Host-owned attestation/store contract: inactive-by-default record, exact fixed role/operation, version, expiry and revocation; no enrollment UI or session grant. |
| `H2a-E` | Local enrollment only: host-resolved actor, explicit controlled setup and fresh authentication step-up; no Headless session or write. |
| `H2a-A` | In-memory active-role session grant: host validation, session/principal binding, expiry, revocation and restart denial; no proposal, approval proof, patient, fields or commit. |
| `H2b` | Parent/child Headless session and lease binding from ADR 0103; one child proposal budget and terminal lifecycle. |
| `H3` | Memory-only `inspect -> preview -> proposal` lifecycle and wipe, still without approval or write. |
| `H4` | Host-fixed SOAP field set and client seal/reopen, still without approval or write. |

`H2a-S -> H2a-E -> H2a-A -> H2b -> H3 -> H4` is mandatory. Approval,
single-use proof, command binding, transactional commit, adapters, portability
and independent verification remain the later H5-H10 sequence in ADR 0103.
No packet may combine this active-role work with Fabric runtime or reuse the
ADR 0098 review path as its implementation.

### H2a-E activation constants for 0.8.5

The controlled local setup accepts only the fresh raw PIN. The host resolves
the current Web administrator, supplies its canonical username to credential
verification, and requires the exact session and account projection to remain
unchanged before and after that verification. Actor, username, role, session,
issuer, expiry and attestation references are never caller fields.

One successful setup activates an inactive attestation, or renews an active but
expired one, for exactly eight hours. The store mints a fresh opaque
`hsari_<32 lowercase hex>` issuer reference for every activation generation.
An unexpired active attestation denies duplicate activation; a revoked
attestation is terminal. Revocation preserves the last activation facts and
increments the revocation generation.

Activation and its PHI-safe `auth.soap_active_role.enrolled` audit event commit
in the same local SQLite transaction. The event is scoped to the opaque actor
and attestation references and contains no PIN, SOAP, direct identity, grant,
proposal or authority payload. H2a-E returns only a non-authorizing lifecycle
projection; it creates no active-role session grant, route, UI or clinical
write.

## Consequences and stop rule

The first 0.8.5 write remains a proposed, clinician-confirmed SOAP append
until every ADR 0103 gate is independently verified. This ADR alone adds no
runtime, schema, migration, route, UI, credential, provider, cloud/egress,
clinical data, test runtime, commit, or write delivery.

Stop and split if work requires a second operation, role hierarchy, delegation,
shared/broad grant, caller-supplied authority, patient or field authorization
in the role attestation, reusable step-up, retained PIN/proof, ADR 0098 reuse,
Fabric authority union, direct SQLite access, or any non-local/real-data
boundary.

This is an engineering authorization contract. It does not attest professional
licensure, legal identity, signature validity, regulatory compliance, or
clinical appropriateness.

Claim ceiling: **an accepted, docs-only contract for a host-owned,
physician-only, operation-scoped active-role prerequisite; no active-role
runtime, approval, clinical write, integration, release readiness, or release
is delivered.**
