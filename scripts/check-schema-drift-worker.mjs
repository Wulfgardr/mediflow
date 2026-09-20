/* @Codex */
// WUL-268 (STREAM A): schema drift check worker.
//
// Runs under the strip-types loader + the "@/" resolve hook (see
// check-schema-drift.mjs). Importing "@/lib/db-server" executes the REAL
// bootstrap: it opens the temp SQLite database at MEDIFLOW_DATA_DIR/medical.db
// and runs applySchemaGuards() as an import side effect. We then introspect
// sqlite_master and compare the live tables / columns / indices against the
// drizzle declarations in "@/lib/schema.ts". Drift => exit 1 with a diff.

import Database from 'better-sqlite3';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

import { resolveDataPath } from '@/lib/data-dir';
import * as schema from '@/lib/schema';

// Importing db-server exercises the real brand-new database path: the empty
// database receives its minimal base schema and then the runtime guards layer
// on additive columns, guard-owned tables, constraints, and indices.
const { hasCanonicalDurableReviewPatientLinkSchema, hasCanonicalHeadlessSoapActiveRoleAttestationSchema, hasCanonicalPhysicianReviewAttestationSchema } = await import('@/lib/db-server');

function collectExpected() {
    const expectedTables = new Map();
    const expectedIndices = new Set();
    for (const value of Object.values(schema)) {
        let cfg;
        try {
            cfg = getTableConfig(value);
        } catch {
            continue; // not a drizzle table export
        }
        expectedTables.set(cfg.name, new Set(cfg.columns.map((col) => col.name)));
        for (const idx of cfg.indexes) {
            const name = idx?.config?.name;
            if (name) expectedIndices.add(name);
        }
    }
    return { expectedTables, expectedIndices };
}

function collectLive(dbPath) {
    const db = new Database(dbPath, { readonly: true });
    try {
        const tables = new Map();
        const tableRows = db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
            .all();
        for (const { name } of tableRows) {
            const cols = db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
            tables.set(name, new Set(cols));
        }
        const indexRows = db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'")
            .all();
        const indices = new Set(indexRows.map((r) => r.name));
        return { tables, indices };
    } finally {
        db.close();
    }
}

function main() {
    const dbPath = resolveDataPath('medical.db');
    const { expectedTables, expectedIndices } = collectExpected();
    const live = collectLive(dbPath);

    const problems = [];

    if (!hasCanonicalPhysicianReviewAttestationSchema()) {
        problems.push('INVALID CONSTRAINTS: "physician_review_attestations" is not the canonical constrained DDL.');
    }
    if (!hasCanonicalHeadlessSoapActiveRoleAttestationSchema()) {
        problems.push('INVALID CONSTRAINTS: Headless SOAP active-role attestation schema is not canonical.');
    }
    if (!hasCanonicalDurableReviewPatientLinkSchema()) {
        problems.push('INVALID CONSTRAINTS: "durable_review_patient_links" is not the canonical constrained DDL.');
    }

    // Every table declared in schema.ts must exist in the bootstrapped runtime
    // schema, with all its columns. (The runtime may carry extra tables/columns/
    // indices that are not modeled in schema.ts, e.g. audit or service internals;
    // those are not treated as drift here, to keep the check scoped to the
    // schema.ts contract rather than failing on legitimately guard-only objects.)
    for (const [tableName, expectedCols] of expectedTables) {
        const liveCols = live.tables.get(tableName);
        if (!liveCols) {
            problems.push(`MISSING TABLE: "${tableName}" is declared in lib/schema.ts but is absent from the fresh runtime bootstrap.`);
            continue;
        }
        for (const col of expectedCols) {
            if (!liveCols.has(col)) {
                problems.push(`MISSING COLUMN: "${tableName}.${col}" is declared in lib/schema.ts but absent at runtime.`);
            }
        }
    }

    // Every index declared in schema.ts must be created by the runtime bootstrap.
    for (const idxName of expectedIndices) {
        if (!live.indices.has(idxName)) {
            problems.push(`MISSING INDEX: "${idxName}" is declared in lib/schema.ts but is not created by the guards in lib/db-server.ts.`);
        }
    }

    if (problems.length > 0) {
        console.error('[schema-drift] Drift detected between lib/schema.ts and the fresh runtime bootstrap in lib/db-server.ts:');
        for (const problem of problems) {
            console.error(`  - ${problem}`);
        }
        console.error('[schema-drift] Update the empty-database bootstrap, applySchemaGuards, or lib/schema.ts so they agree.');
        process.exit(1);
    }

    console.log(
        `[schema-drift] OK: ${expectedTables.size} declared tables and ${expectedIndices.size} declared indices ` +
            'are all present in the freshly bootstrapped runtime schema.',
    );
    process.exit(0);
}

main();
