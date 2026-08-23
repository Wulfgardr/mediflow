---
summary: "Decision basis R0 for recomposing the MediFlow 0.8.5 Web Lume candidate from frozen redesign, Web inventory, and keyboard heads."
read_when:
  - "Recomposing the August 2026 Web Lume branches without treating mergeability as semantic integration."
  - "Deciding the order between WUL-562 Web inventory work and WUL-560 keyboard ownership."
---

# Web Lume recomposition R0

Date: 2026-08-23

Status: `CANDIDATE LOCAL / ROUTING ONLY`

Issue: WUL-562

## Outcome

R0 records ancestry, patch equivalence, collisions, and the minimum future
recomposition order. R0 does not change runtime code or CSS.

The combined runtime candidate remains `HOLD_RUNTIME_RECOMPOSITION`. Web #209
crosses structure, design semantics, CSS, icons, tests, and capability
documentation. The frozen Lume baseline and Web #209 also disagree on whether
Quadro is absorbed into Scheda or remains a distinct concise lens.

This document is a local candidate artifact. It is not integrated,
release-ready, released, or promoted.

## Frozen inputs

| Role | Exact SHA | Meaning |
| --- | --- | --- |
| Lume baseline candidate | `e1414c5c0d20601caf726e01eb495fb2745b6c40` | R0 base and owner branch start |
| Web #209 | `93362ca505149f5d6c51502784395e65126921df` | Web inventory after neutral icons |
| Keyboard #200 | `5fbe5eaa16b6f79eb578644afe0131dd58544238` | Complete keyboard, listbox, and command-center model |
| Main merge-base | `0d55c6d0f29a86c3333efc49bc0159563d9518b9` | Shared ancestor of all three candidates |

Kree8 names remain implementation paths and historical internal naming. They
do not replace Lume as the product design direction established by ADR 0078.

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
  Scheda remains the full workspace.

No runtime recomposition can choose between these meanings without a current
product owner decision. Git auto-merge does not resolve focus targets, touch
targets, responsive grouping, surface depth, or keyboard behavior.

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

1. **D0: decide Quadro versus Scheda.** Record one product meaning for the
   frozen Lume candidate. Until then, keep runtime recomposition in `HOLD`.
2. **D1: recompose Web #209 structure.** After D0, manually reproduce only the
   accepted Quadro/Scheda structure and its focused allowlist/mobile tests.
   Do not cherry-pick the Web merge commits.
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
| Candidate | Yes: local routing artifact only |
| Integrated | No |
| Release-ready | No |
| Released | No |

Keep `HOLD_RUNTIME_RECOMPOSITION` if ownership is ambiguous, D0 remains open,
a packet crosses a second boundary, a diff exceeds about 300 gross lines, an
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
