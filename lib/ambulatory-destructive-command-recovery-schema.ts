import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { initializeSqliteSchema } from './sqlite-schema';
import { schemaSnapshot, schemaDifferences } from './sqlite-schema-shape';

const PREDECESSORS = new Map([
    [4, 'a998dad7b46c831f283032144f43cd690f68e962b199256ecd68c11736f867ed'],
    [5, '33ce371c41f4cb51033af18ef9a0f06bf8c81a248bca29f18b21d3db9f24ea46'],
    [6, '4becef1521ec507b3da31047e01ab3e25562197c8a518472bb4cdef93ed3867b'],
    [9, '85259ea3bdcbdfa286a0d8a206a04bfc5621c106a604488c0e17d8c7c37d3ba1'],
]);
export function assertAmbulatoryCommandPredecessorRecoverySchema(probe: Database.Database): void {
    const version = Number(probe.pragma('user_version', { simple: true }));
    const fingerprint = PREDECESSORS.get(version);
    if (!fingerprint) throw new Error('Unsupported ambulatory command recovery predecessor');
    const canonical = new Database(':memory:');
    try {
        initializeSqliteSchema(canonical);
        if (version < 9) {
            canonical.exec('DROP TABLE portable_import_origins');
            for (const column of ['identifier_type', 'identifier_history', 'birth_date_precision', 'birth_year', 'allergies']) canonical.exec(`ALTER TABLE patients DROP COLUMN ${column}`);
        }
        canonical.exec('ALTER TABLE entries DROP COLUMN recorded_by');
        if (version < 6) canonical.exec('DROP TABLE ambulatory_destructive_commands');
        if (version === 4) canonical.exec('DROP TABLE therapy_status_commands');
        const expected = schemaSnapshot(canonical);
        if (createHash('sha256').update(JSON.stringify(expected)).digest('hex') !== fingerprint)
            throw new Error('Immutable recovery predecessor contract drift');
        const unexpected = probe.prepare("SELECT 1 FROM sqlite_schema WHERE type='view' OR (?<9 AND name='portable_import_origins') OR (?<6 AND name='ambulatory_destructive_commands') OR (?=4 AND name='therapy_status_commands') LIMIT 1").get(version, version, version);
        if (unexpected || schemaDifferences(expected, schemaSnapshot(probe)).length > 0)
            throw new Error('Recovery predecessor schema incompatible');
    } finally { canonical.close(); }
}
