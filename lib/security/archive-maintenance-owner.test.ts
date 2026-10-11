import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { openVersionedSqliteDatabase } from '../sqlite-schema-open';
import { readSqliteArchiveGeneration } from '../archive-generation';

const repo = path.resolve('.');
async function until<T>(read: () => T | undefined): Promise<T> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { const value = read(); if (value !== undefined) return value; await delay(25); }
    throw new Error('Synthetic owner did not reach the expected state.');
}

for (const sourceCase of ['canonical', 'tracked-baseline', 'incompatible', 'weakened-trigger', 'audit-index-failure', 'quoted-type', 'extra-trigger', 'post-stop-io-failure'])
test(`owned Web repair ${sourceCase}: close, validate, commit or preserve A without restart`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-managed-web-synthetic-'));
    const data = path.join(root, 'data');
    fs.mkdirSync(data);
    fs.mkdirSync(path.join(root, '.next', 'standalone'), { recursive: true });
    const seed = (file: string, firstName: string) => {
        const db = openVersionedSqliteDatabase(file);
        try { db.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)')
            .run('synthetic-same-id', firstName, 'Synthetic', 'SYNTHETIC'); return readSqliteArchiveGeneration(db); }
        finally { db.close(); }
    };
    const before = seed(path.join(data, 'medical.db'), 'Archive A');
    let sourceGeneration: string | undefined;
    const sourceFile = path.join(root, 'medical.db');
    if (sourceCase === 'tracked-baseline') {
        const legacy = new Database(sourceFile);
        for (const file of fs.readdirSync(path.join(repo, 'drizzle')).filter(file => file.endsWith('.sql')).sort())
            legacy.exec(fs.readFileSync(path.join(repo, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
        legacy.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)')
            .run('synthetic-same-id', 'Archive B', 'Synthetic', 'SYNTHETIC');
        legacy.close();
    } else {
        sourceGeneration = seed(sourceFile, 'Archive B');
        const source = new Database(sourceFile);
        if (sourceCase === 'incompatible') source.pragma('user_version = 999');
        if (sourceCase === 'weakened-trigger') source.exec('DROP TRIGGER audit_events_no_update; CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT 1; END');
        if (sourceCase === 'audit-index-failure') source.exec('DROP INDEX audit_events_actor_idx; CREATE TABLE audit_events_actor_idx (id INTEGER)');
        if (sourceCase === 'extra-trigger') source.exec('CREATE TRIGGER audit_events_skip BEFORE INSERT ON audit_events BEGIN SELECT RAISE(IGNORE); END');
        if (sourceCase === 'quoted-type') {
            const definitions = source.prepare("SELECT type, sql FROM sqlite_master WHERE tbl_name='audit_events' AND sql IS NOT NULL").all() as { type: string; sql: string }[];
            source.exec('DROP TABLE audit_events');
            for (const item of definitions) source.exec(item.type === 'table' ? item.sql.replace('outcome TEXT NOT NULL', 'outcome "TEXT NOT NULL"') : item.sql);
        }
        source.close();
    }
    const sourceBytes = fs.readFileSync(sourceFile);
    fs.writeFileSync(path.join(root, '.next', 'standalone', 'server.js'), `
const fs = require('node:fs'); const path = require('node:path');
const http = require('node:http'); const { randomUUID } = require('node:crypto');
const data = process.env.MEDIFLOW_DATA_DIR;
let denied = false;
try { require('node:child_process').spawnSync(process.execPath, ['-e', '']); }
catch (error) { denied = error.code === 'ERR_ACCESS_DENIED'; }
if (!denied) throw new Error('Unobserved child process was allowed.');
let result = process.env.MEDIFLOW_ARCHIVE_MAINTENANCE_RESULT;
process.on('message', message => { if (message.type === 'mediflow:archive-maintenance:repair-legacy:result') result = JSON.stringify(message); });
const server = http.createServer((request, response) => {
  if (request.url === '/repair') process.send({type:'mediflow:archive-maintenance:repair-legacy',requestId:randomUUID(),expectedGeneration:process.env.MEDIFLOW_ARCHIVE_OWNER_GENERATION});
  response.end(JSON.stringify({generation:process.env.MEDIFLOW_ARCHIVE_OWNER_GENERATION,result:result?JSON.parse(result):null}));
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(path.join(data, 'ready.next.json'), JSON.stringify({pid:process.pid,port:server.address().port,result}));
  fs.renameSync(path.join(data, 'ready.next.json'), path.join(data, 'ready.json'));
});
process.on('SIGTERM', () => { server.close(); setTimeout(() => {
  fs.appendFileSync(path.join(data, 'terminal.txt'), process.env.MEDIFLOW_ARCHIVE_OWNER_GENERATION + '\\n');
  if (${JSON.stringify(sourceCase)} === 'post-stop-io-failure') fs.chmodSync(data, 0o500);
  process.disconnect();
}, 150); });
`);
    const launcher = path.join(root, 'owner.mjs');
    fs.writeFileSync(launcher, `import { runArchiveMaintenanceWebOwner } from ${JSON.stringify(path.join(repo, 'lib/security/archive-maintenance-owner.ts'))}; await runArchiveMaintenanceWebOwner(${JSON.stringify(root)});`);
    const owner = spawn(process.execPath, ['--experimental-strip-types', '--import',
        path.join(repo, 'scripts/register-strip-types-loader.mjs'), launcher], {
        cwd: repo, env: { ...process.env, MEDIFLOW_DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = ''; owner.stderr.on('data', chunk => { stderr += chunk; });
    const closed = new Promise<number | null>(resolve => owner.once('close', resolve));
    try {
        const ready = await until(() => {
            try { return JSON.parse(fs.readFileSync(path.join(data, 'ready.json'), 'utf8')) as { pid: number; port: number; result: string }; }
            catch { if (owner.exitCode !== null) throw new Error(stderr); return undefined; }
        });
        const response = await fetch(`http://127.0.0.1:${ready.port}/repair`);
        assert.equal(response.status, 200); await response.text();
        if (sourceCase === 'post-stop-io-failure') {
            assert.equal(await closed, 1, stderr);
            fs.chmodSync(data, 0o700);
            assert.equal(fs.readFileSync(path.join(data, 'terminal.txt'), 'utf8').trim(), before);
            assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'ready.json'), 'utf8')).pid, ready.pid);
            assert.equal(fs.existsSync(path.join(data, 'medical.db.maintenance-admission', 'intent.json')), true);
            const retained = new Database(path.join(data, 'medical.db'), { readonly: true });
            try {
                assert.equal(readSqliteArchiveGeneration(retained), before);
                assert.equal((retained.prepare('SELECT first_name FROM patients').get() as { first_name: string }).first_name, 'Archive A');
            } finally { retained.close(); }
            assert.deepEqual(fs.readFileSync(sourceFile), sourceBytes);
            assert.match(stderr, /requires recovery; Web was not restarted/u);
            return;
        }
        if (!['canonical', 'tracked-baseline'].includes(sourceCase)) {
            let rejection: { status?: string } | undefined;
            for (let i = 0; i < 200 && !rejection; i++) {
                const reply = await fetch(`http://127.0.0.1:${ready.port}/status`).then(value => value.json());
                if (reply.result?.status === 'rejected') rejection = reply.result;
                else await delay(25);
            }
            assert.equal(rejection?.status, 'rejected');
            assert.equal(owner.exitCode, null);
            assert.equal(fs.existsSync(path.join(data, 'terminal.txt')), false);
            const retained = openVersionedSqliteDatabase(path.join(data, 'medical.db'));
            try {
                assert.equal(readSqliteArchiveGeneration(retained), before);
                assert.equal((retained.prepare('SELECT first_name FROM patients').get() as { first_name: string }).first_name, 'Archive A');
            } finally { retained.close(); }
            assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'ready.json'), 'utf8')).pid, ready.pid);
            assert.equal(fs.existsSync(path.join(data, 'medical.db.maintenance-admission', 'intent.json')), false);
            assert.deepEqual(fs.readFileSync(sourceFile), sourceBytes);
            return;
        }
        const restarted = await until(() => {
            const state = JSON.parse(fs.readFileSync(path.join(data, 'ready.json'), 'utf8')) as typeof ready;
            if (owner.exitCode !== null) throw new Error(stderr);
            return state.pid !== ready.pid ? state : undefined;
        });
        const status = JSON.parse(restarted.result);
        assert.equal(status.status, 'committed');
        assert.notEqual(status.archiveGeneration, before);
        assert.notEqual(status.archiveGeneration, sourceGeneration);
        assert.equal(fs.readFileSync(path.join(data, 'terminal.txt'), 'utf8').trim(), before);
        const installed = openVersionedSqliteDatabase(path.join(data, 'medical.db'));
        try {
            assert.equal(readSqliteArchiveGeneration(installed), status.archiveGeneration);
            assert.equal((installed.prepare('SELECT first_name FROM patients').get() as { first_name: string }).first_name, 'Archive B');
        } finally { installed.close(); }
        assert.deepEqual(fs.readFileSync(sourceFile), sourceBytes);
        owner.kill('SIGTERM');
        assert.equal(await closed, 0, stderr);
        assert.deepEqual(fs.readdirSync(path.join(data, 'medical.db.maintenance-admission', 'leases')), []);
    } finally {
        if (owner.exitCode === null && owner.signalCode === null) { owner.kill('SIGTERM'); await closed; }
        fs.chmodSync(data, 0o700);
        fs.rmSync(root, { recursive: true, force: true });
    }
});
