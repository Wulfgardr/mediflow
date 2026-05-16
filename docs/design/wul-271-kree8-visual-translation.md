# WUL-271/WUL-272/WUL-274 · Kree8 → MediFlow visual translation

> Status: live root entry on `/` as of `WUL-272`.
> PIN continuity: lock screen aligned to the live Kree8 grammar as of `WUL-274`.
> Review alias: `/mockups/kree8`.
> Scope: full-surface visual reset promoted to the local web entrypoint as the
> new app interface direction; real clinical data wiring is tracked by WUL-273.

## Why this doc exists

The supplied [Kree8](https://www.kree8.studio/) references redefine the whole
visual line for MediFlow — "via il vecchio", per the brief on WUL-271. This is
not an incremental Graphite refinement: it is a clean-room translation of
Kree8's grammar onto a real clinical management surface.

The **v2 pass** sharpens the surface from "Kree8 with medical labels" into a
"MediFlow-authored clinical cockpit": the area model now mirrors real MediFlow
sections, the patient-list/inbox is first-class, the Scheda paziente is a
composite, document review is review-first and surfaces blocked SISS writes,
and Governance reads like the real settings page instead of a generic
preferences panel.

This page exists so reviewers can:

- compare each Kree8 device against the chosen MediFlow analogue,
- judge clinical fitness (density, scanability, status semantics),
- track what was promoted to the root entry and what still needs a real-data
  migration before the legacy Graphite surfaces can be fully retired.

The follow-up migration tracker is
[WUL-273](https://linear.app/wulfgardr/issue/WUL-273/kree8-app-wide-migration-real-data-surfaces-and-route-consolidation).

## Live entry contract

| Concern | How it is enforced |
| --- | --- |
| Root entry | `app/page.tsx` renders `Kree8ClinicalCockpit` in `live` mode, so `http://localhost:3000` shows the new line directly after `Start_MediFlow.command`. |
| Runtime security retained | `RootRuntimeShell` treats `/` as a fullscreen live route: `SecurityProvider`, PIN/session, UI/accessibility/style/privacy providers remain active, but sidebar/mobile chrome and legacy main padding are not mounted around the cockpit. |
| PIN gate continuity | `LockScreen` uses a scoped Kree8 lock module and remains the only mounted locked surface; it does not mount the cockpit or protected data providers behind the PIN gate. |
| Review alias | `/mockups/kree8` still renders the same cockpit in `review` mode via the exact mockup allowlist and keeps the escape button for design QA. |
| No persistent UI selector | No Graphite/Kree8 toggle, no preview profile, no persistent visual mode. This follows [ADR 0060](../adr/0060-kree8-cockpit-live-root-entry.md). |
| Visual surface | `.shell` is `position: fixed; inset: 0; z-index: 1000;` so the cockpit owns the viewport. |
| Reduced motion respected | A scoped `@media (prefers-reduced-motion: reduce)` block disables transitions and keyframe animations inside `.shell`. |
| Data | Synthetic only. No PHI, no real patient screenshots, no remote assets. |
| Dependencies | No new npm packages. Existing `lucide-react` is used for iconography. |

## Token translation

Tokens are declared **inside `.shell`** (scoped custom properties); nothing
leaks into `:root` or other surfaces.

| Kree8 cue | MediFlow token | Notes |
| --- | --- | --- |
| Soft cool-gray canvas (~`#eef0f2`) | `--canvas` on `.shell` | Replaces beige Graphite (`#f6f0e7`) without polluting `:root`. |
| True white canvas card | `--surface` | 28px radius, soft shadow + 1px inset border. |
| Raised white nav pill | `.navSelected` | White fill, 13px radius, soft shadow, chevron affordance. |
| Oversized rounded glass toolbar | `.toolbar` | 18px radius, inset highlight, inner search pill + chips. |
| AI gradient capsule | `.aiButton` | Pink → orange → violet, sparkle icon, soft drop shadow. **Only AI entry point uses gradient.** |
| Status pills (yellow/blue/green/coral/muted/violet/ink) | `--pill-*-bg` / `--pill-*-fg` | Tight 4×10 px padding, tabular text. |
| Segmented toggle | `.segmented` + `.segItem`/`.segSelected` | Used for the AI / Source switch on the patient panel. |
| Stepper minus/plus | `.stepper` + `.stepperBtn` | Disabled at the boundary; tabular number. |
| Pricing-row gradient (green) | **dropped in v2** | Replaced by `.freshness` as a white control with a thin semantic left rail (`--rail-green/blue/yellow/coral`) so AIFA stops reading like a celebratory pricing card. |
| Stage / category tabs | `.stageBtn`/`.stageBtnActive`/`.stageBtnDone` | Used for the SISS handoff staging — augmented with a subtle sweep keyframe on transition. |
| PIN lock surface | `kree8-lock-screen.module.css` | Cool-gray canvas, raised white card, MF brand mark, slate focus ring, ink primary button, semantic local/zero-knowledge footer. No global token export. |

### Contrast and type rhythm

- All negative letter-spacing has been removed; titles, stat values and stepper
  digits keep default tracking for clinical reading.
- `#94a3b8` is no longer used for body or readable text — body now reads
  against `--ink-muted` (`#475569`) or `--ink-strong` (`#1e293b`). The
  faint slate (`--ink-faint`) is reserved for tabular dates and tiny
  numeric metadata.
- Type, spacing and shadows borrow the Inter-Regular / SF Pro rhythm shown in
  the Kree8 screenshots, but stay narrower in line-height so clinical tables
  still read dense.

### Motion lab

Refined and accessible motion based on the Codex sprite-sheet review. The
working sprite sheet is kept out of Git at
`tmp/wul-271-kree8-motion-study/kree8-mockup-motion-sprite.png`:

| Motion | CSS surface | Purpose |
| --- | --- | --- |
| Surface entrance | `.areaShell` + `areaEnter` keyframes | Each area fades up 6px on mount so swaps don't snap. |
| Case Lens slide | `.caseLens` + `lensSlide` keyframes | Patient selection preview animates in from the right. |
| Physical press | `:active { transform: scale(0.97) }` on every actionable surface | Tactile feedback on buttons, chips, stage tiles. |
| Decision commit pulse | `.pillCommit` + `commitPulse` keyframes | When a document field decision changes, the resulting status pill replays a small pop via a React `key`. |
| Stage progression sweep | `.stageRowSweep` + `sweep` keyframes | A 720ms gradient brushes across the SISS stage row each time the active stage changes. |
| Hover lift | `transform: translateY(-1px)` on chips/tiles/buttons | Restrained Kree8 hover, no shadow inflation. |

All motion is gated by the scoped `@media (prefers-reduced-motion: reduce)`
block.

## Surface map (root entry, seven areas)

The mockup keeps all major MediFlow surfaces inside the Kree8 frame, so the
review covers the whole clinical journey, not just a hero page. The v2 pass
splits the old "Paziente" area into a first-class inbox (`Pazienti / incarico`)
and a composite detail (`Scheda paziente`), and renames the rest to mirror the
real MediFlow nomenclature.

| Area pill | Demonstrates |
| --- | --- |
| Turno clinico | Stats strip, today's agenda (filterable by `urgent`/`AI`/`manual`), AI queue cards. |
| Pazienti / incarico | Patient inbox with scope chips (Ambulatorio locale / Network paired / Tutti), active/archive toggle, selectable patient rows, sticky Case Lens preview with `Apri scheda` / `Allega documento` / `Prepara handoff SISS`. |
| Scheda paziente | Identity dock with action shelf (`Nuova voce diario`, `Allega documento`, `Pianifica visita`, `Smart Import`, primary `Prepara handoff SISS`), identity chips with `MediFlow Insight` / `Contesto SISS pronto` / `Protesica-RL` badges, AI ⇄ Source synthesis, Timeline del caso, Terapia attiva, Evidence Stack, Smart Import preview with write/note/blocked counters, Lavoro pianificato. |
| Revisione documenti | Review-first document panel: counters for `write strutturate` / `note da riconciliare` / `ignorati` / `non integrabile ora`, evidence snippets per field, blocked-capability cards for SISS auto-write, tri-state decisions (`Applica` / `Come nota` / `Ignora`), primary action renamed to `Applica al form` (no more "timbra"). |
| Cataloghi locali | Freshness as a white panel with a thin semantic left rail (fresh/ok/stale/broken), manifest stepper (1–24), catalog list with status pills. |
| Handoff regionale | Launcher matrix (Modulo Prescrittivo, Protesica-RL, FSE · OpeFseIE, Anagrafe · Gaia, Menu SISS) + 4-stage segmented selector (Identità → Consenso → Handoff → Esito) where the outcome capsule explicitly says the result is **annotato manualmente** — no certified return artifact. Non-integrable-now cards for `Prescrittivo nativo`, `FSE embedded`, `SGDT / PAI`, `Certificati di malattia`. |
| Governance locale | Account & PIN, AI runtime kill-switches (`AI Patient Insight`, `Smart Import documento`, `Cloud comparator shadow`) + lane chips, Modalità di rete (`local-only by default` + optional `Network home-base`), Backup & cataloghi (launchd notturno, retention keep-last-N), Diagnostica locale (Audit append-only, Riduci animazioni — **no external telemetry**), Aggiornamento & stato (`v0.6.4` + AI parliament). |

## Interactivity demonstrated

All state is purely local React state — no global store, no network calls.
This remains deliberate in the first live-entry slice: the visual line is now
directly visible on `/`, while real patient/data wiring is a separate migration.

- Area selection on the rail (`navItem`/`navSelected`), with a horizontal
  scroll-snap rail at narrow widths so the surface remains usable on tablets.
- PIN unlock is visually part of the same app line: scoped lock surface,
  numeric PIN input, ink unlock action, error chip with a small commit pulse,
  and local/zero-knowledge captions. Auth semantics stay in `SecurityProvider`.
- Toolbar filter chips (single-select; rewires the Turno agenda).
- AI gradient action present in the toolbar (decorative; matches Kree8 cue).
- Patient inbox scope (`Ambulatorio locale` / `Network paired` / `Tutti`) and
  list mode (`Attivi` / `Archivio`) drive the visible rows; selecting a row
  animates a Case Lens preview; `Apri scheda` jumps to the detail area.
- Scheda paziente toggles `Sintesi AI` ⇄ `Fonti grezze`.
- Document field decision tri-state per row with evidence snippet, kind label
  (`write strutturata` / `note-only` / `non integrabile ora`), live counters,
  commit-pulse on the resulting status pill, and a gated primary action
  (`Applica al form`) once all reviewable rows are processed.
- Cataloghi manifest stepper drives the numeric snapshot and switches the
  freshness rail colour.
- Handoff stage selector walks through 4 stages with stage-specific bodies;
  the row sweep animation replays on stage change.
- Governance toggles flip an `aria-pressed` state across account/PIN, AI
  runtime, network mode, backup, audit and update sections.

## Clinical readability guardrails

- Bright neutral canvas, never beige. Old Graphite warm tones are absent.
- Status colour is reserved for state semantics, not decoration.
- Gradients only appear in: the AI button. The freshness panel and AIFA card
  no longer use celebratory gradients — semantic colour is delivered through
  a thin coloured left rail on a white surface.
- No decorative orbs. The `FlowFieldBackground` still renders behind, but the
  fixed overlay covers it.
- Dense rows on agenda / catalog / patient tables; 11-13px type with 4-12px
  gaps.
- All readable text uses tokens at or above `--ink-muted` contrast; the very
  light slate is reserved for tabular dates and tiny metadata only.

## What this live-entry slice explicitly does **not** do

- Does not migrate all real clinical routes into the Kree8 grammar.
- Does not change PIN/auth/session semantics or mount cockpit data behind the
  lock screen.
- Does not introduce a new UI style key in `UIStyleProvider`.
- Does not add a Graphite/Kree8 selector.
- Does not load remote assets or real patient data.
- Does not claim a certified SISS return artifact: the Esito stage records
  the portal outcome as **manually annotated** and labels it `non
  certificato`.

## Review checklist

- [ ] Navigate to `/`, exercise all seven area pills.
- [ ] Load `/` while locked and confirm only the Kree8 PIN surface is mounted;
      no cockpit copy or protected fetch storm appears before unlock.
- [ ] Unlock with a valid PIN and confirm the lock surface unmounts directly
      into the Kree8 cockpit.
- [ ] Navigate to `/mockups/kree8` and confirm it remains only a review alias.
- [ ] On `Pazienti / incarico`, switch scope between `Ambulatorio locale`,
      `Network paired` and `Tutti`; toggle `Attivi` ⇄ `Archivio`; select a
      patient and confirm the Case Lens preview animates in; click
      `Apri scheda` and confirm it jumps to `Scheda paziente`.
- [ ] On `Scheda paziente`, exercise the identity dock action shelf and the
      Sintesi AI ⇄ Fonti grezze segmented toggle; scan the Evidence Stack,
      Smart Import preview counters and Lavoro pianificato cards.
- [ ] On `Revisione documenti`, mark a mix of decisions and confirm the
      counters update, the commit-pulse animation replays on each status
      pill, and the primary `Applica al form` only enables when all
      reviewable rows are processed. Confirm the blocked SISS row cannot be
      applied.
- [ ] On `Cataloghi locali`, step the manifest down to `1` to see the broken
      rail colour and disabled minus button; step to `24` to see the stale
      variant. Confirm the panel stays white — no full gradient backgrounds.
- [ ] On `Handoff regionale`, walk through the 4 stages, confirm the row
      sweep animation, the launcher matrix renders the 5 webapps and the
      non-integrable-now cards show 4 blocked capabilities. Confirm the
      Esito step explicitly labels the outcome as manually annotated.
- [ ] On `Governance locale`, confirm every section (Account & PIN, AI
      runtime, Modalità di rete, Backup & cataloghi, Diagnostica locale,
      Aggiornamento & stato) reads like a real MediFlow setting block and
      that no copy implies external telemetry.
- [ ] Toggle the OS-level reduced motion preference and confirm the surface
      stops animating (area entrance, Case Lens slide, sweep, commit-pulse,
      press states all disabled).
- [ ] Resize the viewport below 1024px and confirm the rail becomes a
      horizontal scroll-snap strip.
- [ ] Confirm `/` has no visible mockup copy and no escape button.
- [ ] Confirm the review alias shows "Esci dalla review" in the bottom-right.
