# PR383 font A/B activation

This is a single-attempt synthetic diagnostic, always nonqualifying. It activates the unchanged source packet reviewed at patch SHA-256 `fd1af838cfb05e3e0664ebee1233884079289fee35ec4b79e92a8d9691fca1fa`; `source-pins.json` freezes all 39 files, including corpus `3457bdd13d2b1bba72a6340e9d9385b9cb5e1d1053b33d44357ce296b9b8c560`. The source guards run before importing the harness and again before sealing/claiming the observation. Git attributes preserve the pinned bytes on Windows.

The workflow exists only on the isolated diagnostic branch. It accepts **only a creation push to `diagnostic/pr383-windows-font-ab-20261001`, attempt 1**. Its job condition and producer independently check event/ref/attempt and event SHA against the diagnostic checkout. There is no default-branch change, dispatch trigger, retry or branch-update observation. The [push payload's `created` field](https://docs.github.com/en/webhooks/webhook-events-and-payloads#push) identifies ref creation; [github.run_attempt](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context) increments on reruns. Publishing requires the separately reviewed exact local commit and a new remote branch; deleting/recreating that branch is outside this one-attempt procedure.

The candidate is exactly `eb701348f3a01ccf5051fe3d8a51de1082ef751d`, tree `1deddabbdf1dd2282ea8f63a05c89fd69e6483bc`, with ordered parents `a238b47fccce09db9a0a7b3977355266962216ca df90702a69c8877557d666be81d039d6f88cde7a`. Parent verification reads the raw `git cat-file -p HEAD` headers and works with depth-one checkout, including when `%P` is empty. Exact source lifecycle, Node contract and clean checkout are checked. No compiled `.next` may already exist at preparation or compilation claim.

## One serial sequence

1. Verify creation context, candidate, unchanged lifecycle, reviewed source pins and fresh output.
2. Install the exact lockfile with the existing browser-download skips; use a fresh empty synthetic data directory under `RUNNER_TEMP`.
3. Claim one fresh compile, run the original `npm run prebuild`, then **`npm --ignore-scripts run build`**. This invokes the unchanged `next build` script without the ordinary postbuild renderer check. No PDF worker, font enumeration or warmup render is run first.
4. Run the original `write-standalone-manifest` command and retain phase exit statuses.
5. Write the physical `.next/font-ab-build-identity.json` only after successful install/prebuild/compile/manifest and a matching compile claim. It binds the verified candidate, matching root/standalone BUILD_ID, selected runtime-manifest digest and worker hash. The unchanged reviewed Windows preflight checks the selected candidate output, native/dependency pins and seal before a success receipt is emitted.
6. Recheck source/candidate/seal, claim the observation once and call the reviewed CLI directly in `observe-windows` mode, with the candidate's fixed `.next/standalone` worker and a new output directory.
7. Collect/upload available setup, raw, partial `.pending` and failure receipts on all outcomes. End with exit 1 even if collection/upload succeeds.

There are **at most 8 materialization calls and 16 fresh sequential render calls**, zero retries. The unchanged harness keeps **30,000 ms timeout, 256 MiB V8 old-space (not RSS), 4,194,304-byte maxBuffer**, original permissions and A/B environment. B adds only `DISABLE_SYSTEM_FONTS_LOAD=1` before imports. Page/font/oracle budgets and glyph-failure policy remain frozen. The inherited cold-render workflow is neither changed nor invoked; its separate branch trigger does not run on this branch.

## Finite time and retention

The job cap is **55 minutes**; explicit step caps sum to **49 minutes**, leaving six minutes for runner overhead. Installation has eight minutes, original prebuild/compile twelve, manifest/seal two, observation fourteen, collection one and upload three. The 24 child timeout allowances alone total twelve minutes; the observation cap provides two minutes for protocol/evidence overhead. A phase timeout/failure prevents later compilation/sealing/observation and does not cause a retry.

The collector retains only the closed synthetic receipt/raw filename set, with **128 files**, **256 MiB total uncompressed**, **256 KiB per JSON receipt**, and a conservative **8 MiB per returned raw stream** to allow transport-buffer overshoot without truncation. These are artifact bounds, not increased child output limits. Normal/partial buffers are copied byte for byte. Unknown files, symlinks or bounds violations fail collection, make evidence loss explicit and never qualify a result. No candidate source, data database, credentials or unrestricted logs are uploaded. Artifact retention is three days, compression disabled; a new unique run/attempt artifact name is used without overwrite.

Collection/upload use `always()` and have their own finite budgets. Platform termination or upload failure can still prevent complete retention; the earlier local journal remains the available record and no successful qualification is inferred. Cache coldness, statistical font determinism and Windows timeout causality are not established. The seal is consistency evidence tied to this reviewed fresh-compilation sequence, not a cryptographic compiler attestation.

Local validation uses synthetic compiled-output/phase fixtures and the existing physical pinned worker as read-only bytes. It does not compile or render. Windows/native preflight, PowerShell transport and GitHub execution remain to be observed only after separate activation review and authorization.
