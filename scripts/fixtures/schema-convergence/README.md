# C09 explicit historical schema origins

This artifact reconstructs synthetic SQLite origins. It does not qualify every
installed database, every historical SQLite engine, or product-supported versions.
Eight published tags form seven source families; v0.8.0 and v0.8.2 share sources.
Historical SQL and DDL stay in Git history rather than a duplicated fixture corpus.

## Origins and order

`published-sql-then-same-tag-guards` applies each family's published SQL in
manifest order, then that tag's runtime schema guards. The pinned historical
`scripts/prepare-e2e-db.mjs` records the ordered SQL provisioning origin with
foreign keys disabled; it is not imported or executed. The database is reopened
before the historical runtime initialization, preserving the connection boundary.
This represents one explicit synthetic provisioning path, not universal installer
behavior.

The additional v0.8.6 origin, `empty-database-historical-bootstrap`, starts empty
and preserves the immediate transaction order: `bootstrapEmptySqliteDatabase`,
`applySchemaGuards`, then `upgradeLegacyAttachmentCurrentness`.

| Family | Historical initializer order |
| --- | --- |
| v0.5.0, v0.6.0 | Ordered top-level guard try blocks, including audit |
| v0.7.0 | `applySchemaGuards` |
| v0.7.2, v0.7.3 | Historical pragmas, then `applySchemaGuards` |
| v0.8.0 / v0.8.2 | Historical pragmas, then `applySchemaGuardsSerially` |
| v0.8.6 | Historical pragmas, then the bootstrap/guard/attachment transaction |

## Pinned sources and bounded extraction

`provenance.json` records commit-specific paths, Git blobs, SHA-256 digests and
explicit AST declaration allowlists. The audit helper is `lib/audit-db.ts` in
v0.5.0–v0.7.0 and `lib/security/audit-db.ts` later. Pragma retry dependencies,
the pure AIFA normalizer and v0.8.6 bootstrap/exemption/prosthetics helpers are
selected explicitly. Every tag's references are checked, including shared families.

`historical-schema-initializers.mjs` extracts named TypeScript declarations and,
for the two oldest families, ordered top-level try blocks. It preserves bodies,
transactions and catches rather than generating schema from `schema.ts`.
TypeScript's binder rejects unresolved dependency names before SQLite opens.
The selected fragments exclude historical backend imports, filesystem/data-path
access, legacy adoption, connection construction, swap and ORM exports.
The VM context supplies the owned SQLite connection, console and exports; this
is execution of trusted pinned fragments, not a sandbox for arbitrary source.

## Running and selecting the current baseline

Use Node 24 and compatible existing checkout dependencies:

```sh
node scripts/probe-historical-sql-baselines.mjs
node scripts/probe-historical-sql-baselines.mjs --families=v0.8.0,v0.8.6
```

The filter accepts canonical family names; v0.8.0 includes v0.8.2. Databases are
synthetic, created under a fresh temporary directory and removed in `finally`.
The current bootstrap worker receives isolated data paths and disables legacy
adoption. Initializer/bootstrap failures produce nonzero exit; zero does not
assert schema parity. Historical warnings and errors remain visible in the report.

The manifest's `currentCommit` explicitly selects the current bootstrap baseline
(initially `8ca89433412aab7b259a2d8a21dc0a144494ab1d`). The probe requires the
checkout's `lib` tree, bootstrap worker and TypeScript loader to match that commit.
The report exposes this pin as `currentBootstrapCommit`, separately from the
checkout's `currentCommit`.

After an intentional runtime integration, update the manifest's `currentCommit`
to the exact reviewed integration commit containing the complete runtime change.
Keep historical source pins unchanged, retain the equivalence guard, and evaluate
the origins against that new baseline before updating the comparison statement.
Do not bypass the guard or silently derive the baseline from the running checkout.

## Comparison boundary

Against the initial baseline, the seven SQL+guard origins retain one structural
metadata difference: `observations.updated_at` lacks the fresh `unixepoch()`
default. The historical fresh v0.8.6 origin has no column/FK/index metadata
difference, but retains a textual table DDL difference on `siss_handoff_events`.
These statements are baseline-specific, not permanent migration guarantees.

Structural comparison omits physical column order and covers columns, foreign
keys and index structure. Raw table/index/trigger SQL is reported separately;
textual differences do not establish semantic CHECK equivalence. Index SQL
retains partial predicates and expressions without a general SQL equivalence
parser. Audit behavior is checked using synthetic INSERT and rejected UPDATE/
DELETE operations, then rolled back. General CHECK behavior and FK behavior
under historical data remain unqualified. Product support policy and arbitrary
legacy provisioning histories are outside this artifact.
