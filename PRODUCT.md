---
summary: "Product contract for MediFlow: audience, tasks, platform roles, boundaries, anti-goals, and success criteria."
read_when:
  - "Changing product behavior, release claims, platform roles, or the public narrative."
  - "Separating current MediFlow capabilities from the 0.8.5 source candidate and later direction."
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
- The 0.8.5 local source candidate routes Patient Insight, Smart Import,
  Document Synthesis, and Treatment Reasoning through four host-owned Fabric
  paths. Every path stops at a reviewable proposal and exposes receipt,
  provenance, and currentness.
- When configured, Ollama serves general generative tasks and ATHENA on MLX
  serves only Treatment Reasoning. Their host-owned lifecycles are separate.
  Cloud providers are disabled.
- OpenAI and Anthropic appear only in an informational provider register. They
  are not runtime options. A consumer login, product subscription, or host
  subscription is not API access or authorization for inference.
- The caller cannot choose a provider, model, endpoint, venue, prompt,
  fallback, or apply policy. Receipt and provenance do not authorize a write.
- AnyDoc is the only automatic local attachment extraction path. The `ocr`
  capability is unavailable in the current runtime. Images and scans fail
  closed to manual review, and authenticated legacy OCR routes return `410`.
  DeepSeek-OCR 2 and Apple Vision are `RELEASE_SCOPE_EXCLUDED` from 0.8.5.
- Headless is a foundation, not a general external agent runtime. It does not
  access the database directly. The only accepted write exception is the SOAP
  append with policy `clinician_confirmed_single_use.v1`, through a host-owned
  Application Service.
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

## 0.8.5 source candidate and later direction

The **Intelligence Fabric** has a bounded implementation in the 0.8.5 local
source candidate for four proposal-only capabilities. This implementation is
not evidence of a release, deployment, general agent interface, cloud support,
or clinical apply.

The complete provider model is not implemented and is
`RELEASE_SCOPE_EXCLUDED`. A post-0.8.5 contract must keep provider type,
instance, authentication, model, capabilities, groups, bindings, and function
allowlists separate. It must also distinguish local models, API keys, official
provider OAuth, and host subscriptions. OpenAI and Anthropic configuration and
execution are excluded; the candidate includes only their informational
register entries.

A post-0.8.5 DeepSeek-OCR 2 target may process only pages marked `needsOcr`.
It requires an adapter, end-to-end evidence, a synthetic Italian benchmark,
declared thresholds, per-page provenance, hashes, quality signals, fail-closed
recomposition, and evidence that data stays inside the local process before
promotion.

Two integration modes remain distinct. MediFlow can govern a provider inside
its own Fabric. Separately, an intelligent host may eventually invoke governed
MediFlow Application Services through an MCP, App, or Headless adapter. The
second mode is future work and does not claim an MCP server, installer,
onboarding flow, or general external agent runtime. It is
`RELEASE_SCOPE_EXCLUDED` from 0.8.5.

Broader routing to deterministic logic, on-device models, a paired home-base,
or an approved cloud provider remains future work. Any future routing must be
explicit, policy-bound, observable, and fail-closed. There is no silent cloud
fallback. Each clinical output must preserve patient identity boundaries,
provenance, uncertainty, execution venue, and physician review.

Windows and Linux applications, broader offline continuity, voice completeness,
the intelligent scaffold, and conversational workflows remain post-0.8 or
exploratory until separate decisions and evidence promote them.
