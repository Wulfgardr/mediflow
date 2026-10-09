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
| Selected source revision for reviewed receipt | `d07839ee44937806277bef4f14a7aa5695d1d3ff` |
| Selected source tree | `545186fbddfea49d1d54efcfba5a38b671d0670f` |
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
tree `d28cc1fb8f18ec1e6077bd9c2af0a28800d93988`. The reviewed receipt selects
`d07839e`, whose runtime inputs are unchanged, and records `worktreeDirty=false`.
All 19 consumed source
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

The reviewed receipt has SHA256
`5d7a8aa3f862aeea3fa54355930cd2eecf8488c9c40556694a71c513c9973813`.
It separates archive digest/SRI matches, provenance membership/source hashes,
and installed observed membership/bytes. It reports POSIX installed modes
matching the declared roster on this Mac. The generator's independent
`archiveRosterVerification` is `NOT_CHECKED`; it has not parsed tar members.
The earlier repair receipt at `c233d813` had a dirty tooling worktree and SHA256
`442db40d787d27f5a5b16492bf58d54fcf9cc2b0177ee1afb66da7929f8e728c`;
it is retained as historical evidence, separately from the clean reviewed pin.

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

The primary [SSRF advisory GHSA-cjq9-62q9-8jv4](https://github.com/advisories/GHSA-cjq9-62q9-8jv4),
updated on 7 October, identifies CVE-2026-94483 and the affected 16.x range
`>=16.0.0 <16.3.8`. The same locked `next@16.3.4` matches this range. The
[vendor security release](https://nextjs.org/blog/september-2026-security-release)
describes the remote image-optimization redirect path and lists `16.3.8` as
the patched active-LTS version. [Release 16.3.8](https://github.com/vercel/next.js/releases/tag/v16.3.8)
is the minimum selected candidate for both assigned advisories; `16.3.6` alone
would leave this SSRF range unresolved. This disposition covers those two
advisories, not every item in the vendor release or every locked dependency.

A repeated targeted source search at `d07839e` of `app`, `lib`, `components`,
`scripts` and `next.config.ts` found no `next/og`, `@vercel/og`, `ImageResponse`
or `remotePatterns` matches (`rg` exit 1). The inspected config contains no
remote-image configuration. The two observed production `next/image` import
sites, the ChatGPT settings page and account card, use the static local
`/brand/openai/chatgpt-mark.png` with `unoptimized`. The three inspected files
match their selected commit blobs; the private source-scope receipt has SHA256
`68ba9383713cef2651172daed3c345e6b2bb56c0776e24c12f9547056d81d6ae`.
These observations reduce declared reachability; they do not prove complete
payload non-reachability or an incident-free deployment. The observed owner
payload has no Next dependency. No current complete application payload was
inventoried, so its included Next bytes and runtime configuration remain open.

The proposed dependency change is limited to `next@16.3.8`, matching
`eslint-config-next@16.3.8` and their necessary Next environment, lint-plugin
and platform SWC lock records. A registry CLI probe failed DNS resolution.
One authorized standard npm lock-resolution attempt used only an owned copy
of verified public cache metadata, with `--offline --package-lock-only
--ignore-scripts`. It failed with `ENOTCACHED` for `eslint-config-next`; npm
reported no usable cached response. That attempt used no online fallback.
The observed failure does not establish tarball absence or an access denial.

The metadata receipt preserves public origin, original cache timestamp and
verified body digest for 12 package names. Target `16.3.8` metadata is present
for Next, its lint config and lint plugin; it is absent from the cached
`@next/env` and eight SWC packuments. Metadata SHA256:
`c23f43aa656b4cb8d78dca60e5df78840093a852736227b26019513f70161ad4`.
The failed resolution receipt has SHA256
`ee7a8f3a1e9dd0d95cc3e0957a2b317dee4b5e4f3e55e36963a5deb0723b6034`;
its log has SHA256
`20793e74796bc5131658e7fa293dd13245b13f08475a9df5cec4e52ef503450e`.
Manifest and lock retained the exact before/after hashes listed above.
No dependency delta or package installation occurred during that attempt.

A subsequent authorized public metadata request to the official npm registry
succeeded. Normal npm lock resolution then completed with lifecycle scripts
disabled and distinct owned empty user/global configs. The tracked project
`.npmrc` retained its sole `engine-strict=true` setting. The earlier local
double-loaded-config failure is retained separately; it occurred before npm
resolved registry metadata. The successful resolution receipt has SHA256
`27bc8bbefa481420b2faf3a82d6c17758880857df3754f40e4bb325a2fc9b4f5`.

Separate dependency commit `284efa05b333f529285a2e313fa4637ff1379fb8`, tree
`89fd9c95fa0c8f8eee51882066fe417723d07311`, updates only `package.json` and
`package-lock.json`. Next and its lint config change from `16.3.4` to
`16.3.8`; exactly 12 Next-family lock records change. The 750-record roster,
eight Mac/Windows/Linux SWC targets, Node `>=24 <25` engine, `.nvmrc`, scripts,
licenses and optional/platform constraints are preserved. No unrelated
transitive version is changed, and no dependency is added or removed.

| Updated source input | SHA256 |
| --- | --- |
| Manifest | `99c1435d30a130c05e9fa25c5a517000351309b34005e18cc3c377ab29fe04b7` |
| Lock | `d31ed13e3a115dfbe5ebae3050b812c3ffdf25888e809906dc9dca11aa37a77f` |
| Structured lock delta receipt | `7ccd5d81c24de3d76f254890d0a34b269ecc7f1cb6012689cfb5493774b1d1aa` |
| Official target metadata receipt | `3d85f5bf9f3376a9f59b36841bea6972efc0e60496589857bbd3afae6ac3c62e` |

All 12 target versions, tarball URLs and integrity values match freshly fetched
official npm metadata whose cached body digests were verified. The metadata
receipt preserves original cache times and body hashes. This is metadata and
source-lock evidence; it does not establish registry-signature verification,
an updated application payload or release admission.
The new source version is outside the two assigned affected ranges. Compatible
build, installed-artifact proof and independent review remain distinct gates.
Other advisories and a comprehensive dependency scan remain `NOT_CHECKED`;
neither this inventory nor the narrow disposition establishes zero
vulnerabilities.

Normal `npm ci` was subsequently attempted on Node 24.21.0 / ABI 137 on this
Mac, from absent physical `node_modules` and a fresh owned npm cache. It failed
with exit 1 at the original root postinstall runtime check because the
`better-sqlite3@12.6.2` binding was missing. The preinstall Node check passed.
Physical manifests for Next, its environment package, lint config, lint plugin
and darwin-arm64 SWC were present at `16.3.8`. This is partial installation
evidence; the command did not pass. Manifest and lock retained their updated
hashes before and after the attempt. The ci receipt has SHA256
`b9641c72eed2a1cebb3252cda9f9d3c55832e881c8ca9e35e1dd7ba080210f80`;
its log has SHA256
`7c7024deff0c5384b48ad50f7ab9e65fb629bec90b7be9b8a99f1ffc7f905c46`.

Read-only inspection of the installed npm 12.1.0 docs and Arborist source
shows its default `allowScripts` policy blocks unreviewed dependency install
scripts. The project has no such policy. SQLite's pinned tarball was fetched,
but its `prebuild-install || node-gyp rebuild --release` install script was
not admitted by that default policy. No install policy was changed, no broad
script override or runtime downgrade was used, and npm was not updated. The
missing binding remains an installation gate; a targeted script-admission
decision and fresh runtime proof would be separate work. No build or postbuild
was executed. The canonical postbuild includes OCR/PDF worker checks that were
outside this island's authorization; omitting them cannot establish canonical
build success. A fresh project on an existing host would still not be a
clean-machine or Windows/Linux qualification proof.

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
qualify a real standalone artifact. Independent review approved the repaired
generator and documentation at exact pin `d07839e`; this later receipt/advisory
documentation update requires its own review before publication.
Independent source review also approved the isolated Next manifest/lock delta
at `284efa05`. The combined synthetic payload and Node-contract suites passed
30 of 31 tests with the same one set-ID fixture skip; their log has SHA256
`c2064ee1ff93993be3819089c880c98409a12049b977c271f80b8db32f387928`.
Those synthetic results do not repair or qualify the failed application install.

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
