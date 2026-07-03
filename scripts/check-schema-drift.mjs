#!/usr/bin/env node

// WUL-268 (STREAM A): schema drift check.
//
// The runtime guards in lib/db-server.ts (applySchemaGuards) are the operative
// migration mechanism: drizzle/*.sql files are historical artifacts and are
// never applied at runtime (there is no migrator import and no db:migrate
// script). This check makes that contract enforceable: it bootstraps a FRESH
// temp SQLite database through the REAL db-server bootstrap path (by pointing
// MEDIFLOW_DATA_DIR at a throwaway directory and importing lib/db-server, which
// runs applySchemaGuards as an import side effect), introspects sqlite_master,
// and compares the live tables / columns / indices against the drizzle
// declarations in lib/schema.ts. It exits 1 with a readable diff on drift.
//
// Because lib/db-server.ts and lib/schema.ts use the "@/*" path alias and
// "server-only", this script registers a tiny resolve hook that maps "@/*" to
// the project root and stubs "server-only" before importing them. That keeps a
// SINGLE source of truth: the check runs the actual guards rather than a copy.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LOADER_PATH = path.join(ROOT_DIR, 'scripts', 'register-strip-types-loader.mjs');
const DRIFT_HOOK_PATH = path.join(ROOT_DIR, 'scripts', 'schema-drift-resolve-hook.mjs');
const WORKER_PATH = path.join(ROOT_DIR, 'scripts', 'check-schema-drift-worker.mjs');

// The heavy lifting (importing the aliased, server-only modules and running the
// real guards) happens in a worker process launched with the strip-types loader
// and the "@/" resolve hook. This wrapper just resolves a compatible node
// runtime the same way run-strip-types.mjs does, then relays the worker output.

function resolveCommand(command) {
    if (!command) return null;
    if (command.includes('/')) return command;
    for (const entry of (process.env.PATH || '').split(path.delimiter)) {
        if (!entry) continue;
        const candidate = path.join(entry, command);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function collectCandidates() {
    const pathNodes = (process.env.PATH || '')
        .split(path.delimiter)
        .filter(Boolean)
        .map((entry) => path.join(entry, 'node'));
    return [
        resolveCommand(process.env.MEDIFLOW_STRIP_TYPES_NODE),
        process.execPath,
        ...pathNodes,
        '/opt/homebrew/bin/node',
        '/usr/local/bin/node',
    ].filter((value, index, values) => value && values.indexOf(value) === index);
}

function supportsStripTypes(nodePath) {
    if (!nodePath || !fs.existsSync(nodePath)) return false;
    const result = spawnSync(
        nodePath,
        ['--experimental-strip-types', '--import', LOADER_PATH, '-e', ''],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return result.status === 0;
}

const nodePath = collectCandidates().find(supportsStripTypes);
if (!nodePath) {
    console.error('[schema-drift] No Node.js runtime with --experimental-strip-types was found.');
    console.error('[schema-drift] Set MEDIFLOW_STRIP_TYPES_NODE to a compatible node binary.');
    process.exit(2);
}

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-drift-'));

const result = spawnSync(
    nodePath,
    [
        '--experimental-strip-types',
        '--import',
        LOADER_PATH,
        '--import',
        pathToFileURL(DRIFT_HOOK_PATH).href,
        WORKER_PATH,
    ],
    {
        encoding: 'utf8',
        stdio: 'inherit',
        env: {
            ...process.env,
            MEDIFLOW_DATA_DIR: tempDataDir,
            MEDIFLOW_SCHEMA_DRIFT_ROOT: ROOT_DIR,
        },
    },
);

try {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
} catch {
    // best-effort cleanup of the throwaway bootstrap directory
}

process.exit(result.status === null ? 1 : result.status);
