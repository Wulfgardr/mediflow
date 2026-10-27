import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { initializeSqliteSchema } from './sqlite-schema';
import { schemaSnapshot, schemaDifferences } from './sqlite-schema-shape';

const PREDECESSORS = new Map([
    [4, 'a998dad7b46c831f283032144f43cd690f68e962b199256ecd68c11736f867ed'],
    [5, '33ce371c41f4cb51033af18ef9a0f06bf8c81a248bca29f18b21d3db9f24ea46'],
]);
export function assertAmbulatoryCommandPredecessorRecoverySchema(probe: Database.Database): void {
    const version = Number(probe.pragma('user_version', { simple: true }));
    const fingerprint = PREDECESSORS.get(version);
    if (!fingerprint) throw new Error('Unsupported ambulatory command recovery predecessor');
    const canonical = new Database(':memory:');
    try {
        initializeSqliteSchema(canonical);
        canonical.exec('DROP TABLE ambulatory_destructive_commands');
        if (version === 4) canonical.exec('DROP TABLE therapy_status_commands');
        const expected = schemaSnapshot(canonical);
        if (createHash('sha256').update(JSON.stringify(expected)).digest('hex') !== fingerprint)
            throw new Error('Immutable recovery predecessor contract drift');
        const unexpected = probe.prepare("SELECT 1 FROM sqlite_schema WHERE type='view' OR name='ambulatory_destructive_commands' OR (?=4 AND name='therapy_status_commands') LIMIT 1").get(version);
        if (unexpected || schemaDifferences(expected, schemaSnapshot(probe)).length > 0)
            throw new Error('Recovery predecessor schema incompatible');
    } finally { canonical.close(); }
}
