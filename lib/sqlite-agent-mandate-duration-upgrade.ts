import Database from 'better-sqlite3';
import { schemaSnapshot } from './sqlite-schema-shape';

const TABLE = 'agent_mandates';
const STAGING = 'agent_mandates_duration_upgrade';
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const deny = (): never => { throw new Error('AGENT_MANDATE_DURATION_SCHEMA_UNSUPPORTED'); };

export function hasLegacyAgentMandateDurationSchema(connection: Database.Database): boolean {
    const row = connection.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(TABLE) as { sql: string } | undefined;
    return Boolean(row?.sql && row.sql.includes('created_at + 43200000'));
}

export function upgradeAgentMandateDurationConstraint(
    connection: Database.Database,
    canonicalConnection: Database.Database,
): void {
    const canonical = schemaSnapshot(canonicalConnection)[TABLE];
    if (!canonical) deny();
    const observed = schemaSnapshot(connection)[TABLE];
    if (JSON.stringify(observed) === JSON.stringify(canonical)) return;
    if (!connection.inTransaction || connection.pragma('foreign_keys', { simple: true }) !== 0) deny();

    const ddl = (canonicalConnection.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
        .get(TABLE) as { sql: string }).sql;
    const durationClause = /\bexpires_at <= created_at \+ 86400000\b/g;
    if ([...ddl.matchAll(durationClause)].length !== 1) deny();
    const legacyDdl = ddl.replace(durationClause, 'expires_at <= created_at + 43200000');
    const indices = canonicalConnection.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name")
        .all(TABLE) as { sql: string }[];
    const expected = new Database(':memory:');
    try {
        expected.exec(legacyDdl);
        for (const { sql } of indices) expected.exec(sql);
        if (JSON.stringify(observed) !== JSON.stringify(schemaSnapshot(expected)[TABLE])) deny();
    } finally { expected.close(); }

    if (connection.prepare('SELECT 1 FROM sqlite_schema WHERE lower(name)=?').get(STAGING)) deny();
    const header = /^CREATE TABLE (?:agent_mandates|"agent_mandates"|`agent_mandates`|\[agent_mandates\])\s*\(/;
    if (!header.test(ddl)) deny();
    const columns = canonicalConnection.pragma('table_xinfo(agent_mandates)') as { name: string; hidden: number }[];
    if (columns.some(column => column.hidden !== 0)) deny();
    const names = columns.map(column => quote(column.name)).join(', ');
    connection.exec(ddl.replace(header, `CREATE TABLE ${quote(STAGING)} (`));
    connection.exec(`INSERT INTO ${quote(STAGING)} (${names}) SELECT ${names} FROM ${quote(TABLE)}`);
    connection.exec(`DROP TABLE ${quote(TABLE)}`);
    connection.exec(`ALTER TABLE ${quote(STAGING)} RENAME TO ${quote(TABLE)}`);
    for (const { sql } of indices) connection.exec(sql);
    if (JSON.stringify(schemaSnapshot(connection)[TABLE]) !== JSON.stringify(canonical)) deny();
}
