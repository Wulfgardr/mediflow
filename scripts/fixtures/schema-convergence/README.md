# C09 historical SQL baseline probe — not installed release fixtures

This partial artifact targets `ba20a618e9c08a74c4160158ecd14228c9ebe295`.
`provenance.json` pins eight published tags to seven source families, records
SQL and runtime-source Git blobs and SHA-256 hashes, and deduplicates identical
sources. The SQL files stay in Git history; no duplicate SQL corpus is stored.
The probe verifies each SQL source against the manifest before executing it in
a new temporary SQLite database. It never imports a historical module.

Run with Node 24 and the current checkout's existing dependencies:

    node scripts/probe-historical-sql-baselines.mjs > /tmp/historical-sql-baselines.json

All databases are synthetic, under a fresh OS temporary directory, and removed
in `finally`. Only the current `db-server-bootstrap-worker.mjs` runs, with
explicit isolated MEDIFLOW_DATA_DIR/E2E paths and legacy adoption disabled.
Exit zero means the diagnostic completed, not that schemas match. Every family
reports its bootstrap exit status and structural differences from current fresh.
The report compares column metadata (excluding physical column order), FK
metadata and index metadata. CHECK expressions, partial-index predicates and
behavior of audit triggers remain outside this bounded probe.

## Evidence at the target revision

The first diagnostic completed all seven historical SQL baselines and current
fresh. All seven current bootstrap calls exited zero. Each baseline retained
exactly one difference in the compared metadata: `observations.updated_at`
has no default; current fresh has `unixepoch()`. No other metadata difference
was reported. This is a real forward-path mismatch, not full C09 qualification.

## Installed-release origin remains unqualified

Replaying historical SQL is not equivalent to reconstructing an installed
release. Runtime guards can add columns/tables absent from those SQL files,
and historically tolerated failures can leave more than one installed shape.
The manifest therefore names runtime sources as **not replayed**.

The historical `lib/schema.ts` files are useful pure definitions: their imports
are limited to `drizzle-orm` and `drizzle-orm/sqlite-core`, with no database-open
module. Static inspection shows observations.updatedAt absent in v0.5.0 and
`default(sql\`(unixepoch())\`)` in v0.6.0 through v0.8.6. They establish intended
model shape, but do not establish what runtime guards or previous provisioning
actually installed. They also do not replace guard-only tables and audit
triggers. No historical schema module was imported in this preparation.

For example, historical `0012_observations_version_concurrency.sql` adds
`updated_at INTEGER` without a default; the runtime `ensureColumn` variant also
adds it without a default. A definition-only reconstruction using schema.ts
would conceal this demonstrated origin difference. v0.8.0 and v0.8.2 share the
same schema.ts, db-server, audit helper, pragma helper and SQL tree; the other
six families are kept distinct.

Next work must qualify the installed origins against the recorded definitions
and guards, then extend the existing bootstrap tests to the complete semantic
contract. This artifact neither restricts release support nor changes runtime,
migrations, backup/restore or C15 responsibilities.
