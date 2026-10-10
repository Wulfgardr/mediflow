import Database from 'better-sqlite3';
import { schemaSnapshot } from './sqlite-schema-shape';

const TABLE = 'observations';
const STAGING = 'observations_timestamp_default_upgrade';
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const deny = (): never => { throw new Error('OBSERVATION_TIMESTAMP_SCHEMA_UNSUPPORTED'); };

/** Caller owns the verified original snapshot and outer IMMEDIATE transaction. */
export function upgradeObservationTimestampDefault(
    connection: Database.Database,
    canonicalConnection: Database.Database,
): void {
    const canonical = schemaSnapshot(canonicalConnection)[TABLE];
    if (!canonical) deny();
    const observed = schemaSnapshot(connection)[TABLE];
    if (JSON.stringify(observed) === JSON.stringify(canonical)) return;
    if (!connection.inTransaction || connection.pragma('foreign_keys', { simple: true }) !== 1) deny();

    const ddl = (canonicalConnection.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
        .get(TABLE) as { sql: string }).sql;
    // Only the owned canonical declaration is transformed, never untrusted input SQL.
    const defaultClause = /\bupdated_at INTEGER DEFAULT \(unixepoch\(\)\)/g;
    if ([...ddl.matchAll(defaultClause)].length !== 1) deny();
    const legacyDdl = ddl.replace(defaultClause, 'updated_at INTEGER');
    const indices = canonicalConnection.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name")
        .all(TABLE) as { sql: string }[];
    const expected = new Database(':memory:');
    try {
        expected.exec(legacyDdl);
        for (const { sql } of indices) expected.exec(sql);
        if (JSON.stringify(observed) !== JSON.stringify(schemaSnapshot(expected)[TABLE])) deny();
    } finally { expected.close(); }

    // DROP must never cascade into a dependent table, even for an empty child.
    for (const { name } of connection.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[]) {
        const keys = connection.pragma(`foreign_key_list(${quote(name)})`) as { table: string }[];
        if (keys.some(key => key.table.toLowerCase() === TABLE)) deny();
    }
    if (connection.prepare('SELECT 1 FROM sqlite_schema WHERE lower(name)=?').get(STAGING)) deny();
    const header = /^CREATE TABLE (?:observations|"observations"|`observations`|\[observations\])\s*\(/;
    if (!header.test(ddl)) deny();
    const columns = (canonicalConnection.pragma('table_xinfo(observations)') as { name: string; hidden: number }[]);
    if (columns.some(column => column.hidden !== 0)) deny();
    const names = columns.map(column => quote(column.name)).join(', ');
    connection.exec(ddl.replace(header, `CREATE TABLE ${quote(STAGING)} (`));
    connection.exec(`INSERT INTO ${quote(STAGING)} (${names}) SELECT ${names} FROM ${quote(TABLE)}`);
    connection.exec(`DROP TABLE ${quote(TABLE)}`);
    connection.exec(`ALTER TABLE ${quote(STAGING)} RENAME TO ${quote(TABLE)}`);
    for (const { sql } of indices) connection.exec(sql);
    if (JSON.stringify(schemaSnapshot(connection)[TABLE]) !== JSON.stringify(canonical)) deny();
}
