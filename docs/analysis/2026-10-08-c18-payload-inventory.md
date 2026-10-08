---
summary: "C18 proof for the actual packed auth-owner module, with exact payload inventory, notice gaps and wider artifact qualification still open."
read_when:
  - "Reviewing the first scoped WUL-733 payload-ledger implementation and evidence."
---

# C18 scoped payload inventory — 8 October 2026

This record covers the tracked packed auth-owner module and an owned synthetic
installation of that module. It does not complete
[WUL-733](https://linear.app/wulfgardr/issue/WUL-733), constitute an application
SBOM or qualify an installable release. The
[payload-ledger guide](../runtime-payload-ledger.md) defines the tool and the
separate standalone/Headless checks.

## Inputs and observed artifact

| Input | Exact identity |
| --- | --- |
| Selected source revision for corrected receipt | `c233d8135c112edf8881df1118d8f8644aa76efd` |
| Selected source tree | `fbddf11df78dcb46eefa9d7fcd7ba5df59ebabd1` |
| Root manifest SHA256 | `812bfe8363e21f899d9b319a3f7a18bd8de712023979de1b723a560cbe45e61f` |
| Lockfile SHA256 | `7b589bc317aa501fc5d121d121061af8a305e8e2cc661b3b162b9a7c6f0aa2d3` |
| Observed package | `@mediflow/web-auth-lifecycle-owner@0.8.9-local.3f2e6f2a` |
| Archive | `packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.9-local.3f2e6f2a.tgz` |
| Archive bytes / SHA256 | 38,961 / `8d620c923846a43e25489bfd9116be23a943d495a75a9692d6fcf411681734dc` |
| Tracked provenance SHA256 | `98b1ff5672c79437c9e752d56aa54e84c081dc39bb43849aec9820e465bae52f` |
| Corrected producer script SHA256 | `55f7a0d74d7eec8c984f6d0dcc8b98746ffa7d9a05a1e9a49f656f7819a02bd8` |
| Inventory host | Node 24.21.0, ABI 137, macOS arm64 |
| Installed payload | 13 physical files, 244,831 bytes, every file mode `0644` |
| Sorted roster content SHA256 | `f4ff526b6cce1e5ed85fcb0831a794dbcc5e20d9419a79bd73138b7f2f1f55be` |

The initial inventory used source `db7232d297bb81f6c2ad1d971dfcdedabf2fd88e`,
tree `d28cc1fb8f18ec1e6077bd9c2af0a28800d93988`. The corrected receipt selects
`c233d813`, whose runtime inputs are unchanged, and records `worktreeDirty=true`
while the reviewed tooling repairs were being prepared. All 19 consumed source
identity files match regular tracked HEAD blobs. The manifest, lock, Node contract,
archive/provenance and owner source inputs matched the selected tree.
The archive's SRI matched both the root lock and the provenance. Private JSON
receipts retain all lock records and relative payload rows; no private host
paths or runtime logs are published here.

The install used `npm install --offline --ignore-scripts --no-audit --no-fund`
in a fresh synthetic project with an empty owned cache and one explicit local
tarball dependency. It added one package. The corrected ledger returned
`SOURCE_PROVENANCE_INSTALLED_BYTES_MATCH`; subsequent comparison returned
`TRUSTED_ROSTER_BYTES_MATCH`. This proves the scoped archive installation and
content identity, not application `npm ci` or a clean-machine install.

The corrected receipt has SHA256
`442db40d787d27f5a5b16492bf58d54fcf9cc2b0177ee1afb66da7929f8e728c`.
It separates archive digest/SRI matches, provenance membership/source hashes,
and installed observed membership/bytes. It reports POSIX installed modes
matching the declared roster on this Mac. The generator's independent
`archiveRosterVerification` is `NOT_CHECKED`; it has not parsed tar members.

## Actual payload members

The package has no declared dependencies or optional dependencies. These are
its complete observed members, not the root repository's dependency list.

| Relative path | Bytes | SHA256 |
| --- | ---: | --- |
| `index.d.ts` | 15,346 | `5c773e27aaba97bac89227ef6fc5f147a9eff8c48c04ab5183fe8339baaabdfd` |
| `index.js` | 116 | `1abc52ee8abe9fd25b28046f1f00ecc2f09d699ba220c61e6222730c22ca44c5` |
| `internal/control-record.cjs` | 19,478 | `3d443096679799ffde96e744060de5be59c9a86ddb383bdd975de75c913b9aa4` |
| `internal/native-session.cjs` | 116,386 | `43ab1842cab49cf37619621313237beb3728925470bc683b465d5b3c6633dc26` |
| `internal/owner.cjs` | 38,612 | `fa76bdc81e46c5fc3f3de2d54ad7f2d64041e63974f9d7a3354b122d8b668a10` |
| `internal/session-activation.cjs` | 6,143 | `5ed4c9543f8bc15903c0915a8565b997d697d004e9ccfaaa54a3da6236a2aa96` |
| `internal/session-cell.cjs` | 23,897 | `4cd0c2e9f8b40b346d43a93de561e20e85c5662fc8a2f9a0a170403fc80c2e31` |
| `internal/session-resolver.cjs` | 2,965 | `75409d670b8411dbadcc95e4bd9bfebeff47d2f687bde0d638809bb9114b5fa0` |
| `internal/session-resource.cjs` | 14,687 | `b71c56ebb7f76db3e59e411e90daac8eb41f175eb20300b4ed6dc7ce9437012c` |
| `internal/session-retirement.cjs` | 5,664 | `8848c92cb88635c6c09baf685839e7c6f1aca40d667ea6580e84e275349f1516` |
| `internal/support/successor-fence.cjs` | 1,172 | `7e36178331d5f899d81d877603acb0100eef1436d1873287ad4b27ccc227e7ff` |
| `internal/support/value.cjs` | 47 | `9f0968a0290c6184c898f06de2c408540d4eda1ecd0e3e80ae013bb37a782be1` |
| `package.json` | 318 | `ce1c7e461a95b8b939ff02317673a2c652b9ffcc5d2a7525a77134d1a99bb3d2` |

## Source dependency and asset boundary

The npm v3 lock has 751 package keys including its root: 750 dependency
records. The inventory classifies 33 direct runtime, 306 transitive runtime,
13 direct development and 398 transitive development records using manifest
membership and npm's development flag. Optional platform records remain
visible. These counts describe source inputs and do not prove the contents of
a Next.js standalone build.

| Item | Evidence at this pin | Presence in this package / remaining obligation |
| --- | --- | --- |
| PM2 7.0.4 | Direct runtime lock record declares `AGPL-3.0` | Excluded from this dependency-free package; inclusion and required notices in the complete runtime remain to be reviewed. |
| Sharp libvips platform packages 1.3.3 | Ten optional lock records declare `LGPL-3.0-or-later` | Excluded here; the actual platform-specific native artifact and its redistribution obligations remain to be established. |
| Inter and IBM Plex Mono fonts | [CREDITS](../../CREDITS.md) identifies upstream packages and source OFL notice files | No fonts or notices occur in this package. Their final standalone locations, digests and notice delivery remain separate evidence. |
| Models, tokenizers, terminology/catalogue data | Optional/external source contracts do not establish downloaded bytes or rights | No such assets occur here. No provider/model download or execution was performed. |
| Node / native SQLite / Headless launcher | Separate application runtime requirements | No Node binary, native library or application launcher occurs in this package. Application and external-runtime qualification remain open. |

The owner package itself has no `license` field and no packed license/notice
file. The root `LICENSE` is source evidence and is recorded by digest, but does
not replace the missing packed notice. Redistribution review and notice
delivery remain required; this record makes no finding of license violation.

## Dated advisory scope

On 8 October 2026, the primary
[Next.js advisory GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)
was checked. Published on 22 September, it identifies critical
CVE-2026-94545, an affected range `>=16.2.0 <16.3.6`, and fixed version
`16.3.6`. The root lock's `next@16.3.4` matches that range. Its trigger is the
Node `next/og` ImageResponse path rendering attacker-controlled SVG values.

A targeted coordinator search of `app`, `lib`, `components`, `scripts` and
`next.config.*` found no `next/og`, `@vercel/og`, `ImageResponse` or
`remotePatterns` matches at this pin. That search does not prove complete
payload non-reachability. The scoped owner package excludes Next; the
application profile remains unqualified pending the separate advisory
disposition. No dependency was changed here. All other advisories and a
comprehensive dependency scan remain `NOT_CHECKED`; neither the inventory nor
this narrow check establishes zero vulnerabilities.

## Verification and remaining artifact gates

The initial candidate's 15-test suite missed two independent counterexamples:
ignored identity inputs inherited an unrelated clean Git revision, and changed
installed modes still produced a positive initial verdict. That candidate
required changes. Its commit and original challenge receipts remain recoverable.
The repair adds tracked-blob anchoring for every consumed source input, POSIX
mode comparisons and explicit archive-membership gaps. It does not treat inert
synthetic archive bytes as independently verified archive contents.

The corrected synthetic suite passed 19 tests on Node 24.21.0 macOS, with one
supplementary set-ID-mode fixture skipped. This filesystem returned mode
`0644` after a requested `4644`, so that counterexample could not be constructed;
the skip is not proof of set-ID-mode rejection. The executable-mode rejection
oracle ran and passed.
It includes the independent rejection oracles, ignored source/provenance cases
and an explicit set-ID-mode qualification gap. It also covers repeatable
inventory, source/provenance drift, missing/extra/tampered/wrong-package members,
symlink refusal, trusted-roster comparison, mode changes, wrong declared Node
major/version/ABI/platform/architecture, missing standalone identity members,
stale build revision and CLI overwrite refusal. POSIX-mode cases are explicitly
not Windows permission qualification. Synthetic standalone fixtures do not
qualify a real standalone artifact. Independent review of the repaired exact
candidate remains a separate gate.

The next application proof must identify and inventory an owned current
standalone/Headless deliverable, carry C10's reviewed owner closure into it, and
pass the existing runtime/Headless verification. The tracked provenance's old
installation/toolchain fields describe that historical packing run; they do
not invalidate newer C10 proof or substitute for a current artifact receipt.

C10's current-main evidence is the passing
[Web Core run 37627516014, attempt 1](https://github.com/Wulfgardr/mediflow/actions/runs/37627516014)
at `db7232d297bb81f6c2ad1d971dfcdedabf2fd88e`, using Ubuntu, Node 24.21.0 x64
and ABI 137. Its retained log has SHA256
`a7919c59f3700ac0513bd171430885a420c7c278f353e9acadcefa444d37b20c`.
The owner boundary's 10 tests and the adapter/installed-owner checks passed;
the latter include manifest identity, archive roster, two offline source packs
equal byte for byte, provenance, a physical pinned-artifact copy and an offline
scratch install. This is scoped CI owner-closure proof; it does not identify a
new complete application artifact or qualify its platform deployment.

Equal functional qualification on Mac, Windows and Linux remains required
for the intended current profiles. No Windows/Linux volume or native app was
mutated or tested here. Clean application installation, launch, update and
rollback, required integrated CI, independent review, redistribution admission,
and size/startup deltas remain open. This inventory changes no runtime
requirements or security checks and removes no dependency without C13 consumer
proof. A source release archive, the canonical Mac app with external Node and
the installability-v0 app with embedded Node remain distinct deliverables.
