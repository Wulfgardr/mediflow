# WUL-271/WUL-272/WUL-274 · Kree8 → MediFlow visual translation

> Status: live root entry on `/` as of `WUL-272`; first real-patient
> cockpit slice in progress under `WUL-273`.
> PIN continuity: lock screen aligned to the live Kree8 grammar as of `WUL-274`.
> Review alias: `/mockups/kree8`.
> Scope: full-surface visual reset promoted to the local web entrypoint as the
> new app interface direction; real clinical data wiring is being migrated in
> small verified slices under WUL-273.

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
| Data | `/` live reads real local patients and checkups only after PIN/session unlock; `/mockups/kree8` remains synthetic review data. No remote assets and no real patient screenshots in repo. |
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
splits the old "Paziente" area into a first-class list (`Pazienti in carico`)
and a composite detail (`Scheda paziente`), and renames the rest to mirror the
clinician-facing MediFlow nomenclature.

| Area pill | Demonstrates |
| --- | --- |
| Oggi | Stats strip, today's agenda (filterable by `urgent`/`AI`/`manual`), AI queue cards, and the `WUL-275` Zimbra/iCloud bridge preview for clinical/FBF candidates awaiting review. |
| Pazienti in carico | Patient list with scope chips (Ambulatorio locale / Rete locale / Tutti), active/archive toggle, selectable patient rows, sticky `Anteprima caso` preview with `Apri scheda` / `Cartella completa` / `Prepara SISS`. |
| Scheda paziente | Identity dock with action shelf (`Nuova voce diario`, `Allega documento`, `Pianifica visita`, `Smart Import`, primary `Prepara SISS`), identity chips with `MediFlow Insight` / `Contesto SISS pronto` / `Protesica-RL` badges, AI ⇄ Source synthesis, Timeline del caso, Terapia attiva, Evidenze recenti, Smart Import preview with write/note/blocked counters, Prossimi passaggi. |
| Documenti | Document review panel: counters for `campi aggiornabili` / `note da riconciliare` / `ignorati` / `non integrabile ora`, evidence snippets per field, blocked-capability cards for SISS writes, tri-state decisions (`Applica` / `Come nota` / `Ignora`), primary action renamed to `Applica al form` (no more "timbra"). |
| Cataloghi | Freshness as a white panel with a thin semantic left rail (fresh/ok/stale/broken), catalog list with status pills, and import actions routed to settings. |
| Trasmissioni SISS | Launcher matrix (Modulo Prescrittivo, Protesica-RL, FSE · OpeFseIE, Anagrafe · Gaia, Menu SISS) + 4-step selector (Identità → Consenso → Portale ufficiale → Esito) where the outcome capsule explicitly says the result is **annotato manualmente** — no certified return artifact. Non-integrable-now cards for `Prescrittivo nativo`, `FSE embedded`, `SGDT / PAI`, `Certificati di malattia`. |
| Sistema | Account & PIN, AI local controls (`AI Patient Insight`, `Smart Import documento`, `Comparatore cloud`) + lane chips, Modalità di rete (`locale di default` + optional `Mac principale`), Backup & cataloghi (launchd notturno, retention keep-last-N), Diagnostica locale (Audit append-only, Riduci animazioni — **no external telemetry**), Aggiornamento & stato (`v0.6.4` + AI locale). |

## Interactivity demonstrated

Most non-migrated panels still use local React state. Since `WUL-273`, the live
root makes session-protected reads to `/api/patients` and `/api/checkups` after
unlock, maps them into the Kree8 patient inbox, stat strip, local agenda and
first Scheda paziente view, and shows an explicit error/empty state
instead of falling back to review patients. Since `WUL-275`, the live root also
reads `/api/clinical-agenda/candidates` for Zimbra/iCloud event-cache candidates.
The review alias stays synthetic and does not fetch external or clinical data.

`/patients/[id]/modules` is now treated as **Cartella completa**: a Kree8
fullscreen deep-work route for the same patient. The root navigates, the Scheda
decides and summarizes, the Cartella completa executes longer clinical work
such as therapies, observations, protesica, scales, document upload and diary
review. Its inner tools still reuse the existing real components until each
one receives its own Kree8-native internal pass.

`/patients/[id]/entries/new` now follows the same fullscreen workspace rule for
the primary write action from Scheda and Cartella completa. It keeps the
existing rich-text editor, attachment upload, OCR/document synthesis and save
flow, but the route-level language is Kree8-native: `Diario clinico`, `Nuova
voce clinica`, `Luogo`, `Tipo di voce`, `Resoconto`, `Allegati`.

`/patients/[id]/scales/[scaleId]` now follows the same workspace rule for
patient-bound assessments launched from Cartella completa. The runner keeps the
existing scoring/save behavior and presents context, questions and diary save as
one clinical flow.

- Area selection on the rail (`navItem`/`navSelected`), with a horizontal
  scroll-snap rail at narrow widths so the surface remains usable on tablets.
- PIN unlock is visually part of the same app line: scoped lock surface,
  numeric PIN input, ink unlock action, error chip with a small commit pulse,
  and local/zero-knowledge captions. Auth semantics stay in `SecurityProvider`.
- Toolbar filter chips (single-select; rewires the Oggi agenda).
- Zimbra/iCloud bridge preview distinguishes external clinical/FBF candidates
  from confirmed agenda rows and keeps them in manual review state.
- AI gradient action present in the toolbar (decorative; matches Kree8 cue).
- Patient inbox scope (`Ambulatorio locale` / `Rete locale` / `Tutti`) and
  list mode (`Attivi` / `Archivio`) drive the visible rows; in live mode the
  rows come from `/api/patients`; selecting a row animates an `Anteprima caso`
  preview; `Apri scheda` jumps to the detail area while `Cartella completa`
  opens the dense patient tools route.
- Scheda paziente toggles `Sintesi AI` ⇄ `Fonti grezze`.
- Document field decision tri-state per row with evidence snippet, kind label
  (`campo aggiornabile` / `solo nota` / `non integrabile ora`), live counters,
  commit-pulse on the resulting status pill, and a gated primary action
  (`Applica al form`) once all reviewable rows are processed.
- Cataloghi list and status cards expose the local package state and route
  import work back to settings.
- Trasmissioni SISS selector walks through 4 steps with step-specific bodies;
  the row sweep animation replays on step change.
- Governance toggles flip an `aria-pressed` state across account/PIN, local AI,
  network mode, backup, audit and update sections.

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
- Does not migrate documents, therapies, diary, observations or write workflows
  into the Kree8 grammar yet; those actions continue through the existing real
  patient routes.
- Does not change PIN/auth/session semantics or mount cockpit data behind the
  lock screen.
- Does not introduce a new UI style key in `UIStyleProvider`.
- Does not add a Graphite/Kree8 selector.
- Does not load patient data before PIN/session unlock.
- Does not claim a certified SISS return artifact: the Esito step records
  the portal outcome as **manually annotated** and labels it `non
  certificato`.

## Review checklist

- [ ] Navigate to `/`, exercise all seven area pills.
- [ ] Load `/` while locked and confirm only the Kree8 PIN surface is mounted;
      no cockpit copy or protected fetch storm appears before unlock.
- [ ] Unlock with a valid PIN and confirm the lock surface unmounts directly
      into the Kree8 cockpit.
- [ ] On `/` live, confirm `/api/patients` and `/api/checkups` return local data
      after unlock, the sidebar patient count is real, the Oggi stat strip
      does not show synthetic `312` / `24` / `7 casi` counts, and the page text
      does not contain review-only patient tokens such as `AB-2026-014`.
- [ ] Navigate to `/mockups/kree8` and confirm it remains only a review alias.
- [ ] On `Pazienti in carico`, switch scope between `Ambulatorio locale`,
      `Rete locale` and `Tutti`; toggle `Attivi` ⇄ `Archivio`; select a
      patient and confirm the `Anteprima caso` preview animates in; click
      `Apri scheda` and confirm it jumps to `Scheda paziente`.
- [ ] On `Scheda paziente`, exercise the identity dock action shelf and the
      Sintesi AI ⇄ Fonti grezze segmented toggle; scan the Evidenze recenti panel,
      Smart Import preview counters and Prossimi passaggi cards.
- [ ] On `Documenti`, mark a mix of decisions and confirm the
      counters update, the commit-pulse animation replays on each status
      pill, and the primary `Applica al form` only enables when all
      reviewable rows are processed. Confirm the blocked SISS row cannot be
      applied.
- [ ] On `Cataloghi`, confirm the local package state, import actions and
      semantic status pills stay legible. Confirm the panel stays white — no
      full gradient backgrounds.
- [ ] On `Trasmissioni SISS`, walk through the 4 steps, confirm the row
      sweep animation, the launcher matrix renders the 5 webapps and the
      non-integrable-now cards show 4 blocked capabilities. Confirm the
      Esito step explicitly labels the outcome as manually annotated.
- [ ] On `Sistema`, confirm every section (Account & PIN, AI locale,
      Modalità di rete, Backup & cataloghi, Diagnostica locale,
      Aggiornamento & stato) reads like a real MediFlow setting block and
      that no copy implies external telemetry.
- [ ] Toggle the OS-level reduced motion preference and confirm the surface
      stops animating (area entrance, Case Lens slide, sweep, commit-pulse,
      press states all disabled).
- [ ] Resize the viewport below 1024px and confirm the rail becomes a
      horizontal scroll-snap strip.
- [ ] Confirm `/` has no visible mockup copy and no escape button.
- [ ] Confirm the review alias shows "Esci dalla review" in the bottom-right.
