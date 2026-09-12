---
summary: "Shared MediFlow design contract and platform adaptations for web, iPhone, iPad, and macOS."
read_when:
  - "Designing or reviewing a user-facing MediFlow surface."
  - "Checking Lume, interaction parity, accessibility, or platform adaptation."
---

# MediFlow Design

## Design intent

MediFlow serves physicians who perform dense clinical work. The interface must
feel calm, precise, trustworthy, and fast to scan.

Information hierarchy outranks decoration. Materials, motion, and intelligence
support the task. They do not become the task.

## Plain language for physicians

Every MediFlow interface must be usable by a physician with no knowledge of
code, infrastructure, artificial intelligence, or interface conventions. This
is a product requirement across web/localhost, macOS, iPhone, and iPad,
including settings, onboarding, field descriptions, buttons, tooltips,
notifications, errors, confirmations, and accessibility labels.

- Every word must help the physician understand the task. Name fields by what
  they contain and actions by what they do; explain the expected input and
  consequences when they are not evident. Do not assume icon literacy.
- Use familiar, precise language and consistent names for the same concept.
  Preserve appropriate clinical terminology without requiring technical literacy.
- Do not expose implementation vocabulary such as host, MCP, payload, receipt,
  or gate as ordinary product labels. Explain necessary technical concepts in
  everyday language. Optional diagnostic details belong in a separate support
  view and must never be required to complete the ordinary task.
- Describe settings by their practical effect. For data sharing, state what is
  sent, to whom, and when in understandable terms; simplicity must not hide
  consent, limits, risks, or the distinction between a proposal and an action
  already performed.
- Errors explain what happened and the next available action. A short label
  must remain meaningful; a tooltip cannot rescue an unintelligible control.

Acceptance requires reading the affected flow on the actual interface,
including relevant secondary states, and answering: can a physician without
technical knowledge understand what this means, what to enter or choose, and
what will happen next, without a developer's explanation? Unexplained jargon
or ambiguous actions fail this criterion even when automated tests pass.
This rule applies to existing and future interfaces; documenting it does not
certify that all current text already complies.

## Shared language

Lume is the active visual language. The web and Apple implementations share:

- clinical terminology and control meaning;
- information hierarchy and typography rhythm;
- semantic color roles;
- spacing and grouping principles;
- border and material hierarchy;
- icon vocabulary;
- loading, empty, offline, stale, conflict, denied, and error semantics;
- stable accessibility identifiers for tested controls.

Shared language does not require identical navigation or density.

## Hierarchy and typography

Lume uses two functional registers:

- **Voce** identifies the current question, patient, task, or action.
- **Registro** carries dense facts, provenance, status, and history.

Headings establish the current context. Labels stay close to the value or
control they describe. Long clinical names and multiple coded facts must wrap
without clipping or hiding the primary action.

## Color, borders, and materials

Semantic color is reserved for clinical state, status, warning, selection, and
focus. Color is not the only carrier of meaning.

Clinical content uses stable, readable surfaces with clear grouping. Native
Apple materials can use current system semantics when they clarify hierarchy or
function. Translucency is limited to chrome and privacy surfaces. It is not
stacked across clinical cards.

Localhost uses a restrained material analogue. It does not copy decorative
glass effects.

### Nested frames

Nested containers must use coordinated corner geometry. Avoid a square or
nearly square enclosing frame around a strongly rounded inner frame when both
frame the same content. For parallel inset outlines, coordinate the inner
radius with the outer radius and inset so the spacing looks uniform.

Every frame must identify a meaningful group. Prefer one enclosing frame with
spacing or subtle dividers over repeated boxes around the same content. This
does not prohibit rounded controls inside a rectangular page; the constraint
concerns redundant enclosing frames and conflicting container geometry.

Review the affected surface at its supported sizes and appearances: nested
corners must look coherent, spacing must remain uniform, and removing redundant
frames must preserve understandable grouping, focus indicators, and behavior.

## Components and states

Every visible control maps to:

`surface → control → identifier → action/service → state mutation → outcome`

The outcome includes success, error, empty, loading, offline, stale, conflict,
and denied states when applicable.

State pills, capability gates, evidence cards, pending-work markers, and the
Lume Filo connector carry defined meaning. Decorative buttons and undocumented
divergent actions are not allowed.

Touch controls target at least 44 points or the platform-equivalent minimum.
Keyboard and pointer targets keep a visible focus state.

## Platform adaptations

### iPhone

- Prioritize rapid retrieval and capture.
- Use compact navigation and one-handed reach where practical.
- Keep the active patient and task clear during short interactions.
- Collapse dense layouts before reducing legibility.

### iPad

- Use the larger canvas for list-detail work and structured clinical context.
- Adapt to compact and regular widths, portrait and landscape, and continuous
  resize.
- Support touch, keyboard, and pointer without changing capability meaning.

### macOS

- Use native windows, sidebars, toolbars, menus, focus, keyboard commands, and
  continuous resize.
- Preserve desktop density without clipping or hiding state.
- Keep the Mac role as authoritative home-base visible in administrative and
  runtime surfaces.

### Localhost

- Use native HTML semantics and responsive web structure.
- Support 320, 390, 768, and 1440 pixel viewports.
- Preserve content and actions at 200% and 400% browser zoom.
- Keep keyboard order, focus visibility, and screen-reader structure explicit.

## Accessibility

Accessibility is a product constraint, not a later polish pass.

- Support Dynamic Type through AX5 where declared.
- Prefer a single readable column when accessibility sizes make split layouts
  unsafe.
- Preserve VoiceOver and screen-reader labels, values, traits, order, and
  actions.
- Keep stable identifiers under the `clinical-workspace-…` convention for
  exercised Apple controls.
- Respect reduced motion, reduced transparency, increased contrast, and system
  appearance.
- Do not claim assistive-technology support without a terminal run on the named
  platform. The current mobile VoiceOver evidence boundary is documented in
  [`docs/known-limitations.md`](./docs/known-limitations.md).

## Motion and privacy

Motion communicates state, hierarchy, or continuity. It stops or simplifies
when reduced motion is enabled.

Privacy shields and discreet display states can obscure sensitive content.
They must not obscure the reason, the recovery action, or the current security
state.

## Intentional differences and exceptions

An intentional platform difference must state:

- the platform role that requires it;
- the shared capability and clinical meaning;
- the reason for the different structure or input;
- the test or review surface;
- the owner and follow-up when the exception is temporary.

Literal color residue, incomplete secondary-state certification, new-patient
gating equivalence, and form-marker cleanup remain post-0.8 work. They do not
authorize an unbounded redesign of the 0.8 candidate.

## Evidence order

For native Apple decisions:

1. current Apple platform guidance and API availability;
2. repository architecture, Lume, and accepted ADRs;
3. runtime evidence on the exact candidate;
4. secondary craft guidance.

For public claims, the parity matrix and the exact run record outrank screenshots
and visual impression.
