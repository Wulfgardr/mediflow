<!-- Claude: multi-entity perimeter + coexistence charter (direttiva utente 2026-07-01). Living, parliamentary. -->
# Carta multi-entita: perimetri di progetto + coesistenza + processo parlamentare

Part of the [tri-OS filoni](README.md). This charter governs how MULTIPLE AI entities
work together on the tri-OS universal app (ADR 0071) on one machine, without stepping on
each other, while keeping shared foundational choices coherent. It is itself
parliamentary: proposed by Claude Code, reviewed by Codex, and by Gemini (via Antigravity).

Directive (user, 2026-07-01): separation into worktrees is fine, but foundational choices
must always be SHARED, and strategy discussions must always be PARLIAMENTARY (proposed,
discussed across entities, ratified), never unilateral. Always consult Codex AND Gemini on
folder/perimeter decisions.

## The entities

- **Entity A - Claude Code** (interactive): drives the Apple parity climb + reversed-flow
  authority. Perimeter: worktree `medical-record-app-apple-wt`, branch `feat/apple-universal-fase0`.
- **Entity B - Codex.app** (desktop, `codex app-server` + `codex_chronicle` + Computer Use):
  runs autonomous Linear WUL tasks. Perimeter: per-task worktrees `medical-record-app-wul-*`.
- **Entity C - Gemini** (run by the human inside Antigravity): second opinion / review /
  architecture parliament vote.

## 1. Perimeters (worktree model)

- **One worktree per entity-task.** Each entity works ONLY inside its own worktree. The
  main clone `medical-record-app` (MAIN) is a NEUTRAL/shared base: no entity does sustained
  work there; it is left detached or on `main`.
- **No cross-perimeter git state changes.** An entity NEVER runs `git checkout / switch /
  reset / stash / clean / worktree remove` in a worktree it does not own, and NEVER in MAIN
  during another entity's session. This is the rule whose breach caused two hijacks on
  2026-07-01 (see [[workflow-agents-git-hazard]]).
- **Branch-locked isolation.** Because a branch can be checked out in only one worktree,
  keeping `feat/apple-universal-fase0` checked out in `-apple-wt` makes MAIN physically
  unable to check it out. Prefer this lock for any actively-developed branch.
- **Naming.** Worktrees: `medical-record-app-<scope>` (e.g. `-apple-wt`, `-wul-419-...`).
  Branch = the scope's canonical branch. A second full clone is only warranted if an entity
  cannot be trusted not to rewrite shared refs.

## 2. Shared foundational invariants (the constitution)

Non-negotiable, identical for every entity on every filone. Changing any of these REQUIRES
parliament (section 3):

- ADR 0071 shared spine: `MediFlowCore` is the single on-device authority, unchanged per-OS.
- Zero-knowledge crypto contract: `ENC:base64(iv12):base64(ct+tag)`, ENCRYPTED_FIELDS per
  table, KEK = PBKDF2-HMAC-SHA256(PIN, salt, 100000), master key RAM-only, never crosses a
  boundary. Byte-exact across web/Swift.
- Schema (medical.db) + optimistic concurrency (version-guarded UPDATE, 409 payload) +
  tombstone/soft-delete semantics, unchanged.
- The tri-OS golden-vector CI gate is the kill-switch for the Swift-core direction.
- In-house-first (ADR 0070); no-em-dash in docs AND UI strings; after demotion, Next.js
  archives ciphertext/version/tombstone only (no plaintext clinical validation).
- No PHI/PII in the repo, logs, fixtures, or screenshots (Codex). Next.js after demotion
  does not assign authoritative ids/versions/tombstones or make clinical decisions.

See the full ledger in [README](README.md#shared-invariants-ledger-must-hold-byte-identical-on-all-three).

## 3. Parliamentary process

- **What requires parliament** (A + B + C weigh in before action): any change to the
  constitution (section 2); the core language/architecture (ADR 0071 "punto di non
  ritorno"); the perimeter model itself; the definition of the 100% / filone scope;
  cross-filone sequencing. Recorded as an ADR (`docs/adr/`) or, for smaller calls, a line
  in a shared decisions log.
- **What an entity may do solo** (then report): implementation inside its own perimeter that
  honors the constitution; small parity slices; docs within its filone; verified refactors
  that do not touch shared contracts.
- **How a vote works.** The proposer records the decision FIRST as
  `docs/parliament/YYYY-MM-DD-<slug>.md` with: problem, options, recommendation, affected
  invariants, first thin (reversible) slice, dissent. If architectural/durable, promote to
  an ADR (an ADR outranks a parliament note). Each entity gives a scored opinion with
  reasons (the pattern used for ADR 0071's 4-proposal judge panel).
- **Ratification** = explicit human acceptance PLUS at least two entity views recorded
  (human may waive for urgency). No merge to a shared/base branch until ratified.
  Disagreement is kept as a minority report, not averaged away; when unsure, pick the
  smallest reversible slice. Keep it lightweight so it never stalls in-perimeter work.

## 4. Coexistence mechanics

- **Branch ownership:** each entity owns its branch(es); do not commit onto another
  entity's branch. (On 2026-07-01 three Apple commits accidentally landed on
  `codex/wul-423-...`; recovered by ff-merge onto feat + resetting the codex branch.)
- **Pre-commit guardrail:** every entity verifies `git branch --show-current` immediately
  before each commit and confirms the commit landed on the intended branch. Small,
  frequent checkpoint commits; no long-lived uncommitted work while another entity runs.
- **Shared refs/gc:** no force-updating shared refs, tags, or `git gc --prune` while others
  are active; deleting a branch requires it be no one's checked-out worktree.
- **Push/PR:** push is currently billing-blocked; until unblocked, coexistence is local-ref
  discipline. When restored, one branch = one PR = one filone/task.
- **Filone coherence:** the three filoni (Apple/Linux/Windows) share the spine; a spine
  change proposed by any entity is a parliament item (section 2/3), never a solo edit. No
  platform may fork crypto, validators, versioning, tombstone, or schema semantics.
- **Perimeter-breach recovery (Codex):** stop writes; capture read-only status; notify the
  branch owner; discard NO files unilaterally; resume only after the owner restores/approves
  the state. (This is exactly how the two 2026-07-01 hijacks were handled.)

## 5. The single most important rule

**No entity mutates branch or working-tree state outside its declared owned worktree.**
Everything else depends on that (Claude Code + Codex agree; this is the rule whose breach
caused both 2026-07-01 hijacks).

## Parliament record

- **Claude Code (proposer):** this draft (perimeters, constitution, process, mechanics).
- **Codex (2026-07-01, consulted):** endorsed and sharpened - concrete `docs/parliament/`
  decision notes promoted to ADR when durable; ratification = human + >=2 entity views;
  no-PHI-in-repo invariant; exclusive branch ownership; pre-commit guard refusing commits on
  `main`/unexpected branch; breach-recovery protocol; same "one rule" as section 5.
- **Gemini:** _(pending: human runs the Antigravity charter prompt and pastes the vote back;
  integrate as a third voice + any minority report)_
- **Human ratification:** _(pending)_

Status: PROVISIONAL (2 of 3 entity voices + awaiting human ratification). Already being
FOLLOWED operationally (Claude Code is isolated in `-apple-wt`; pre-commit branch guard
active). Formalize/ratify once Gemini's voice and the human sign-off land.
