/* @Codex: fresh native setup only; never recreate a missing database beside existing files. */
import fs from 'node:fs';
import path from 'node:path';

const directory = process.env.MEDIFLOW_DATA_DIR;
if (!directory || !path.isAbsolute(directory)) throw new Error('NATIVE_DATA_DIRECTORY_REQUIRED');
const database = path.join(directory, 'medical.db');
const selectedDatabase = process.env.MEDIFLOW_DB_PATH || database;
const legacyDatabase = path.join(process.cwd(), 'medical.db');
// Custom paths and existing data retain their existing bootstrap/recovery path.
if (path.resolve(selectedDatabase) === path.resolve(database) && !fs.existsSync(legacyDatabase)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const before = fs.lstatSync(directory);
    if (before.isDirectory() && !before.isSymbolicLink() && fs.readdirSync(directory).length === 0) {
        // Exclusive creation cannot replace an existing database. An interrupted
        // bootstrap remains visible for schema diagnosis, never silently removed.
        const fd = fs.openSync(database, 'wx', 0o600);
        fs.closeSync(fd);
        await import('../lib/db-server.ts');
        console.log('Fresh native database initialized; no operator account created.');
    }
}
