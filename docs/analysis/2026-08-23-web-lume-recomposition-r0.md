---
summary: "Decision basis R0 for recomposing the MediFlow 0.8.5 Web Lume candidate from frozen redesign, Web inventory, and keyboard heads."
read_when:
  - "Recomposing the August 2026 Web Lume branches without treating mergeability as semantic integration."
  - "Deciding the order between WUL-562 Web inventory work and WUL-560 keyboard ownership."
---

# Web Lume recomposition R0

Date: 2026-08-23

Status: `ACCEPTED ROUTING / D0 CLOSED`

Issue: WUL-562

## Outcome

R0 records ancestry, patch equivalence, collisions, the accepted D0 product
meaning, and the minimum future recomposition order. R0 does not change runtime
code or CSS.

The R0 routing decision is accepted and D0 is closed. A monolithic runtime
recomposition remains in `HOLD_RUNTIME_RECOMPOSITION` because Web #209 crosses
structure, design semantics, CSS, icons, tests, and capability documentation.
D1 may proceed as a separate runtime packet with one boundary and fewer than
about 300 gross lines.

This document is a local candidate artifact. It is not integrated,
release-ready, released, or promoted.

## Frozen inputs

| Role | Exact SHA | Meaning |
| --- | --- | --- |
| Lume baseline candidate | `e1414c5c0d20601caf726e01eb495fb2745b6c40` | `codex/ui-consolidamento-p0`; R0 base and accepted product source |
| Web #209 | `93362ca505149f5d6c51502784395e65126921df` | Web inventory after neutral icons |
| Keyboard #200 | `5fbe5eaa16b6f79eb578644afe0131dd58544238` | Complete keyboard, listbox, and command-center model |
| Main merge-base | `0d55c6d0f29a86c3333efc49bc0159563d9518b9` | Shared ancestor of all three candidates |

Kree8 names remain implementation paths and historical internal naming. They
do not replace Lume as the product design direction established by ADR 0078.

## D0 accepted decision

For MediFlow 0.8.5, the accepted candidate source is
`codex/ui-consolidamento-p0@e1414c5c0d20601caf726e01eb495fb2745b6c40`
and its document **Un fuoco, una risposta**.

The accepted composition is:

- Scheda at `/patients/[id]/modules` is the complete clinical workspace;
- `PatientSynopticSheet` is the single header for Scheda;
- Scheda absorbs and eliminates the parallel Quadro surface implemented by
  `components/kree8/areas/real-patient-area.tsx`;
- the rail group named **Quadro e decisioni** remains. It is navigation inside
  Scheda, not a second header or a parallel clinical surface;
- keyboard #200 remains the owner of the complete keyboard model.

This decision supersedes only the divergent Web #209 meaning that preserves
Quadro as a separate concise lens. Web #209 remains eligible as evidence for
non-contradictory elements that a later packet verifies against the accepted
source. Eligible elements include focused tests, neutral Lume treatments,
icons, and capability documentation. Eligibility is not integration proof.

## Ancestry and commit equivalence

`git merge-base` returns the exact main SHA above for every pair of candidate
heads. Main is an ancestor of all three candidates. No candidate head is an
ancestor of another candidate head.

| Candidate from main | Unique nodes | Non-merge nodes | Merge nodes | Tree delta |
| --- | ---: | ---: | ---: | --- |
| Lume baseline | 9 | 9 | 0 | 25 files, +2002/-81 |
| Web #209 | 14 | 8 | 6 | 42 files, +346/-237 |
| Keyboard #200 | 5 | 5 | 0 | 11 files, +626/-17 |

`git cherry` reports every non-merge node as `+` in both directions for each
candidate pair. No non-merge patch is patch-id-equivalent across the three
histories. The six Web merge nodes have no `git cherry` patch-id result and
must not be treated as portable feature patches.

The symmetric node counts are:

- Lume baseline versus Web #209: `9 / 14`;
- Lume baseline versus keyboard #200: `9 / 5`;
- Web #209 versus keyboard #200: `14 / 5`.

These results rule out a fast-forward, a claim of duplicated commits, and a
blind replay of the Web merge commits.

## Collision matrix

`git merge-tree --write-tree` was used without changing the worktree.

| Pair | Git conflicts | Auto-merged overlap that still needs semantic review |
| --- | --- | --- |
| Lume baseline + Web #209 | `components/kree8/areas/real-patient-area.tsx`; the redesign document; `docs/markdown-index.md` | patient inbox CSS, cockpit shell CSS, workspace shell CSS |
| Lume baseline + keyboard #200 | `components/kree8/areas/incarico-area.tsx` | cockpit shell CSS and cockpit composition |
| Web #209 + keyboard #200 | none | cockpit shell CSS |

The baseline/Web conflict is contractual, not only textual:

- the baseline redesign document says that Scheda absorbs and eliminates the
  parallel Quadro;
- Web #209 says that Quadro remains a concise state-and-next-action lens and
  Scheda remains the full workspace. D0 supersedes this meaning for 0.8.5.

Git auto-merge does not implement the accepted decision and does not resolve
focus targets, touch targets, responsive grouping, surface depth, or keyboard
behavior.

## Mockup boundary

The Lume mockups are design evidence, not runtime acceptance targets.

- A prior narrow audit found clipping at 390 px. A future runtime packet must
  verify 390 px against the executable surface instead of copying the mockup.
- `mini-sessione.html` displays an `approve` action. The exact Mini candidate
  at `1e35733c0218eae67a1d6e158085aab7340bc26b` defines `apply` as always
  denied. The mockup therefore cannot grant apply authority or define Mini
  runtime behavior.

R0 does not modify Mini, Apple, Fabric, F6, mappings, or apply policy.

## Minimum depth-first recomposition order

Each numbered packet must stay independently reviewable and below about 300
gross lines. Stop when a packet reaches a second boundary.

1. **D0 closed: Scheda absorbs Quadro.** Use the frozen Lume candidate and the
   decision above. Preserve **Quadro e decisioni** only as a rail group.
2. **D1: implement the accepted Scheda composition.** Use a separate runtime
   packet below about 300 gross lines. Limit ownership to removal or absorption
   of the parallel `real-patient-area` surface and its focused tests. Do not
   include CSS, icons, capability documentation, or keyboard work. Do not
   cherry-pick the Web merge commits.
3. **D2: recompose neutral Lume surfaces.** Review Carta neutrality, surface
   depth, responsive layout, and neutral icons as a separate packet. Do not
   accept the auto-merged CSS as proof of semantic compatibility.
4. **D3: reconcile Web capability documentation.** Update the inventory only
   after D1-D2 behavior exists and the exact Mini contract is reread. Runtime
   evidence must precede documentation claims.
5. **D4: apply keyboard #200 as the keyboard owner.** Preserve its complete
   listbox and virtual-index model, `Home`, `End`, `PageUp`, `PageDown`,
   `Enter`, command center, `Cmd/Ctrl+K`, `?`, focus trap, and focus restore.
   Resolve `incarico-area.tsx` manually; do not retain the baseline partial
   keyboard model over #200.
6. **D5: verify the combined candidate.** Run focused unit/E2E checks, lint,
   typecheck, build, and repository guards. Then perform rendered QA at 1440
   px and 390 px, including console, DOM, focus, keyboard, clipping, and the
   changed interaction path.

This order places Web structure before the complete keyboard owner. It avoids
building keyboard behavior on a view structure that D1 may still change and
prevents later Web replay from overwriting #200.

## Promotion states and stop rules

| State | R0 result |
| --- | --- |
| Candidate | Yes: accepted local routing; D0 closed |
| Integrated | No |
| Release-ready | No |
| Released | No |

Keep `HOLD_RUNTIME_RECOMPOSITION` for a monolithic merge. Stop an individual
packet if ownership is ambiguous, it contradicts the accepted Scheda meaning,
it crosses a second boundary, its diff exceeds about 300 gross lines, an
apply/authority question appears, or any PHI, PII, credential, or authenticated
session material appears.

## Reproduction commands

```bash
git merge-base <left> <right>
git merge-base --is-ancestor <left> <right>
git rev-list --left-right --count <left>...<right>
git cherry <left> <right>
git merge-tree --write-tree <left> <right>
git diff --shortstat 0d55c6d0f29a86c3333efc49bc0159563d9518b9..<head>
```

Run these commands against the exact frozen SHAs. A later branch name or green
check is not evidence that the candidate heads or semantics remain unchanged.
