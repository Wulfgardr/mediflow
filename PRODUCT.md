---
summary: "Product contract for MediFlow: audience, tasks, platform roles, boundaries, anti-goals, and success criteria."
read_when:
  - "Changing product behavior, release claims, platform roles, or the public narrative."
  - "Separating current MediFlow capabilities from later product direction."
---

# MediFlow Product

## Banner

**Serve the right information at the right time.**<br>
**Porta l'informazione giusta nel momento giusto.**

## Purpose

MediFlow is an open-source, free-to-use clinical workspace built from the
operational difficulties that physicians meet in daily work.

It does not promise seamless medicine. It reduces avoidable friction while it
preserves clinical complexity, source provenance, privacy, and professional
responsibility.

MediFlow is information-first, question-first, and convenience-first. It is not
AI-first. The product remains useful when all AI providers are disabled.

## Audience and setting

The primary audience is physicians in Italian territorial care. Their work is
dense, interrupted, and time-sensitive. They must retrieve facts, record new
information, and prepare a safe next step without losing the clinical source or
the identity boundary of the patient.

## Core tasks

1. **Retrieve.** Find the patient and the information that answers the current
   question.
2. **Record.** Add structured facts, notes, documents, therapies, observations,
   and pending work with clear provenance.
3. **Prepare.** Assemble evidence for the next physician decision without
   prescribing, diagnosing autonomously, or inventing an action.

Search, touch, keyboard, structured controls, and voice can be different entry
points into the same capability. They do not need identical interfaces. They
must preserve clinical meaning, evidence, authority, and available actions.

## Platform roles in the 0.8 line

| Surface | Role |
| --- | --- |
| iPhone | Rapid retrieval and capture for short, one-handed, and time-limited use. |
| iPad | Field workspace for broader context, structured capture, document review, and richer editing. |
| macOS | Authoritative home-base for local data, administration, security, reconciliation, backups, and complex workflows. |
| localhost | Full portable workspace on the home-base with native web structure and the shared capability model. |

iOS and iPadOS use one universal app. They adapt layout, multitasking, keyboard,
pointer, and density to the device. macOS uses native desktop conventions.
Localhost uses native web semantics.

Parity means equivalent capability and clinical meaning within each declared
platform role. It does not mean pixel identity.

## Product voice

The interface is calm, precise, and direct.

- Labels name the clinical fact or action.
- Empty, loading, offline, stale, conflict, denied, and error states state what
  happened and what the user can do.
- Facts, hypotheses, warnings, missing information, and pending work remain
  distinct.
- Clinical and safety text is not rewritten for visual effect.
- Public claims follow evidence, not intent.

## Current boundaries

- Local-first is the default. No cloud, telemetry, or data egress is active by
  default.
- The Mac is the authoritative home-base. Mobile clients use explicit pairing
  and the versioned local API.
- Deterministic workflows, records, terminology, and reference data remain
  first-class without AI.
- The 0.8.5 source tree routes Patient Insight, Smart Import,
  Document Synthesis, and Treatment Reasoning through four host-owned Fabric
  paths. Every path stops at a reviewable proposal and exposes receipt,
  provenance, and currentness.
- When configured, Ollama serves general generative tasks and ATHENA on MLX
  serves only Treatment Reasoning. Their host-owned lifecycles are separate.
  Cloud providers are disabled by default.
- OpenAI and Anthropic have provider v2 adapters and a review-only Document
  Synthesis probe. Activation requires an explicit host opt-in, a secret
  reference, and egress and retention policy. Tests use fake transports; the
  source tree contains no credentials or live-network readiness evidence. A
  consumer or host subscription is not API authorization for inference.
- The caller cannot choose a provider, model, endpoint, venue, prompt,
  fallback, or apply policy. Receipt and provenance do not authorize a write.
- AnyDoc is the first automatic local attachment extraction path. On macOS,
  Apple Vision processes only supported PDF pages marked `needsOcr`; the
  result remains source-bound, review-only, and fail-closed. Direct images and
  unsupported inputs require manual review. The separate Fabric `ocr`
  capability remains unavailable, and authenticated legacy OCR routes return
  `410`. DeepSeek-OCR 2/CUDA is
  `OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`.
- The local 0.8.5 Headless path runs Web and MCP as separate children of a
  trusted Node Supervisor. MCP reaches only named Application Services through
  inherited AIP RPC and never accesses SQLite directly. Mini shares the typed
  catalog and CLI foundation but has no production Supervisor callsite and
  fails closed without a parent AIP channel. The MCP path includes bounded
  reads, a follow-up proposal, the read-only semantic planner, and the F10
  checkup preview. F10 commits only in the trusted Web UI after a
  fresh role, step-up, gesture, currentness, CAS, audit, and receipt check.
  The clinician-confirmed SOAP append remains a separate operation with its own
  policy, proof, and receipt; authority never transfers between the two writes.
  Installer, onboarding, and compatibility with external MCP hosts remain
  outside the current claim.
- On macOS 26 or later, visit recording uses Apple on-device capture and
  transcription with explicit consent, bounded in-memory audio, and transcript
  review. It has no automatic clinical writer; real-microphone and clinical
  validation remain outside the 0.8.5 claim.
- SISS and FSE use documented assisted handoffs. MediFlow does not claim native
  regional synchronization or writeback.
- Mobile offline behavior is partial and read-only where documented.
- Windows and Linux validate shared-core portability. They are not complete
  MediFlow applications.
- The parity matrix is the source of truth for capability status.

## Anti-goals

MediFlow does not:

- replace physician judgment or professional responsibility;
- prescribe, autonomously diagnose, triage, or interpret imaging conclusively;
- hide uncertainty, provenance, conflicts, or missing information;
- require an AI provider to perform ordinary clinical work;
- silently send clinical data to a cloud provider;
- silently apply model output to structured clinical records;
- imitate one platform pixel for pixel on every other platform;
- claim certification, clinical validation, regulatory status, or accessibility
  conformance without specific evidence.

## Success criteria

MediFlow succeeds when:

- a physician can reach the relevant information with fewer avoidable steps;
- the source and freshness of the information remain visible;
- controls expose their purpose and trigger the documented service and state;
- platform adaptations preserve the same clinical meaning;
- the interface remains usable at supported sizes and accessibility settings;
- failure and degraded states are honest and actionable;
- synthetic tests can verify the contract without real patient data.

## 0.8.5 delivery and later direction

The **Intelligence Fabric** has a bounded implementation in the 0.8.5 source
tree for four proposal-only capabilities. Source presence alone is not evidence
of deployment, a general agent interface, cloud readiness, or clinical apply.

The provider v2 model separates provider type, instance, authentication,
model, capabilities, groups, bindings, and function allowlists. It also keeps
local models, API keys, official provider OAuth, and host subscriptions
distinct. OpenAI and Anthropic adapters remain `default OFF`; the source tree
does not prove live credentials, account policy, retention, or cloud readiness.

A future DeepSeek-OCR 2 adapter may process only pages marked `needsOcr`. It
requires end-to-end evidence, a synthetic Italian benchmark, declared
thresholds, per-page provenance, hashes, quality signals, fail-closed
recomposition, and evidence that data stays inside the local process before
promotion. Its absence does not block 0.8.5.

Two integration modes remain distinct. MediFlow can govern a provider inside
its own Fabric. Separately, the local 0.8.5 runtime lets MCP invoke named,
governed MediFlow Application Services through the trusted Supervisor. Mini is
a fail-closed CLI foundation without that production binding. This
does not claim an installer, onboarding flow, compatibility with external MCP
hosts, or general agent authority.

Broader routing to deterministic logic, on-device models, a paired home-base,
or an approved cloud provider remains future work. Any future routing must be
explicit, policy-bound, observable, and fail-closed. There is no silent cloud
fallback. Each clinical output must preserve patient identity boundaries,
provenance, uncertainty, execution venue, and physician review.

Windows and Linux applications, broader offline continuity, external-host
onboarding, real-microphone validation, and conversational workflows remain
later or exploratory work until separate decisions and evidence promote them.
