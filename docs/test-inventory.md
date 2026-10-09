# Test inventory

The inventory detects changes to test discovery, the unit suite's selection, and
six explicit npm test selections, the Headless and Playwright selectors and five guard
self-tests, each with configured CI calls.
It does not certify that tests ran, that their assertions are sufficient, or that a
release is qualified. Unresolved selections remain visible work; they are not
approved exclusions or deferrals.

Run with the repository's Node 24 version:

```sh
npm run test:test-inventory
npm run check:test-inventory-integrity
npm run check:test-inventory-complete
```

`integrity` checks candidates against `test-inventory.v1.json` in both directions.
New candidates, stale entries after deletion or rename, duplicate records, broken
suite mappings and incomplete required groups fail. Repository Guards runs this
command and its synthetic negative fixtures on pull requests and main. Run the
same command locally before publishing a change.

`complete` additionally fails while any selection is unresolved. A successful
integrity check can therefore accompany an incomplete selection report. Both
commands print the unresolved count and state that execution evidence and C14
acceptance have not been assessed. The complete check is expected to fail on the
current inventory; its unresolved records must not be converted into exclusions
to obtain a passing result.

## Discovery and selection

Discovery reads tracked paths and non-ignored untracked files, without restricting
the top-level directory. It uses test/spec names and source signals for Node,
Playwright, Swift, Python, Rust and shell wrappers. These are inclusive review
signals: imports in helpers or embedded fixture text can be candidates, while
unconventional test registration may require an additional signal. Discovery
inspects conventional test names, JavaScript/TypeScript, Python, Rust, Swift,
shell/PowerShell and C-family sources, plus extensionless files. Other extensions
without conventional test names are not inspected; this is a known limitation.
Discovery
neither imports test code nor launches an application, database, browser or test
suite. A source match is not proof that assertions execute.

The real unit runner and the inventory guard both use
`scripts/unit-test-selection.mjs`. Its two recursive
groups and explicit file list preserve the unit suite's ordering and loader.
`app/api/patients/route.test.ts` is registered explicitly in that list; other
`app/` tests are not pulled into the unit suite by recursive discovery.
Every required group must be readable and non-empty; every explicit test must be
a file. Selection fails before database bootstrap or child launch if these
conditions do not hold. The bootstrap, data-directory ownership, child error
propagation and cleanup remain in `scripts/run-unit-suite.mjs`.

The npm adapter reads the script bodies and CI configuration for
`test:launcher-helpers`, `test:native-launcher`, `test:usage-dashboard`,
`test:fabric-generative-runtime-crosswalk`, `test:lume-tokens` and
`test:anydoc-diagnostics`. Their suite IDs
are prefixed with `npm:`. Each script must be exactly `node --test` followed by
simple literal relative file paths. Missing files, duplicate paths (including
directory aliases), flags, filters, shell syntax and expansions fail selection.

`test:anydoc-diagnostics` preserves the existing E2E job's three-file `node --test`
command and ordering: HTTP diagnostic, consumer diagnostic, then correlation.
The npm script replaces the equivalent literal CI command; it adds no execution.
Consumer diagnostic retains its existing `unit` mapping as well.

Each required script must have one literal call in its designated CI job. The
entire step's run block must consist of `npm run <script>` lines, blanks or
standalone comments; a mention inside shell control flow or a heredoc is not a
binding. The adapter rejects explicit false conditions, `continue-on-error`,
shell failure-masking syntax and non-root working directories. It resolves working-directory and shell defaults
from workflow to job to step; explicit shells are limited to `bash`, `sh` and
`pwsh`. It preserves conditions, needs, runner and matrix metadata without
evaluating them. The native launcher requires its existing macOS condition.
Unreadable configuration, malformed YAML, duplicate keys, YAML merges and cyclic
aliases fail. An invalid required suite remains present with errors and no
selected files.

This proves static selection by script bodies and configured calls only. It does
not model npm lifecycle hooks, evaluate general CI reachability, prove exit-code
propagation for every shell, execute test code or establish platform qualification.
A preceding step may fail, a condition
may not hold, and assertions may still skip or be empty. Those require execution
receipts and further review.

The Headless model, `npm:test:headless-portable`, calls the real asynchronous
`collectHeadlessPortableTests` selector shared with the portable runner. Each of
the AIP, Mini and MCP package groups must contain tests; all four explicit script
tests must be files. A missing, empty or unreadable required group fails before
the runner acquires a data directory or launches a child. The inventory calls
only the selector, preserving its ordering and avoiding a second path list.
Importing the runner checks its CLI entrypoint with `realpath` reads but does not
launch a suite or acquire/clean a data directory.

The Headless npm command must remain exactly
`node scripts/run-headless-portable-tests.mjs`, with one literal call in the
`headless-contracts` CI job. It uses the same binding guards as the six explicit
npm models above. The inventory awaits selection and keeps the required suite
present with errors and no selected files if either binding or selection fails.
This adds static selector coverage, not proof of assertions or installed targets.

The guard self-test models select the real entrypoint for each command:

| Suite ID | Selected file |
| --- | --- |
| `npm:check:claims:self-test` | `scripts/check-claims-guard.mjs` |
| `npm:check:schema-writers:self-test` | `scripts/check-schema-writers.mjs` |
| `npm:check:ai-clinical-writes:self-test` | `scripts/check-ai-clinical-write-gate.mjs` |
| `npm:check:api-error-leak:self-test` | `scripts/check-api-error-leak.mjs` |
| `npm:check:openapi:drift:self-test` | `scripts/check-openapi-drift.mjs` |

Each model verifies a regular file inside the repository, an exact npm command
`node <selected file>`, and one literal `npm run <script> -- --self-test` call
in the `repository-guards` job. The ordinary scan alone does not satisfy this
binding. Only the OpenAPI model admits the existing companion invocation
`npm run check:openapi:drift -- --base-ref origin/main`; that line never counts
as the self-test. Other arguments, shell embedding or duplicate self-test calls
fail, with the same CI context guards as above. Collection does not read, import
or execute the guards. Their rules and assertions remain unchanged; execution
and adequacy need separate evidence from the existing CI steps.
The literal self-test argument also makes the adapter itself an inclusive
discovery candidate. That helper retains an unresolved record pending semantic
classification; it is not silently excluded to reduce the unresolved count.

The Playwright model, `npm:test:e2e`, and `playwright.config.ts` both use
`scripts/playwright-test-selection.mjs`. The filesystem-only selector preserves
Playwright's default `.spec`/`.test` pattern, JS/TS extensions with optional `c`/`m`
and `x`, nested and hidden directories, and depth-first `localeCompare` order.
As in the previous explicit `testDir` configuration, Git ignores do not filter
selection, symlinks are not followed, and `node_modules` directories are skipped.
The existing `chatgpt-synthesis-product.spec.ts` ignore remains case-insensitive
at every depth. Helpers and that separate Node harness retain unresolved records.
The required `e2e` group must be readable and non-empty. The real config uses exact
escaped regular expressions from this selector, avoiding a second file list or
an independent discovery pattern. Selection never imports test sources.

`test:e2e` must be exactly `playwright test --workers=1`, with one literal
`npm run test:e2e` call in the `e2e` job of `.github/workflows/e2e.yml`. This replaces
the equivalent direct `npx` invocation; runtime, retries, timeouts, quarantine and
browser settings are unchanged. The existing closed CI binding guards apply.
Renamed, new and missing selected files still require a manifest update; a broken
binding or missing/empty group leaves this required suite present with errors.
The ordinary E2E CI job supplies execution evidence after static selection checks.

Tests outside these models retain `unresolved` selection records, including tests
with separate existing commands or CI callers. `unresolved` means this guard has
not verified a selector binding; it does not mean the file is orphaned or optional.
Platform, capability and method filters need separate selector models and actual
execution receipts before any coverage claim.

## Conditional synthetic plugin suites

`npm:synthetic-plugin:test` and `npm:synthetic-plugin:test:browser` are selected
by `.github/workflows/synthetic-plugin.yml`, not required on every push. Reports
label them as conditional. The adapter verifies the existing `pull_request.paths`
and `push.paths` arrays (plugin subtree, MCP contracts and that workflow), plus
`push.branches: [main]`. Filter drift fails instead of silently broadening claims.

The effective working directory must be `plugins/mediflow-synthetic`, including
workflow/job defaults and step overrides. Package commands must remain exactly
`node --test test/*.test.mjs` and `node scripts/browser-smoke.mjs`, with one exact
CI call each: `npm test` and `npm run test:browser`. Existing condition, shell,
error masking and YAML guards apply. Root suite bindings still require root cwd.

The adapter expands only the declared nonrecursive `test/*.test.mjs` glob,
excluding hidden names as the shell does. It returns sorted paths without reading
or importing tests, fails for missing/empty groups or nonregular selected files,
and uses no duplicate test roster. The browser model checks its single declared
script without running it. The manifest maps four Node test files and that browser
script; the other Codex scripts remain unresolved. This models configured selection
when workflow filters match, not execution, browser readiness or host qualification.

## Support modules, not standalone test entrypoints

A reviewed `support` disposition excludes a helper from standalone entrypoint
selection; it does not claim another test ran. It requires a non-empty `reason`,
`owner` and list of `importers`. The six initial dispositions are owned by
`@Wulfgardr` under WUL-729. Their assertions, fixture factories, module doubles
and cleanup hooks are consumed by tests, rather than registered as independent
tests. Fixtures with top-level assertions are not included in this disposition.

Every listed importer must exist among discovered candidates, have a mapped
entry, and actually be selected by an error-free verified suite. Merely naming
an importer or suite in the manifest is insufficient. The source must contain
a runtime import of the exact support path in its leading import prologue.
The closed grammar accepts comments, whitespace, the literal ESM marker
`void import.meta.url;`, and semicolon-terminated default, namespace or named
imports from unescaped string literals. Relative imports require explicit paths;
there is no extension inference. Type-only imports do not count. Inspection
stops at the first other statement, so strings, embedded fixtures, dynamic imports,
`require` calls and imports later in a module do not establish a binding.

Support classification remains a reviewed source decision: this limited check
verifies declared import links, not arbitrary JavaScript semantics or the absence
of standalone tests. A support file selected as a test is rejected. New, renamed
or missing candidates retain the ordinary integrity failures. Reports show support
entrypoint exclusions separately from unresolved selections and execution evidence.

## Updating the inventory

Ordinary changes to test bodies need no digest acknowledgement. For a new,
renamed or removed candidate, update the manifest alongside the source and its
real suite binding. A mapped entry must name a supported selector that actually
selects that file. An unresolved entry must explain the missing verification;
it remains incomplete and visible in every report. Manifest edits are reviewed
source changes, never automatic acceptance of a test omission.

Keep execution outcomes separate: selected files may still contain skipped,
filtered, cancelled or empty tests. Pass/fail/skip/flaky results and qualified
platforms come from the corresponding suite receipts, not this static inventory.
