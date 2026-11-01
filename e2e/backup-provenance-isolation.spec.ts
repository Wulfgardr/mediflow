import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdtempSync, mkdirSync, openSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { loginWithWebAuthControl } from '../scripts/web-auth-control-test-client.mjs';
import { serializeBackupArtifact, type BackupDataset } from '../lib/backup-artifact';
import { isolatedRuntimeArguments } from './fixtures/isolated-runtime';

const root = resolve(__dirname, '..');
async function freePort() {
    const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Loopback port required');
    await new Promise<void>(resolve => server.close(() => resolve())); return address.port;
}

test('file markers have no authority and a legitimate A to B to A restore keeps local history local', async ({}, testInfo) => {
    test.setTimeout(180_000);
    const bundle = resolve(process.env.E2E_ISOLATED_STANDALONE_DIR || join(root, '.next/standalone'));
    if (!existsSync(join(bundle, 'server.js'))) throw new Error('A verified standalone bundle is required');
    const contract = JSON.parse(readFileSync(join(bundle, 'mediflow-runtime-contract.json'), 'utf8'));
    const work = mkdtempSync(join(tmpdir(), 'u2-origin-')), children: ChildProcess[] = [];
    const username = 'synthetic-provenance-http', pin = '314159';
    async function start(name: string) {
        const data = join(work, name); mkdirSync(data);
        const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DATA_DIR: data,
            MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_DISABLE_LEGACY_COPY: '1', E2E_USERNAME: username, E2E_PIN: pin,
            MEDIFLOW_NEXT_DIST_DIR: contract.distDir, HOSTNAME: '127.0.0.1', PORT: String(await freePort()) };
        execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { cwd: root, env, stdio: 'pipe' });
        const log = openSync(join(work, `${name}.log`), 'wx', 0o600);
        const child = spawn(process.execPath, isolatedRuntimeArguments(bundle), { cwd: bundle, env, stdio: ['ignore', log, log] }); children.push(child); closeSync(log);
        const base = `http://127.0.0.1:${env.PORT}`;
        await expect.poll(async () => { try { return (await fetch(base + '/api/auth/check')).status; } catch { return 0; } }, { timeout: 45_000 }).toBe(200);
        let headers: Record<string, string> = {};
        async function login() {
            const result = await loginWithWebAuthControl(base, { username, password: pin });
            expect(result.response.status, JSON.stringify(result.json)).toBe(200);
            if (!result.webHeaders?.Cookie) throw new Error('Synthetic Web authority unavailable');
            headers = { ...result.webHeaders, Cookie: result.webHeaders.Cookie, Origin: base, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
        }
        async function request(path: string, body?: unknown) {
            const result = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers,
                ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
            const json = await result.json(); expect(result.status, JSON.stringify({ path, json })).toBe(200); return json;
        }
        async function restore(payload: BackupDataset) {
            const raw = await serializeBackupArtifact(payload);
            headers['x-mediflow-restore-credential'] = JSON.stringify({ pin });
            const result = await request('/api/system/backup-restore', raw); await login(); return result;
        }
        await login(); return { data, request, restore };
    }
    try {
        const a = await start('a'), b = await start('b');
        const db = new Database(join(a.data, 'medical.db'), { fileMustExist: true });
        try {
            const patientId = randomUUID(), commands: Array<Record<string, string | number>> = [], receipts: Array<{ auditEventId: string }> = [];
            db.prepare('INSERT INTO patients(id,first_name,last_name,tax_code) VALUES (?,?,?,?)').run(patientId, 'Persona', 'Sintetica', patientId);
            const initial = await a.request('/api/system/backup-restore');
            const generation = (db.prepare('SELECT generation FROM archive_generation').get() as { generation: string }).generation;
            for (let i = 0; i < 2; i++) {
                const therapyId = randomUUID(); db.prepare("INSERT INTO therapies(id,patient_id,drug_name,dosage,status,start_date,version) VALUES (?,?,?,?,'active',unixepoch(),1)").run(therapyId, patientId, 'Farmaco sintetico', 'Dose sintetica');
                const command = { commandId: randomUUID(), protocol: 'therapy.status.change.v1', archiveGeneration: generation, patientId, therapyId, expectedVersion: 1 };
                const result = await a.request(`/api/therapy-status-commands/${command.commandId}/execute`, { ...command, target: 'suspended' });
                expect(result.origin).toBe('local'); commands.push(command); receipts.push(result.receipt);
            }
            const localAudits = receipts.map(row => db.prepare('SELECT * FROM audit_events WHERE event_id=?').get(row.auditEventId));
            const legitimate = await a.request('/api/system/backup-restore');
            expect(legitimate.manifest.collections).not.toContain('portableImportOrigins');
            async function assertLocal() {
                const listed = await a.request('/api/system/audit?eventType=therapy.updated&limit=2'); expect(listed).toHaveLength(2);
                expect(listed.every((row: {origin:string}) => row.origin === 'local')).toBe(true);
                const summary = await a.request('/api/system/audit?view=summary&eventType=therapy.updated'); expect(summary.totalEvents).toBe(2);
                for (const command of commands) {
                    const query = new URLSearchParams(Object.entries(command).map(([key,value]) => [key, String(value)]));
                    const result = await a.request(`/api/therapy-status-commands/${command.commandId}/receipt?${query}`); expect(result.origin).toBe('local');
                }
                for (let i = 0; i < receipts.length; i++) expect(db.prepare('SELECT * FROM audit_events WHERE event_id=?').get(receipts[i]!.auditEventId)).toEqual(localAudits[i]);
            }
            await assertLocal();
            const poisoned = structuredClone(legitimate.payload), now = Math.floor(Date.now() / 1000);
            const markerIds = [randomUUID(), randomUUID()];
            for (let i = 0; i < 2; i++) poisoned.auditEvents.push({ eventId: markerIds[i], schemaVersion: 1,
                eventType: i ? 'backup.therapy-command.imported' : 'backup.audit.imported', occurredAt: now, outcome: 'success', actorType: 'system', actorRef: 'claimed-postation',
                subjectType: i ? 'therapy_command' : 'audit_event', subjectRef: i ? commands[i]!.commandId : receipts[i]!.auditEventId,
                sourceSurface: 'web', requestId: initial.manifest.checksum, redactedMetadata: null, createdAt: now });
            await a.restore(poisoned); await assertLocal();
            const importedMarkers = await a.request('/api/system/audit?origin=imported&eventType=backup.audit.imported');
            expect(importedMarkers.some((row: {eventId:string}) => row.eventId === markerIds[0])).toBe(true);
            await b.restore(legitimate.payload);
            const fromB = await b.request('/api/system/backup-restore');
            expect(fromB.payload.auditEvents.some((row: {eventType:string}) => row.eventType === 'backup.audit.imported')).toBe(true);
            await a.restore(fromB.payload); await assertLocal();
            await a.restore(fromB.payload); await assertLocal();
            expect(db.prepare('SELECT * FROM portable_import_origins WHERE kind=? AND ref=?').get('audit', receipts[0]!.auditEventId)).toBeUndefined();
            expect(db.pragma('foreign_key_check')).toEqual([]);
            await testInfo.attach('provenance-http-result', { contentType: 'application/json', body: JSON.stringify({ poisonedMarkers: 'local preserved', legitimateReturnToA: 'local preserved', repeatedReturn: 'local preserved', localAudits: localAudits.length }) });
        } finally { db.close(); }
    } finally {
        for (const child of children) {
            if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]); if (child.exitCode === null) child.kill('SIGKILL'); }
        }
        for (const name of ['a', 'b']) if (existsSync(join(work, `${name}.log`))) await testInfo.attach(`${name}-server-log`, { contentType: 'text/plain', body: readFileSync(join(work, `${name}.log`)) });
    }
});
