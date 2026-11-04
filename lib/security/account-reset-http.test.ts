import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { openVersionedSqliteDatabase } from '../sqlite-schema-open';
import { readSqliteArchiveGeneration } from '../archive-generation';
import { ACCOUNT_RESET_JOURNAL_SUFFIX, type AccountResetReceipt } from './account-reset-journal';
import { loginWithWebAuthControl } from '../../scripts/web-auth-control-test-client.mjs';

const root = process.cwd();
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor<T>(read: () => Promise<T> | T): Promise<NonNullable<T>> {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        const value = await read();
        if (value) return value as NonNullable<T>;
        await pause(100);
    }
    throw new Error('HTTP reset fixture timeout');
}
async function freePort() {
    const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = (server.address() as net.AddressInfo).port; server.close(); await once(server, 'close'); return port;
}
function stop(child: ChildProcess) {
    try { process.kill(-child.pid!, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

// L'harness ferma il server con un segnale al gruppo di processi (PID negativo), che Windows non ha:
// lì il server resterebbe vivo. Il percorso del giornale è lo stesso su ogni sistema ed è provato da
// account-reset-journal.test.ts anche su Windows.
const POSIX_PROCESS_GROUPS = process.platform !== 'win32';

test('real Next HTTP reset survives SIGKILL at each durable boundary and refuses a failed copy',
    { timeout: 900000, skip: POSIX_PROCESS_GROUPS ? false : 'richiede i gruppi di processi POSIX' }, async t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-reset-http-'));
    const workspace = path.join(temporary, 'workspace'); fs.mkdirSync(workspace);
    for (const entry of ['app', 'components', 'lib', 'packages', 'scripts', 'drizzle', 'public', 'instrumentation.ts',
        'package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'postcss.config.mjs']) {
        if (fs.existsSync(path.join(root, entry))) fs.cpSync(path.join(root, entry), path.join(workspace, entry), { recursive: true });
    }
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'));
    fs.writeFileSync(path.join(workspace, 'next.config.ts'), `export default { serverExternalPackages: ['@mediflow/web-auth-lifecycle-owner', 'pdfjs-dist', 'pm2'] };`);
    const modulePath = path.join(workspace, 'lib/security/account-reset-journal.ts');
    // Only the copied test workspace supplies the existing phase callback; the HTTP route and auth stay real.
    const source = fs.readFileSync(modulePath, 'utf8');
    const needle = 'options.onPhaseForTest?.(';
    assert.ok(source.includes(needle));
    fs.writeFileSync(modulePath, source.replaceAll(needle, 'testPhase(') + `
function testPhase(phase: AccountResetPhase) {
    const mode = process.env.MF_RESET_HTTP_PHASE;
    if (mode === 'copy-failed' && phase === 'intent') {
        const base = process.env.MEDIFLOW_DATA_DIR! + '/medical.db.reset-journal';
        const id = fs.readdirSync(base)[0];
        fs.mkdirSync(base + '/' + id + '/previous.db.partial');
    }
    if (phase === mode) {
        fs.writeFileSync(process.env.MF_RESET_HTTP_MARKER!, JSON.stringify({phase, pid: process.pid}));
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
}
`);
    const port = await freePort(); const base = `http://127.0.0.1:${port}`;
    try {
        for (const phase of ['intent', 'preserved', 'mutated', 'committed', 'recorded', 'copy-failed']) {
            await t.test(phase, async () => {
                const data = path.join(temporary, phase); fs.mkdirSync(data);
                const file = path.join(data, 'medical.db'); const marker = path.join(data, 'phase.json');
                const syntheticUsername = `synthetic-${randomUUID()}`;
                const credentials = { username: syntheticUsername, password: randomUUID() };
                const db = openVersionedSqliteDatabase(file);
                db.prepare(`INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt)
                    VALUES ('11111111-1111-4111-8111-111111111111',?,'admin',?,'synthetic-wrapping','synthetic-salt')`)
                    .run(credentials.username, bcrypt.hashSync(credentials.password, 10));
                const originalUsers = db.prepare('SELECT * FROM users').all();
                const generation = readSqliteArchiveGeneration(db);
                db.prepare("INSERT INTO patients(id,first_name,last_name,tax_code) VALUES ('synthetic-patient','Synthetic','Reset','SYNTHETIC-RESET')").run();
                db.close();
                const start = (mode: string) => {
                    const log = fs.openSync(path.join(data, mode ? 'server.log' : 'restart.log'), 'a');
                    const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', workspace,
                        '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { detached: true,
                        stdio: ['ignore', log, log], env: { ...process.env, MEDIFLOW_DATA_DIR: data, MF_RESET_HTTP_PHASE: mode,
                            MF_RESET_HTTP_MARKER: marker, NEXT_TELEMETRY_DISABLED: '1', MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' } });
                    fs.closeSync(log); return child;
                };
                const ready = () => waitFor(async () => {
                    try { const r = await fetch(base + '/api/auth/check', { signal: AbortSignal.timeout(1000) }); return r.status === 200; }
                    catch { return false; }
                });
                let child = start(phase);
                try {
                    await ready();
                    const auth = await loginWithWebAuthControl(base, credentials);
                    assert.equal(auth.response.status, 200, JSON.stringify(auth.json));
                    assert.ok(auth.webHeaders);
                    assert.ok(auth.webHeaders.Cookie);
                    const pending = fetch(base + '/api/auth/reset', { method: 'POST', headers: { Cookie: auth.webHeaders.Cookie, 'x-mediflow-archive-generation': auth.webHeaders['x-mediflow-archive-generation'],
                        Origin: base, 'Sec-Fetch-Site': 'same-origin' }, signal: AbortSignal.timeout(120000) }).catch(() => null);
                    if (phase === 'copy-failed') {
                        const response = await pending; assert.equal(response?.status, 500);
                        const body = await response!.json(); assert.ok(body.receipt); assert.equal(body.receipt.outcome, 'aborted');
                        stop(child); await once(child, 'exit'); child = start(''); await ready();
                    } else {
                        const reached = await waitFor(() => fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')));
                        assert.equal(reached.phase, phase);
                        process.kill(reached.pid, 'SIGKILL');
                        stop(child); await once(child, 'exit'); await pending;
                        child = start(''); await ready();
                    }
                    const after = await loginWithWebAuthControl(base, credentials);
                    assert.equal(after.response.status, ['committed', 'recorded'].includes(phase) ? 401 : 200);
                    const probe = new Database(file, { readonly: true });
                    try {
                        const completed = phase === 'committed' || phase === 'recorded';
                        assert.deepEqual(probe.prepare('SELECT * FROM users').all(), completed ? [] : originalUsers);
                        assert.equal(readSqliteArchiveGeneration(probe) === generation, !completed);
                        assert.ok(probe.prepare("SELECT 1 FROM patients WHERE id='synthetic-patient'").get());
                        const journal = file + ACCOUNT_RESET_JOURNAL_SUFFIX; const ids = fs.readdirSync(journal); assert.equal(ids.length, 1);
                        const folder = path.join(journal, ids[0]);
                        const outcome = JSON.parse(fs.readFileSync(path.join(folder, 'outcome.json'), 'utf8')) as AccountResetReceipt;
                        assert.equal(outcome.outcome, completed ? 'completed' : 'aborted');
                        assert.equal(outcome.reconciled, !['recorded', 'copy-failed'].includes(phase));
                        if (!['intent', 'copy-failed'].includes(phase)) {
                            const previous = path.join(folder, 'previous.db'); const copy = new Database(previous, { readonly: true });
                            try { assert.deepEqual(copy.prepare('SELECT * FROM users').all(), originalUsers); assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok'); }
                            finally { copy.close(); }
                            const preserved = JSON.parse(fs.readFileSync(path.join(folder, 'preserved.json'), 'utf8'));
                            assert.equal(createHash('sha256').update(fs.readFileSync(previous)).digest('hex'), preserved.sha256);
                        }
                    } finally { probe.close(); }
                } finally { stop(child); if (child.exitCode === null && child.signalCode === null) await once(child, 'exit'); }
            });
        }
    } finally {
        // Retain failure logs outside Git; remove only the owned source/build workspace.
        fs.rmSync(workspace, { recursive: true, force: true });
        console.log(`HTTP reset evidence: ${temporary}`);
    }
});
