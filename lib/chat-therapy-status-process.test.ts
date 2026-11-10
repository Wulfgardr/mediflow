import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TherapyStatusExecute } from './therapy-status-command-contract';

type Reply = { status: number; body: Record<string, any> };
type Request = { id: string; operation: string; command?: TherapyStatusExecute; barrier?: string; loseResponse?: boolean };
const load = createRequire(import.meta.url);
const childMode = process.env.MEDIFLOW_CHAT_CRASH_CHILD === '1';

async function host() {
    const data = process.env.MEDIFLOW_DATA_DIR!;
    assert.ok(data);
    const { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } = load('./network-patient-authority-test-fixture.ts') as typeof import('./network-patient-authority-test-fixture');
    const cookies = { cookies: new Map<string, string>() };
    installNetworkPatientCookieFixture(data, cookies);
    const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
    const sql = openDbServer();
    const { ambulatories, patients, patientsToAmbulatories, therapies } = load('./schema.ts') as typeof import('./schema');
    const { currentArchiveGeneration } = load('./security/archive-session-generation.ts') as typeof import('./security/archive-session-generation');
    const manifest = join(data, 'fixture.json');
    let fixture: { scope: string; command: TherapyStatusExecute };
    if (existsSync(manifest)) fixture = JSON.parse(readFileSync(manifest, 'utf8'));
    else {
        const scope = randomUUID(), patientId = randomUUID(), therapyId = randomUUID();
        dbServer.insert(ambulatories).values({ id: scope, name: 'Synthetic', isDefault: true }).run();
        dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: randomUUID() }).run();
        dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: scope }).run();
        dbServer.insert(therapies).values({ id: therapyId, patientId, drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', status: 'active', version: 1, startDate: new Date() }).run();
        fixture = { scope, command: { commandId: randomUUID(), protocol: 'therapy.status.change.v1', archiveGeneration: currentArchiveGeneration(), patientId, therapyId, expectedVersion: 1, target: 'suspended' } };
        writeFileSync(manifest, JSON.stringify(fixture));
    }
    const context = syntheticNetworkPatientAuthority(dbServer, fixture.scope, { capabilities: ['network.replica.readonly-therapies', 'network.replica.write-therapies', 'network.replica.readonly-patients'] });
    sql.prepare('UPDATE users SET password_hash=? WHERE id=?').run(load('bcryptjs').hashSync('2468', 4), context.session.userId);
    cookies.cookies.set('ambulatory_id', fixture.scope);
    cookies.cookies.set('mediflow_session', context.session.id);
    const { nativeProfileSelectionOwner } = load('./security/native-profile-selection-owner.ts') as typeof import('./security/native-profile-selection-owner');
    const owner = nativeProfileSelectionOwner.registry.acquire(context.session);
    owner.issueSelection({ expectedEpoch: 0, patientId: fixture.command.patientId, ambulatoryId: fixture.scope });
    const epoch = owner.snapshotSelectionEpoch(context.session);
    const route = load('../app/api/auth/native/therapy-status/route.ts') as typeof import('../app/api/auth/native/therapy-status/route');
    const { issueSyntheticWebSession } = load('./security/web-auth-lifecycle-owner-test-fixture.ts') as typeof import('./security/web-auth-lifecycle-owner-test-fixture');
    const web = issueSyntheticWebSession({ id: context.session.userId, username: context.session.username, role: 'admin' }, randomUUID());
    const { executeTherapyStatusCommand } = load('./therapy-status-command-service.ts') as typeof import('./therapy-status-command-service');
    let barrier = '';
    const sleep = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    function stop(stage: string) {
        if (barrier !== stage) return;
        process.send!({ barrier: stage });
        while (!existsSync(join(data, 'release'))) sleep();
    }
    // Same SQL barriers as therapy-status-command-process.test.ts, with the native route as caller.
    const prepare = sql.prepare.bind(sql);
    sql.prepare = (source: string) => {
        const stmt = prepare(source), run = stmt.run.bind(stmt);
        stmt.run = (...args: unknown[]) => {
            const result = run(...args);
            if (/^update ["`]?therapies/i.test(source)) stop('after_update');
            if (/^insert into ["`]?audit_events/i.test(source)) stop('after_audit');
            if (/^insert into ["`]?therapy_status_commands/i.test(source)) stop('after_receipt');
            return result;
        };
        return stmt;
    };
    const transaction = dbServer.transaction.bind(dbServer);
    dbServer.transaction = (...args: Parameters<typeof transaction>) => {
        stop('after_confirmation');
        const result = transaction(...args);
        stop('after_commit');
        return result;
    };
    async function invoke(body: unknown): Promise<Reply> {
        const headers = new Headers(context.request.headers);
        headers.set('x-mediflow-expected-ambulatory-id', fixture.scope);
        const response = await route.POST(new globalThis.Request('http://127.0.0.1/api/auth/native/therapy-status', { method: 'POST', headers, body: JSON.stringify(body) }));
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        return { status: response.status, body: await response.json() };
    }
    process.on('message', async (message: Request) => {
        try {
            const command = message.command ?? fixture.command;
            let result: unknown;
            if (message.operation === 'preview') {
                const opened = await invoke({ operation: 'open', patientId: command.patientId, selectionEpoch: epoch });
                assert.equal(opened.status, 200);
                result = await invoke({ operation: 'preview', command, selectionEpoch: epoch, viewId: opened.body.viewId });
            } else if (message.operation === 'inspect') {
                result = {
                    therapy: sql.prepare('SELECT version,status FROM therapies WHERE id=?').get(command.therapyId),
                    audits: sql.prepare('SELECT event_id AS id FROM audit_events WHERE subject_ref=?').all(command.therapyId),
                    receipts: sql.prepare('SELECT command_id,outcome,reason,result_version,audit_event_id FROM therapy_status_commands WHERE therapy_id=? ORDER BY command_id').all(command.therapyId),
                };
            } else {
                barrier = message.barrier ?? '';
                if (message.operation === 'execute' || message.operation === 'web') stop('before_begin');
                result = message.operation === 'web'
                    ? { status: 200, body: executeTherapyStatusCommand(web, command) }
                    : await invoke({ operation: message.operation, commandId: command.commandId, ...(message.operation === 'execute' ? { pin: '2468' } : {}) });
                barrier = '';
            }
            if (message.loseResponse) process.send!({ lost: message.id });
            else process.send!({ id: message.id, result });
        } catch (error) { process.send!({ id: message.id, error: String(error) }); }
    });
    process.send!({ ready: fixture });
}

if (childMode) await host();
else {
    const owned = new Set<ChildProcess>();
    async function start(data = mkdtempSync(join(tmpdir(), 'mediflow-chat-crash-'))) {
        const child = spawn(process.execPath, ['--experimental-strip-types', '--import', pathToFileURL(resolve('scripts/register-strip-types-loader.mjs')).href, fileURLToPath(import.meta.url)], {
            cwd: resolve('.'), env: { ...process.env, MEDIFLOW_DATA_DIR: data, MEDIFLOW_CHAT_CRASH_CHILD: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        owned.add(child);
        let errors = '';
        child.stderr!.on('data', chunk => { errors += chunk; });
        const exit = new Promise<{ code: number | null; signal: string | null }>(resolve => child.once('exit', (code, signal) => { owned.delete(child); resolve({ code, signal }); }));
        function wait(predicate: (value: any) => boolean): Promise<any> {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => finish(new Error(`Child timeout: ${errors}`)), 12000);
                const died = () => finish(new Error(`Child exited: ${errors}`));
                const receive = (message: any) => { if (predicate(message)) finish(undefined, message); };
                function finish(error?: Error, message?: any) {
                    clearTimeout(timer); child.off('message', receive); child.off('exit', died);
                    if (error) reject(error); else resolve(message);
                }
                child.on('message', receive); child.once('exit', died);
            });
        }
        const { ready } = await wait(m => !!m.ready) as { ready: { scope: string; command: TherapyStatusExecute } };
        async function request(operation: string, command = ready.command, options: Partial<Request> = {}): Promise<any> {
            const id = randomUUID();
            const result = wait(m => m.id === id || m.lost === id);
            child.send({ id, operation, command, ...options });
            const response = await result;
            assert.equal(response.error, undefined);
            return response.lost ? undefined : response.result;
        }
        return { data, command: ready.command, child, wait, request, async kill() { child.kill('SIGKILL'); assert.equal((await exit).signal, 'SIGKILL'); } };
    }
    type Host = Awaited<ReturnType<typeof start>>;
    async function durable(host: Host, applied: boolean, command = host.command) {
        const observed = await host.request('inspect', command);
        assert.deepEqual(observed.therapy, { version: applied ? 2 : 1, status: applied ? 'suspended' : 'active' });
        assert.equal(observed.audits.length, applied ? 1 : 0);
        const row = observed.receipts.find((r: any) => r.command_id === command.commandId);
        assert.equal(row?.outcome, applied ? 'applied' : undefined);
        if (applied) {
            assert.equal(row.result_version, 2);
            assert.equal(row.audit_event_id, observed.audits[0].id);
        }
        return observed;
    }
    async function reread(host: Host, applied: boolean) {
        const reply = await host.request('receipt');
        assert.equal(reply.status, 200);
        if (!applied) assert.deepEqual(reply.body, { outcome: 'unknown' });
        else {
            assert.equal(reply.body.outcome, 'terminal');
            assert.equal(reply.body.receipt.commandId, host.command.commandId);
            assert.equal(reply.body.receipt.outcome, 'applied');
            assert.deepEqual(reply.body.current, { version: 2, status: 'suspended' });
            const observed = await durable(host, true);
            assert.equal(reply.body.receipt.auditEventId, observed.audits[0].id);
        }
        return reply;
    }
    for (const stage of ['before_begin', 'after_confirmation', 'after_update', 'after_audit', 'after_receipt', 'after_commit']) {
        test(`chat crash ${stage} resumes by receipt without execution`, async () => {
            const before = await start();
            assert.equal((await before.request('preview')).status, 200);
            const reached = before.wait(m => m.barrier === stage);
            before.child.send({ id: randomUUID(), operation: 'execute', barrier: stage });
            await reached;
            await before.kill();
            const after = await start(before.data);
            try {
                assert.equal(after.command.commandId, before.command.commandId);
                const applied = stage === 'after_commit';
                const initial = await durable(after, applied);
                await reread(after, applied);
                await reread(after, applied);
                assert.equal((await after.request('execute')).status, 403);
                assert.deepEqual(await after.request('inspect'), initial);
                await reread(after, applied);
            } finally { await after.kill(); }
        });
    }
    test('chat lost execute response is resolved only by receipt and replay keeps the original receipt', async () => {
        const host = await start();
        try {
            assert.equal((await host.request('preview')).status, 200);
            assert.equal(await host.request('execute', host.command, { loseResponse: true }), undefined);
            const initial = await durable(host, true);
            const receipt = await reread(host, true);
            assert.equal((await host.request('execute')).status, 403);
            assert.equal((await host.request('preview')).status, 403);
            assert.deepEqual(await reread(host, true), receipt);
            assert.deepEqual(await host.request('inspect'), initial);
        } finally { await host.kill(); }
    });
    for (const winner of ['chat', 'web']) test(`chat and web compete on the same version: ${winner} commits first`, async () => {
        const chat = await start();
        const web = await start(chat.data);
        try {
            const other = { ...chat.command, commandId: randomUUID() };
            assert.equal((await chat.request('preview')).status, 200);
            const first = winner === 'chat' ? chat : web, second = winner === 'chat' ? web : chat;
            const reached = first.wait(m => m.barrier === 'after_receipt');
            const a = first.request(winner === 'chat' ? 'execute' : 'web', winner === 'chat' ? chat.command : other, { barrier: 'after_receipt' });
            await reached;
            const b = second.request(winner === 'chat' ? 'web' : 'execute', winner === 'chat' ? other : chat.command);
            writeFileSync(join(chat.data, 'release'), 'release');
            assert.equal((await a).body.outcome, 'applied');
            assert.equal((await b).body.outcome, 'rejected');
            const observed = await chat.request('inspect');
            assert.deepEqual(observed.therapy, { version: 2, status: 'suspended' });
            assert.equal(observed.audits.length, 1);
            assert.equal(observed.receipts.length, 2);
            assert.deepEqual(observed.receipts.map((r: any) => r.outcome).sort(), ['applied', 'rejected']);
            const applied = observed.receipts.find((r: any) => r.outcome === 'applied');
            const rejected = observed.receipts.find((r: any) => r.outcome === 'rejected');
            assert.equal(applied.audit_event_id, observed.audits[0].id);
            assert.equal(applied.result_version, 2);
            assert.equal(rejected.reason, 'version_conflict');
            assert.equal(rejected.audit_event_id, null);
            const reply = await chat.request('receipt');
            assert.equal(reply.body.outcome, 'terminal');
            assert.equal(reply.body.receipt.commandId, chat.command.commandId);
            assert.equal(reply.body.receipt.outcome, winner === 'chat' ? 'applied' : 'rejected');
            assert.deepEqual(reply.body.current, observed.therapy);
            assert.equal((await chat.request('execute')).status, 403);
            assert.deepEqual(await chat.request('inspect'), observed);
        } finally { await chat.kill(); await web.kill(); }
    });
    test.after(async () => {
        await Promise.all([...owned].map(child => new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGKILL'); })));
    });
}
