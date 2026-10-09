---
summary: "Read-only inventory and trusted-roster comparison for a physical runtime payload, with explicit provenance and qualification gaps."
read_when:
  - "Recording what an actual local package or standalone directory contains."
  - "Comparing a payload with a separately trusted inventory without executing it."
---

# Runtime payload ledger

`scripts/generate-runtime-payload-ledger.mjs` records one selected physical
payload. It uses Node built-ins and Git reads, executes no payload code, and
does not install, download or admit a runtime. Its JSON format is
`mediflow.runtime-payload-ledger.v1`, a scoped inventory rather than a claim of
complete SPDX/CycloneDX coverage or release qualification.

The ledger separates the payload's files and package manifests from the root
npm lock inputs. Every observed file has a relative path, size, mode and SHA256.
The sorted file roster has a content digest; it includes no timestamps. Producer
script digest, Node version, source commit/tree, dirty-worktree status and exact
manifest/lock digests identify the inputs. Each consumed source identity file
must be a regular tracked blob at the selected Git root's HEAD and match that
blob's content. Ignored or untracked inputs cannot inherit a clean Git identity.
File equality is reproducible given
the same files and modes; compressed archives, build timestamps and signatures
have separate identities and are not claimed to be byte deterministic.

For observed package manifests, name/version comparisons identify corresponding
lock records, declared license metadata and observed notice files. These are
metadata comparisons; a registry integrity field alone does not attest the
installed files. The lock classifies direct/transitive runtime and development
inputs and preserves optional flags. Absence of a package manifest from a
standalone directory leaves bundled-code presence unknown: webpack chunks can
contain dependency code. No dependency is removed on the strength of this list.

Recognized native, font, model/tokenizer, reference-data and image extensions
produce asset rows with `REVIEW_REQUIRED` rights. All other files still appear
in the complete roster. Extension classification does not establish the origin
or license of embedded or renamed assets. Notice-file hashes and SPDX strings
are evidence for a rights review; the project's MIT license does not settle
third-party or model/data redistribution rights.

## Local packed owner package

The `local-package` profile is deliberately limited to the dependency-free
`@mediflow/web-auth-lifecycle-owner` package and its existing provenance schema.
It compares the root manifest reference and lock SRI with the tracked archive,
then verifies source-input hashes, the provenance roster, installed
name/version and every installed member. Missing, extra, altered or nonphysical
members fail. On POSIX hosts it also compares installed permission bits,
including set-ID bits, with the declared packed roster. Windows stat bits do not
qualify POSIX permissions; the ledger reports that gap explicitly.

It does not extract an archive or execute package code. Its machine results
separate archive digest/SRI equality, provenance-roster equality to tracked
source, and observed installed bytes/membership. `archiveRosterVerification`
remains `NOT_CHECKED` because the generator has not read archive members itself.
An independent archive-reader or installation receipt is separate evidence;
matching a referenced archive hash does not establish its contents.

Use Node 24 and an owned synthetic installation directory. To reproduce the
local installation with an empty cache and disabled lifecycle scripts:

```sh
PAYLOAD_SOURCE_DIR="$(pwd -P)"
PAYLOAD_EVIDENCE_DIR="$(mktemp -d)"
PAYLOAD_EVIDENCE_DIR="$(cd "$PAYLOAD_EVIDENCE_DIR" && pwd -P)"
mkdir "$PAYLOAD_EVIDENCE_DIR/install" "$PAYLOAD_EVIDENCE_DIR/cache"
node --input-type=module - "$PAYLOAD_SOURCE_DIR" "$PAYLOAD_EVIDENCE_DIR" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const [source, evidence] = process.argv.slice(2);
const name = '@mediflow/web-auth-lifecycle-owner';
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
const archive = path.join(source, manifest.dependencies[name].slice(5));
fs.writeFileSync(path.join(evidence, 'install/package.json'), JSON.stringify({
  name: 'mediflow-payload-synthetic-install', version: '0.0.0', private: true,
  dependencies: { [name]: `file:${archive}` },
}) + '\n');
NODE
(cd "$PAYLOAD_EVIDENCE_DIR/install" && npm install --offline --ignore-scripts \
  --no-audit --no-fund --cache "$PAYLOAD_EVIDENCE_DIR/cache")
node scripts/generate-runtime-payload-ledger.mjs \
  --source "$PAYLOAD_SOURCE_DIR" \
  --payload "$PAYLOAD_EVIDENCE_DIR/install/node_modules/@mediflow/web-auth-lifecycle-owner" \
  --profile local-package --package @mediflow/web-auth-lifecycle-owner \
  --output "$PAYLOAD_EVIDENCE_DIR/owner-ledger.json"
```

This installs one explicit local archive, compares it with the application lock
reference and demonstrates its installed content. It does not run application
`npm ci`, qualify a clean machine or prove an application's startup. The tool
keeps installation method and those wider gates unqualified. The caller records
the actual install command and outcome separately.

## Standalone and Headless evidence

For an owned physical standalone directory, supply the expected target
independently of the payload's manifest:

```sh
node scripts/generate-runtime-payload-ledger.mjs \
  --source /absolute/source-checkout --payload /absolute/owned-standalone \
  --profile standalone --node-version 24.21.0 --node-abi 137 \
  --platform darwin --arch arm64 --output /absolute/evidence/standalone-ledger.json
```

The example target is not a qualification result. Generation checks the source
Node contract against `mediflow-runtime-contract.json` and the explicit target,
and requires `server.js`, `package.json` and `.next/BUILD_ID`. If present,
`mediflow-build-identity.json` must match the source revision and build ID;
absence remains `NOT_PRESENT`. Matching a declared ABI does not prove that a
native binding loads. Node is external to this selected directory and is not
inventoried as shipped bytes.

The canonical Mac builder uses an external/system Node. The separate
installability-v0 proof copies Node into its app. This tool does not merge those
deliverables or inventory a whole signed app. It rejects symlinks and does not
follow normalized native aliases into `Contents/Frameworks`.

An included `HeadlessRuntime` subtree is hashed with all other selected files.
The established `stage-headless-runtime.mjs` check and
`launch-bundled-headless-supervisor.mjs` remain responsible for the committed
Headless roster, shared Web/native members, exact Node binary identity, loader
closure and pre-execution validation. Their roster can refer to files outside
this selected directory. A payload ledger does not replace that check, native
ABI preflight, clean installation, update/rollback or synthetic launch evidence.

## Compare with a trusted ledger

```sh
node scripts/generate-runtime-payload-ledger.mjs \
  --source /absolute/source-checkout --payload /absolute/selected-payload \
  --verify /absolute/evidence/previously-trusted-ledger.json
node --test scripts/generate-runtime-payload-ledger.test.mjs
```

Comparison rejects changed bytes, observed mode bits, names, missing/extra
members and symlinks before any execution. POSIX permission qualification is
not inferred from Windows stat bits. Establish the ledger's trust through the source
and build review separately: accepting a replacement ledger alongside replaced
files proves nothing about the previous artifact. Generation refuses to
overwrite evidence or place it inside the payload. Store evidence outside the
repository and use only selected source/build artifacts, never clinical data.

Advisory scanning, reachability, redistribution admission and clean-machine
qualification remain explicit gaps. The generator always reports advisories
as `NOT_CHECKED`; dated advisory findings and dispositions belong to the
associated review. The [first scoped inventory](./analysis/2026-10-08-c18-payload-inventory.md)
records one actual package exercise and its limits.
