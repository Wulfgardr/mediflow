# C09 explicit historical schema origins

This bounded artifact targets current bootstrap commit
`8ca89433412aab7b259a2d8a21dc0a144494ab1d`. It reconstructs synthetic SQLite
origins, not every installed database and not a product support policy.
Eight published tags form seven families. The manifest records commit-specific
paths, Git blobs, SHA-256 and an explicit AST declaration allowlist. SQL and DDL
remain in Git history; no duplicate migration or generated DDL corpus is stored.

## Origins and order

Each family has `published-sql-then-same-tag-guards`: published SQL in manifest
order, then the same tag's runtime schema guards. Historical
`scripts/prepare-e2e-db.mjs` is recorded as provenance for ordered SQL provisioning
with foreign keys disabled, not imported or executed. The database is reopened
before runtime initialization, preserving the connection boundary. This is an
explicit synthetic provisioning origin, not proof of universal installer use.

For v0.8.6, `empty-database-historical-bootstrap` additionally starts empty and
uses the historical transaction order: `bootstrapEmptySqliteDatabase`,
`applySchemaGuards`, `upgradeLegacyAttachmentCurrentness`.

| Family | Historical guard execution | Initial table count observed |
| --- | --- | --- |
| v0.5.0 | Ordered top-level try blocks and audit helper | 15 |
| v0.6.0 | Ordered top-level try blocks and audit helper | 17 |
| v0.7.0 | `applySchemaGuards` | 20 |
| v0.7.2 | Historical pragmas, then `applySchemaGuards` | 20 |
| v0.7.3 | Historical pragmas, then `applySchemaGuards` | 20 |
| v0.8.0 / v0.8.2 | Historical pragmas, `applySchemaGuardsSerially` immediate transaction | 21 |
| v0.8.6 | Historical pragmas and complete bootstrap/guard/attachment transaction | 33 for both origins |

The audit helper is `lib/audit-db.ts` in v0.5.0–v0.7.0 and
`lib/security/audit-db.ts` later. These commit-specific paths avoid the former
shared-blob path ambiguity. Pragma retry dependencies, the pure AIFA normalizer,
and v0.8.6 bootstrap/exemption/prosthetics helpers are explicitly selected.

## Bounded execution

`historical-schema-initializers.mjs` uses TypeScript AST boundaries to extract
only named declarations and, for the two oldest families, ordered top-level try
blocks. It preserves their bodies and catch behavior rather than rebuilding
schema from `schema.ts`. Whole-source pins and selected node presence are
verified before SQLite opens. TypeScript's binder rejects unresolved dependency
names before execution. Backend imports, filesystem/data-path access, legacy
adoption, connection construction, swap and ORM exports are not selected.
A restricted VM context supplies only the owned SQLite connection, console and
exports; runtime imports and named external capabilities are rejected. This is
execution of trusted pinned initializer fragments, not a general migration engine
or a security sandbox for arbitrary untrusted code.

Run with Node 24 and compatible existing dependencies:

    node scripts/probe-historical-sql-baselines.mjs > /tmp/historical-origins.json

A bounded rerun can select canonical family names (v0.8.0 includes v0.8.2):

    node scripts/probe-historical-sql-baselines.mjs --families=v0.8.0,v0.8.6

The current `lib` tree, bootstrap worker and loader must remain byte-equivalent
to the pinned current commit. Every database is synthetic in one fresh temporary
directory and removed in `finally`. The current bootstrap worker uses isolated
MEDIFLOW_DATA_DIR/E2E paths and disables legacy adoption. No historical backend
module is imported. The SQLite binding is the compatible installed current
dependency; this does not reproduce every historical SQLite engine version. Warnings and initializer errors remain in the result;
initializer/bootstrap failure produces nonzero exit. Zero is not schema parity.

## Observed evidence and limits

The initial run completed the first five families. A missing transitive pragma
helper prevented the two newer families from replaying; this was recorded, not
classified as successful historical initialization. After adding the exact
helper closure and static unresolved-name validation, a second authorized run
selected only v0.8.0/v0.8.2 and v0.8.6. The first five SQLite runs were not repeated.

Across the combined eight successful origins, guards produced no warnings and
all current bootstraps exited zero. The seven SQL+guard origins retain one
structural metadata difference: `observations.updated_at` lacks the fresh
`unixepoch()` default. The historical fresh v0.8.6 origin has no column/FK/index
metadata difference from current fresh. Audit synthetic INSERT succeeds and
UPDATE/DELETE abort with the append-only error before and after all eight
upgrades, and on current fresh. Audit probe rows are rolled back.

Metadata omits physical column order and reports table columns, foreign keys
and index structure. Raw table/index/trigger SQL is tracked separately: textual
DDL differences are not semantic CHECK equivalence. Index SQL retains partial
predicates and expressions, but no general SQL parser or equivalence engine is
introduced. General CHECK behavior and FK behavior under historical data remain
unqualified. Fresh v0.8.6 still has one textual table DDL difference
(`siss_handoff_events`), despite equal structural metadata.

The initial reporter accidentally repeated table trigger text inside index
metadata; its retained JSON permits a read-only projection removing that raw
text from the structural comparison. The final reporter separates those fields.
This reporting correction did not require another SQLite execution.

Local evidence (not committed binary fixtures or release receipts):
`/tmp/c09-historical-origins-once.json`,
`/tmp/c09-historical-origins-corrected.json`, and compact read-only projection
`/tmp/c09-historical-origins-summary.json`. The artifact defines tested origins
only. Product-supported versions, arbitrary legacy provisioning histories and
runtime migration policy remain decisions outside this contribution.
