/* @Codex: fresh native setup only; never recreate a missing database beside existing files. */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import reservationContract from './native-first-install-contract.json' with { type: 'json' };

const directory = process.env.MEDIFLOW_DATA_DIR;
if (!directory || !path.isAbsolute(directory)) throw new Error('NATIVE_DATA_DIRECTORY_REQUIRED');
const argumentsAfterScript = process.argv.slice(2);
if (argumentsAfterScript.length > 1 || (argumentsAfterScript.length === 1 && argumentsAfterScript[0] !== '--create-empty-only')) {
    throw new Error('NATIVE_FIRST_INSTALL_ARGUMENT_INVALID');
}
const createEmptyOnly = argumentsAfterScript[0] === '--create-empty-only';
const database = path.join(directory, 'medical.db');
const selectedDatabase = process.env.MEDIFLOW_DB_PATH || database;
// Custom paths and existing data retain their existing bootstrap/recovery path.
// A legacy file in cwd cannot override the explicitly selected native archive.
if (path.resolve(selectedDatabase) === path.resolve(database)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const before = fs.lstatSync(directory);
    if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('NATIVE_DATA_DIRECTORY_INVALID');
    const entries = fs.readdirSync(directory);
    if (entries.length === 0) {
        // Exclusive creation cannot replace an existing database. An interrupted
        // bootstrap remains visible for schema diagnosis, never silently removed.
        const fd = fs.openSync(database, 'wx', 0o600);
        fs.closeSync(fd);
        // A valid, header-only SQLite reservation is distinguishable from a
        // truncated zero-byte archive. Failure remains visible; never remove it.
        const reservation = new Database(database, { fileMustExist: true });
        try {
            reservation.pragma('synchronous = FULL');
            reservation.transaction(() => {
                reservation.pragma(`application_id = ${reservationContract.applicationId}`);
                reservation.pragma(`user_version = ${reservationContract.userVersion}`);
            }).immediate();
        } finally {
            reservation.close();
        }
        // Persist both the committed file and its newly created directory entry.
        for (const target of [database, directory]) {
            const descriptor = fs.openSync(target, 'r');
            try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        }
        if (createEmptyOnly) {
            // The packaged supervisor has no TypeScript source tree. It creates
            // the exclusive SQLite reservation before logs/PID; the bundled server then
            // performs its existing schema bootstrap on its first auth check.
            console.log('Fresh native SQLite database reserved for packaged runtime bootstrap.');
        } else {
            (await import('../lib/db-server.ts')).openDbServer();
            console.log('Fresh native database initialized; no operator account created.');
        }
    } else if (!fs.existsSync(database)) {
        // Runtime metadata before a missing database is not a fresh installation.
        // Do not adopt, delete or overwrite it merely to make a later auth check pass.
        throw new Error('NATIVE_DATA_DIRECTORY_NOT_EMPTY_WITHOUT_DATABASE');
    }
}
