# C09 explicit historical schema origins

This artifact reconstructs the synthetic upgrade origins declared in
[ADR0080](../../../docs/adr/0080-serialize-sqlite-schema-guards-at-bootstrap.md#emendamento-2026-10-10-apertura-esplicita-e-schema-versionato-c09).
It does not qualify every installed database or historical SQLite engine.
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
adoption. Initializer/bootstrap failure, a schema difference, or a failed fresh/
upgraded audit assertion produces nonzero exit. Historical warnings and errors
remain visible in the report.

The manifest's `currentCommit` explicitly selects the current bootstrap baseline
(`99590af847fede54182a274d3230198d181517a8`). The probe requires the
checkout's `lib` tree, bootstrap worker and TypeScript loader to match that commit.
The report exposes this pin as `currentBootstrapCommit`, separately from the
checkout's `currentCommit`.

After an intentional runtime integration, update the manifest's `currentCommit`
to the exact reviewed integration commit containing the complete runtime change.
Keep historical source pins unchanged, retain the equivalence guard, and evaluate
the origins against that new baseline before updating the comparison statement.
Do not bypass the guard or silently derive the baseline from the running checkout.

## Comparison boundary

All eight declared origins converge to the fresh schema at the pinned baseline,
with no initializer warnings. The forward upgrade restores the missing historical
`observations.updated_at` default. Fresh and upgraded audit accept synthetic INSERT
and reject UPDATE/DELETE; each behavior probe rolls back its synthetic row.

`lib/sqlite-schema-shape.ts` ignores physical column position, comments and
whitespace. Its closed grammar normalizes known declaration quoting, simple
index order syntax and the observed `INTEGER DEFAULT 1 NOT NULL` spelling.
PK order, grouped FK components, defaults, CHECK tokens, index expressions and
predicates remain significant. Trigger headers normalize known names; trigger
bodies and string literals stay exact. Unknown SQL compares conservatively.
Real SQLite counterexamples ensure weakened CHECKs, changed defaults, partial
indexes, FK/PK order and the `current_date`/quoted-column distinction remain
observable. The runtime separately rejects views.

These are source-derived provisioning origins with synthetic data. They do not
cover arbitrary manual schema edits or claim algebraic equivalence of general
SQL expressions. Runtime admission also checks integrity and foreign keys and
requires exact canonical convergence before committing version 1. Other origins
follow the preservation/recovery path in ADR0080.
