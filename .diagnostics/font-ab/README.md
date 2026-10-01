# External font A/B diagnostic

This directory is a reviewable synthetic experiment. It does not change the renderer, checker, runtime configuration, CI workflow, or production routing. Every CLI invocation exits **1**, including successful observations. The original checker would reject the probe stderr, which is retained byte for byte. No observation here is a release gate.

The runtime under observation is the frozen worker SHA-256 `31fce8c00c25edd20f7f4442edc9fe00d659599e436cc5166b4be4950f7f3a67`, checker Git blob `b942b38bec7c5a8a3d1f620ad550a1e0f35a5410`, physical `pdfjs-dist@4.10.38` and `@napi-rs/canvas@0.1.100`, and exact Node **24.21.0**. Windows observation additionally requires candidate `eb701348f3a01ccf5051fe3d8a51de1082ef751d`, tree `1deddabbdf1dd2282ea8f63a05c89fd69e6483bc`, ordered parents `a238b47fccce09db9a0a7b3977355266962216ca df90702a69c8877557d666be81d039d6f88cde7a`, and the pinned Windows native binary. The diagnostic is external to that candidate checkout. Local validation checks the same worker/checker/dependency versions; it does not claim to reproduce the entire Windows candidate build.

## Windows compiled-output binding

`observe-windows` requires the resolved worker to be the physical file **`CANDIDATE/.next/standalone/scripts/anydoc-pdf-page-worker.mjs`**. A separately supplied matching bundle, a symlinked output directory, or another dist-directory override is rejected before any child. The repository and standalone `.next/BUILD_ID` files must agree. The original `mediflow-runtime-contract.json` must match Node version/ABI, platform, architecture and the selected physical SQLite package. Existing exact candidate SHA/tree/ordered-parent and worker/native/dependency pins remain mandatory.

The harness also requires a physical **`CANDIDATE/.next/font-ab-build-identity.json`**, sealed by a separately reviewed activation after the exact candidate's fresh compilation and original manifest step. It contains exactly these fields:

```json
{
  "schemaVersion": 1,
  "candidateHead": "eb701348f3a01ccf5051fe3d8a51de1082ef751d",
  "candidateTree": "1deddabbdf1dd2282ea8f63a05c89fd69e6483bc",
  "candidateParents": ["a238b47fccce09db9a0a7b3977355266962216ca", "df90702a69c8877557d666be81d039d6f88cde7a"],
  "standaloneRelativePath": ".next/standalone",
  "buildId": "<actual matching compiler BUILD_ID>",
  "runtimeManifestSHA256": "<SHA-256 of the selected original runtime manifest bytes>",
  "workerSHA256": "31fce8c00c25edd20f7f4442edc9fe00d659599e436cc5166b4be4950f7f3a67"
}
```

The harness verifies the seal against the selected output and never creates it or accepts its path through a CLI argument. Missing, stale, foreign or symlinked seals fail closed. This is a checked compilation receipt, not cryptographic attestation of a compiler invocation: the pending activation review must establish its producer, fresh-compilation ordering and unchanged lifecycle. No producer/workflow or remote activation is added here. Local validation retains its disclosed weaker build claim. The earlier Mac observation belongs to the prior patch and has not been repeated for this revision.

## Fixed experiment

There are eight single-page PDFs, eight one-time materialization children, and exactly sixteen planned fresh render children. Order is F0 BA, F1 AB, F2 BA, F3 AB, F4 BA, F5 AB, F6 BA, F7 AB. The two arms of a fixture receive byte-identical materialized input and preload. Each render has a 30,000 ms timeout, 256 MiB V8 old-space limit, 4,194,304-byte output limit, package-root read permission and render-only addons permission. The parent environment is never copied into a child. There are no retries, warming calls, concurrent renders, or automatic dispatches. Existing output directories cannot be reused. A stdout/stderr or JSON-receipt persistence failure halts the run immediately. Both raw sinks are attempted independently; the original child transport/error is retained separately from the sink error. Best-effort failure receipts identify any evidence loss, set `state=persistence-failed`, and leave remaining slots reserved. A failed sink cannot guarantee saved bytes. Completed render buffers, child transport and the actual-call budget are persisted before post-render observations or worker rereads. A post-check failure throws `POST_RENDER_VERIFICATION_FAILED`, retains the original child result/error separately, marks `verification-failed` and stops future calls; reporting is best effort with the earlier transport journal retained. A failed materialization accounts for two failed, unrendered slots; it cannot be reported as sixteen actual renders. Identity or evidence-persistence drift stops further calls.

A receives exactly `NODE_ENV=production` and `NAPI_RS_ENFORCE_VERSION_CHECK=1`. B receives those entries plus **`DISABLE_SYSTEM_FONTS_LOAD=1`** from process creation, before the preload and worker imports. The supported truthy check is in the [exact canvas 0.1.100 wrapper](https://github.com/Brooooooklyn/canvas/blob/db337893b9b53483050ca7b24c6d306e4da06741/index.js#L140). An absent value is the A control; the string `0` would also disable loading and is not used. The flag skips the wrapper's explicit system/user font loading. Native initialization and later native font lookup can still occur. Font-family enumeration is not performed before rendering.

Budgets are frozen in `corpus.json`: three TTF assets totaling **145,144 bytes** within a 262,144-byte cap, at most two embedded font programs per PDF, source/materialized PDF at most 262,144 bytes, and at most 512 × 256 output pixels. There is no font registration, external CMap, network download, browser installation, or runtime dependency addition.

| Fixture | Frozen case | Oracle |
| --- | --- | --- |
| F0 | Exact original 72 × 36 point blank `q Q` smoke | Exact decoded blank pixels, the sole empty-text exception |
| F1 | Raster-only multilingual cells | Independent MuPDF render; baked visible labels |
| F2 | Latin, accents, ligature, euro and numbers; real FontFile2 | MuPDF render of the same PDF |
| F3 | Missing Base14 programs; Helvetica, Times-Roman, Courier regular faces | MuPDF's independent rendering of the same PDF; observational |
| F4 | Embedded Greek and Cyrillic | MuPDF render of the same PDF |
| F5 | F4 without FontFile2 | Desired visible glyphs from embedded F4; missing-program support not assumed |
| F6 | Embedded Chinese plus Arabic contextual glyphs | MuPDF render of the same PDF |
| F7 | F6 without either FontFile2 | Desired visible glyphs from embedded F6; missing-program support not assumed |

The bounded F3 case covers regular faces only; bold and italic are not included. F6 Arabic is shaped once with HarfBuzz and placed as separate contextual-glyph cells with explicit CID-to-GID mapping and ToUnicode. It does not establish continuous-word layout, bidirectional composition, broad CJK coverage, or external-CMap support. F1 contains rasterized nominal glyph cells. These limitations are deliberate and do not expand the font/page budgets.

## Independent visible-text oracle

The PDFs and PNG references were generated offline before any candidate render. MuPDF **1.28.4**, independent of PDF.js/canvas, rendered eight reference pages at 144 DPI. HarfBuzz **14.5.0** provided font glyph IDs/contextual shaping, and Pillow **12.3.0** baked F1. Frozen per-glyph ROIs, nonempty binary masks, ink counts, bounding boxes and decoded RGBA digests are in `oracles/`. Candidate glyph masks are compared against these references, not against the other arm. F5/F7 explicitly use their embedded counterparts as the desired visible text.

Thresholds were fixed before observation: luminance below 128, one-pixel dilation, precision/recall at least 0.96, area ratio 0.8–1.25, bounding-box tolerance two pixels and at least eight ink pixels per reference/candidate glyph. PNG decoding validates CRCs, dimensions, encoding, complete framing, decoded-size bounds and trailing bytes. Blank-vs-blank, swapped, shifted and clipped glyphs cannot certify text cases. Transport/PNG success and decoded A/B equality do not establish visible-text success. No tolerance was tuned after observing output.

Font provenance, source commits, source/subset hashes and OFL license hashes are frozen in `corpus.json`. Original Liberation Sans is unchanged. CJK and Arabic derivatives are subsets with internal names `MediflowSyntheticCJK` and `MediflowSyntheticArabic`; copyright and OFL notices are retained in `licenses/`. Only frozen assets are needed at runtime. The corpus generator and independent extraction receipt are in the accompanying external review packet; regenerating the corpus is not part of a run.

## Local guard verification

Use the existing supported Node binary and physical worker. The tests inject synthetic child results; they do not launch candidate renders.

```sh
FONT_AB_TEST_WORKER=/absolute/existing/standalone/scripts/anydoc-pdf-page-worker.mjs \
  /absolute/node24.21.0 --test .diagnostics/font-ab/harness.test.mjs
```

After authorization for one observation, the command below consumes the fixed run budget. `NEW_OUTPUT` must not exist. The recorded local preparation already consumed its single sixteen-render observation; it must not be repeated merely to improve results.

```sh
/absolute/node24.21.0 .diagnostics/font-ab/run-ab.mjs \
  local-validation /absolute/repository /absolute/existing/standalone/scripts/anydoc-pdf-page-worker.mjs NEW_OUTPUT
```

`observe-windows` is reserved for a separately authorized experiment on the exact candidate checkout/native artifact. This patch contains no workflow or remote execution instructions. Local timings describe fresh processes on one machine, with uncontrolled OS caches and no statistical or Windows-causality claim.
