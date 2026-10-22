import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { initializeSqliteSchema } from '../sqlite-schema';
import { openVersionedSqliteDatabase } from '../sqlite-schema-open';
import { readSqliteArchiveGeneration } from '../archive-generation';
import { commitTerritorialPackTransition, readTerritorialPacks, requireTerritorialPack } from '../territorial-pack-store';
import { TERRITORIAL_PACK_SCHEMA } from '../territorial-packs';
import { retirePinEraResidues } from './pin-era-residues';

const repo = path.resolve('.');
async function until<T>(read: () => T | undefined): Promise<T> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { const value = read(); if (value !== undefined) return value; await delay(25); }
    throw new Error('Synthetic owner did not reach the expected state.');
}

for (const sourceCase of ['canonical', 'tracked-baseline', 'territorial-active', 'territorial-legacy', 'territorial-inverse', 'incompatible', 'weakened-trigger', 'audit-index-failure', 'quoted-type', 'extra-trigger', 'post-stop-io-failure', 'backup-collision'])
test(`owned Web repair ${sourceCase}: close, validate, commit or preserve A without restart`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-managed-web-synthetic-'));
    const data = path.join(root, 'data');
    fs.mkdirSync(data);
    fs.mkdirSync(path.join(root, '.next', 'standalone'), { recursive: true });
    const seed = (file: string, firstName: string) => {
        if (territorial && firstName === 'Archive A') {
            const legacy = new Database(file); initializeSqliteSchema(legacy); legacy.pragma('user_version = 4'); legacy.close();
        }
        const db = openVersionedSqliteDatabase(file);
        try { db.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)')
            .run('synthetic-same-id', firstName, 'Synthetic', 'SYNTHETIC'); return readSqliteArchiveGeneration(db); }
        finally { db.close(); }
    };
    const territorial = sourceCase.startsWith('territorial-');
    const admitted = ['canonical', 'tracked-baseline', 'territorial-active', 'territorial-legacy', 'territorial-inverse'].includes(sourceCase);
    const before = seed(path.join(data, 'medical.db'), 'Archive A');
    const account = 'synthetic-repair-account';
    const wrapping = sourceCase === 'tracked-baseline' ? 'v3:synthetic-passphrase' : 'v2:synthetic-pin';
    const prior = new Database(path.join(data, 'medical.db'));
    prior.prepare('INSERT INTO users (id, username, password_hash, encrypted_master_key, salt) VALUES (?, ?, ?, ?, ?)')
        .run(account, account, 'synthetic-hash', wrapping, 'synthetic-salt');
    if (territorial) {
        const change = (preset: string, expectedRevision: number) => commitTerritorialPackTransition(prior,
            { schemaVersion: TERRITORIAL_PACK_SCHEMA, preset, expectedRevision, confirmed: true },
            { actorType: 'system', actorRef: 'synthetic-owner', sourceSurface: 'job' }, () => {});
        if (sourceCase !== 'territorial-inverse') change('core', 1);
    }
    const hostMarker = prior.prepare("SELECT value FROM settings WHERE key='territorial.packs.initialization'").pluck().get();
    prior.close();
    const collision = path.join(data, 'medical.db.bak-20261011-101500123');
    if (sourceCase === 'backup-collision') fs.writeFileSync(collision, 'existing recovery copy');
    let sourceGeneration: string | undefined;
    const sourceFile = path.join(root, 'medical.db');
    if (['tracked-baseline', 'territorial-legacy'].includes(sourceCase)) {
        const legacy = new Database(sourceFile);
        for (const file of fs.readdirSync(path.join(repo, 'drizzle')).filter(file => file.endsWith('.sql')).sort())
            legacy.exec(fs.readFileSync(path.join(repo, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
        legacy.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)')
            .run('synthetic-same-id', 'Archive B', 'Synthetic', 'SYNTHETIC');
        legacy.close();
    } else {
        sourceGeneration = seed(sourceFile, 'Archive B');
        const source = new Database(sourceFile);
        if (sourceCase === 'territorial-active') commitTerritorialPackTransition(source,
            { schemaVersion: TERRITORIAL_PACK_SCHEMA, preset: 'core+it+lom', expectedRevision: 0, confirmed: true },
            { actorType: 'system', actorRef: 'synthetic-source', sourceSurface: 'job' }, () => {});
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
    fs.writeFileSync(launcher, `${sourceCase === 'backup-collision' ? `globalThis.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [2026, 9, 11, 10, 15, 0, 123])); } };` : ''} import { runArchiveMaintenanceWebOwner } from ${JSON.stringify(path.join(repo, 'lib/security/archive-maintenance-owner.ts'))}; await runArchiveMaintenanceWebOwner(${JSON.stringify(root)});`);
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
        if (['post-stop-io-failure', 'backup-collision'].includes(sourceCase)) {
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
            if (sourceCase === 'backup-collision') assert.equal(fs.readFileSync(collision, 'utf8'), 'existing recovery copy');
            return;
        }
        if (!admitted) {
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
            if (territorial) {
                const capability = readTerritorialPacks(installed);
                const active = sourceCase === 'territorial-inverse';
                assert.equal(capability.preset, active ? 'core+it+lom' : 'core');
                assert.equal(capability.revision, active ? 2 : 3);
                assert.equal(installed.prepare("SELECT value FROM settings WHERE key='territorial.packs.initialization'").pluck().get(), hostMarker);
                if (active) installed.transaction(() => requireTerritorialPack(installed, 'lom')).immediate();
                else assert.throws(() => installed.transaction(() => requireTerritorialPack(installed, 'lom')).immediate(), /pack_disabled/);
                const audit = installed.prepare("SELECT redacted_metadata FROM audit_events WHERE event_type='territorial.packs.preserved'").all() as { redacted_metadata: string }[];
                assert.equal(audit.length, 1);
                assert.deepEqual(JSON.parse(audit[0].redacted_metadata).flags, active
                    ? ['before:core+it+lom', 'after:core+it+lom', 'origin:replacement:revision:1->2']
                    : ['before:core', 'after:core', 'origin:replacement:revision:2->3']);
                assert.equal(installed.prepare("SELECT count(*) FROM audit_events WHERE event_type='territorial.packs.migrated'").pluck().get(), 0);
            }
            assert.equal((installed.prepare('SELECT first_name FROM patients').get() as { first_name: string }).first_name, 'Archive B');
        } finally { installed.close(); }
        assert.deepEqual(fs.readFileSync(sourceFile), sourceBytes);
        owner.kill('SIGTERM');
        assert.equal(await closed, 0, stderr);
        assert.deepEqual(fs.readdirSync(path.join(data, 'medical.db.maintenance-admission', 'leases')), []);
        // Exercise the real producer and C07 retirer together, not a fabricated backup filename.
        const backups = fs.readdirSync(data).filter(name => name.startsWith('medical.db.bak-'));
        assert.equal(backups.length, 1);
        assert.match(backups[0], /^medical\.db\.bak-\d{8}-\d{9}$/u);
        const backup = new Database(path.join(data, backups[0]), { readonly: true });
        try { assert.equal(backup.prepare('SELECT encrypted_master_key FROM users WHERE id = ?').pluck().get(account), wrapping); }
        finally { backup.close(); }
        const upgraded = openVersionedSqliteDatabase(path.join(data, 'medical.db'));
        try {
            upgraded.prepare('INSERT INTO users (id, username, password_hash, encrypted_master_key, salt) VALUES (?, ?, ?, ?, ?)')
                .run(account, account, 'synthetic-hash', 'v3:synthetic-passphrase', 'synthetic-new-salt');
            const retired = retirePinEraResidues(account, drizzle(upgraded), path.join(data, 'medical.db'));
            assert.deepEqual(retired.removed, sourceCase !== 'tracked-baseline' ? backups : []);
            assert.deepEqual(retired.kept, sourceCase !== 'tracked-baseline' ? [] : backups);
            assert.equal(retired.complete, sourceCase !== 'tracked-baseline', 'a v3 repair copy remains pending: live rows do not certify its obsolete cells');
            assert.equal(fs.existsSync(path.join(data, backups[0])), sourceCase === 'tracked-baseline');
        } finally { upgraded.close(); }
    } finally {
        if (owner.exitCode === null && owner.signalCode === null) { owner.kill('SIGTERM'); await closed; }
        fs.chmodSync(data, 0o700);
        fs.rmSync(root, { recursive: true, force: true });
    }
});
