---
summary: "Product contract for MediFlow: audience, tasks, platform roles, boundaries, anti-goals, and success criteria."
read_when:
  - "Changing product behavior, release claims, platform roles, or the public narrative."
  - "Separating current MediFlow capabilities from post-0.8 direction."
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

## Platform roles in 0.8

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
- Ollama is the only operational AI provider. AI output is review-first.
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

## Direction after 0.8

The **Intelligence Fabric** is a post-0.8 direction. It describes a capability
layer that can route a task to deterministic logic, an on-device model, a paired
home-base, a local model, or an approved cloud provider.

Any future routing must be explicit, policy-bound, observable, and fail-closed.
There is no silent cloud fallback. Each clinical output must preserve patient
identity boundaries, provenance, uncertainty, execution venue, and physician
review.

Windows and Linux applications, broader offline continuity, voice completeness,
the intelligent scaffold, and conversational workflows remain post-0.8 or
exploratory until separate decisions and evidence promote them.
