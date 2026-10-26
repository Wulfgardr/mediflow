import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { initializeSqliteSchema } from './sqlite-schema';
import { schemaSnapshot, schemaDifferences } from './sqlite-schema-shape';

// Canonical v4 produced by 3828bb17d4883b28a646c16af10f9505fddded38; ADR0168.
const V4_SCHEMA_SHA256 = 'a998dad7b46c831f283032144f43cd690f68e962b199256ecd68c11736f867ed';
export function assertTherapyCommandPredecessorRecoverySchema(probe: Database.Database): void {
    if (probe.pragma('user_version', { simple: true }) !== 4) throw new Error('Recovery predecessor is not v4');
    const canonical = new Database(':memory:');
    try {
        initializeSqliteSchema(canonical);
        canonical.exec('DROP TABLE therapy_status_commands');
        const expected = schemaSnapshot(canonical);
        if (createHash('sha256').update(JSON.stringify(expected)).digest('hex') !== V4_SCHEMA_SHA256)
            throw new Error('Recovery v4 contract drift');
        if (probe.prepare("SELECT 1 FROM sqlite_schema WHERE type='view' OR name='therapy_status_commands' LIMIT 1").get()
            || schemaDifferences(expected, schemaSnapshot(probe)).length > 0)
            throw new Error('Recovery v4 schema incompatible');
    } finally { canonical.close(); }
}
