# Test inventory

The inventory detects changes to test discovery and to the unit suite's selection.
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

The initial executable selector model is the unit suite. The real runner and the
inventory guard both use `scripts/unit-test-selection.mjs`. Its two recursive
groups and explicit script list preserve the unit suite's ordering and loader.
Every required group must be readable and non-empty; every explicit test must be
a file. Selection fails before database bootstrap or child launch if these
conditions do not hold. The bootstrap, data-directory ownership, child error
propagation and cleanup remain in `scripts/run-unit-suite.mjs`.

Tests outside this model retain `unresolved` selection records, including tests
with separate existing commands or CI callers. `unresolved` means this guard has
not verified a selector binding; it does not mean the file is orphaned or optional.
Platform, capability and method filters need separate selector models and actual
execution receipts before any coverage claim.

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
