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
    // Released archives may have acquired this FK through ALTER TABLE, which
    // omitted ON DELETE SET NULL. Admit only that exact earlier declaration.
    const referenceClause = /\bservice_prescription_item_id TEXT REFERENCES service_prescription_items\(id\) ON DELETE SET NULL/g;
    if ([...legacyDdl.matchAll(referenceClause)].length !== 1) deny();
    const legacyDeclarations = [legacyDdl, legacyDdl.replace(referenceClause,
        'service_prescription_item_id TEXT REFERENCES service_prescription_items(id)')];
    const indices = canonicalConnection.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name")
        .all(TABLE) as { sql: string }[];
    const supported = legacyDeclarations.some(declaration => {
        const expected = new Database(':memory:');
        try {
            expected.exec(declaration);
            for (const { sql } of indices) expected.exec(sql);
            return JSON.stringify(observed) === JSON.stringify(schemaSnapshot(expected)[TABLE]);
        } finally { expected.close(); }
    });
    if (!supported) deny();

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

/** Remove only the default introduced by the released patient_ref ALTER TABLE. */
export function upgradeReviewPatientReferenceDefault(
    connection: Database.Database,
    canonicalConnection: Database.Database,
): void {
    const table = 'durable_review_records', staging = 'durable_review_patient_ref_upgrade';
    const canonical = schemaSnapshot(canonicalConnection)[table];
    const observed = schemaSnapshot(connection)[table];
    const fail = (): never => { throw new Error('REVIEW_PATIENT_REFERENCE_SCHEMA_UNSUPPORTED'); };
    if (!canonical) fail();
    if (JSON.stringify(observed) === JSON.stringify(canonical)) return;
    if (!connection.inTransaction || connection.pragma('foreign_keys', { simple: true }) !== 1) fail();
    const ddl = (canonicalConnection.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
        .get(table) as { sql: string }).sql;
    const clause = /\bpatient_ref TEXT NOT NULL(?=,)/g;
    if ([...ddl.matchAll(clause)].length !== 1) fail();
    const expected = new Database(':memory:');
    try {
        expected.exec(ddl.replace(clause, "patient_ref TEXT NOT NULL DEFAULT ''"));
        if (JSON.stringify(observed) !== JSON.stringify(schemaSnapshot(expected)[table])) fail();
    } finally { expected.close(); }
    // No DROP is allowed to delete or detach a referencing row. Unknown child
    // declarations are refused even when empty; populated children require recovery.
    const canonicalShape = schemaSnapshot(canonicalConnection);
    for (const { name } of connection.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[]) {
        const keys = connection.pragma(`foreign_key_list(${quote(name)})`) as { table: string }[];
        if (keys.some(key => key.table.toLowerCase() === table)
            && (!canonicalShape[name] || JSON.stringify(schemaSnapshot(connection)[name]) !== JSON.stringify(canonicalShape[name])
                || connection.prepare(`SELECT 1 FROM ${quote(name)} LIMIT 1`).get())) fail();
    }
    if (connection.prepare('SELECT 1 FROM sqlite_schema WHERE lower(name)=?').get(staging)) fail();
    const header = /^CREATE TABLE durable_review_records\s*\(/;
    if (!header.test(ddl)) fail();
    const names = (canonicalConnection.pragma(`table_xinfo(${table})`) as { name: string }[]).map(column => quote(column.name)).join(', ');
    connection.exec(ddl.replace(header, `CREATE TABLE ${quote(staging)} (`));
    connection.exec(`INSERT INTO ${quote(staging)} (${names}) SELECT ${names} FROM ${quote(table)}`);
    connection.exec(`DROP TABLE ${quote(table)}`);
    connection.exec(`ALTER TABLE ${quote(staging)} RENAME TO ${quote(table)}`);
    if (JSON.stringify(schemaSnapshot(connection)[table]) !== JSON.stringify(canonical)) fail();
}
