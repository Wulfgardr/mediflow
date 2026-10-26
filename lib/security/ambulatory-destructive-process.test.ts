import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { openVersionedSqliteDatabase } from '../sqlite-schema-open';
import type { AmbulatoryCommandMarker } from '../ambulatory-destructive-command-contract';

const observations: unknown[] = [];
test.after(() => { if (process.env.MEDIFLOW_AMBULATORY_PROCESS_REPORT) writeFileSync(process.env.MEDIFLOW_AMBULATORY_PROCESS_REPORT, JSON.stringify(observations, null, 2)); });
const active = new Set<{ child: ReturnType<typeof spawn>; completion: Promise<{code: unknown; signal: unknown}> }>();
test.afterEach(async () => { await Promise.all([...active].map(async worker => { worker.child.kill('SIGTERM'); await worker.completion; })); });

type Action = 'clear' | 'delete' | 'close' | 'read' | 'assign' | 'child' | 'default';
function fixture(patient = false, defaultTarget = false) {
    const data = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'command-process-')), file = join(data, 'medical.db');
    const db = openVersionedSqliteDatabase(file);
    db.prepare('INSERT INTO ambulatories(id,name,type,is_default,created_at) VALUES (?,?,?,?,?)').run('scope', 'Sede inventata', 'live', defaultTarget ? 0 : 1, 1);
    db.prepare('INSERT INTO ambulatories(id,name,type,is_default,created_at) VALUES (?,?,?,?,?)').run('target', 'Test inventato', 'test', defaultTarget ? 1 : 0, 3);
    if (defaultTarget) db.prepare('INSERT INTO ambulatories(id,name,type,is_default,created_at) VALUES (?,?,?,?,?)').run('fallback', 'Altra inventata', 'live', 0, 2);
    if (patient) {
        db.prepare("INSERT INTO patients(id,first_name,last_name,tax_code,version) VALUES ('race-patient','Synthetic','Race','SYNTHETIC-RACE',1)").run();
        db.prepare("INSERT INTO patients_to_ambulatories(patient_id,ambulatory_id) VALUES ('race-patient','target')").run();
    }
    db.close(); return { data, file };
}
function worker(data: string, input: { action: Action; marker?: AmbulatoryCommandMarker; gate?: string; crash?: string }) {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--import', pathToFileURL(resolve('scripts/register-strip-types-loader.mjs')).href,
        resolve('scripts/fixtures/ambulatory-destructive-process.ts'), JSON.stringify(input)], { env: { ...process.env, MEDIFLOW_DATA_DIR: data }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '', finished = false;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { errors += value; });
    const entry = { child, completion: Promise.resolve({ code: null as unknown, signal: null as unknown }) };
    const completion = once(child, 'close').then(([code, signal]) => { finished = true; active.delete(entry); return { code, signal }; });
    entry.completion = completion; active.add(entry);
    async function line(prefix: string) {
        const deadline = Date.now() + 15_000;
        while (!output.split('\n').some(row => row.startsWith(prefix))) {
            if (finished || Date.now() > deadline) throw new Error(`Synthetic worker missing ${prefix}: ${output}\n${errors}`);
            await delay(10);
        }
        return output.split('\n').find(row => row.startsWith(prefix))!.slice(prefix.length);
    }
    return { child, line, completion, go: () => child.stdin.end('GO\n'),
        async result() { const value = JSON.parse(await line('RESULT ')); const status = await completion; assert.equal(status.code, 0, errors); return value; } };
}
function state(file: string) {
    const db = openVersionedSqliteDatabase(file);
    try {
        return { rows: db.prepare('SELECT id,version,is_default,parent_id FROM ambulatories ORDER BY id').all() as Array<Record<string, unknown>>,
            patients: db.prepare('SELECT id,version,deleted_at FROM patients ORDER BY id').all() as Array<Record<string, unknown>>,
            memberships: db.prepare('SELECT patient_id,ambulatory_id FROM patients_to_ambulatories ORDER BY patient_id,ambulatory_id').all(),
            audit: db.prepare("SELECT event_type,subject_ref FROM audit_events WHERE event_type LIKE 'ambulatory.%' OR event_type LIKE 'patient.%' ORDER BY rowid").all(),
            ledger: db.prepare('SELECT command_id,outcome FROM ambulatory_destructive_commands ORDER BY command_id').all() as Array<{command_id: string;outcome: string}> };
    } finally { db.close(); }
}

for (const action of ['assign', 'child', 'default', 'close'] as const) for (const first of ['command', 'other'] as const) {
    test(`two SQLite processes ${action} ${first}-first serialize against the exact prepared command`, { timeout: 30_000 }, async () => {
        const f = fixture(action === 'assign', action === 'default'), gate = join(f.data, 'release-owned-writer');
        const commandAction: Action = action === 'assign' || action === 'close' ? 'clear' : 'delete';
        const command = worker(f.data, { action: commandAction, ...(first === 'command' ? { gate } : {}) });
        const ready = JSON.parse(await command.line('READY '));
        const other = worker(f.data, { action, marker: action === 'close' ? ready.marker : undefined, ...(first === 'other' ? { gate } : {}) });
        await other.line('READY ');
        const leading = first === 'command' ? command : other, trailing = first === 'command' ? other : command;
        leading.go(); await leading.line('HELD'); trailing.go(); await trailing.line('ATTEMPT'); writeFileSync(gate, 'release');
        const [a, b] = await Promise.all([command.result(), other.result()]);
        observations.push({ action, first, a, b, state: state(f.file) });
        assert.notEqual(a.pid, b.pid); assert.equal((first === 'command' ? a : b).held, true);
        const current = state(f.file), receipt = a.result.value.receipt;
        if (action === 'close') {
            assert.equal(receipt.outcome, first === 'command' ? 'applied' : 'closed');
            assert.deepEqual(b.result.value.receipt, receipt); assert.equal(current.ledger.length, 1);
            assert.equal(current.rows.find(row => row.id === 'target')!.version, first === 'command' ? 2 : 1);
        } else if (first === 'command') {
            assert.equal(receipt.outcome, 'applied');
            assert.equal(b.result.status, action === 'default' ? 409 : 404);
            assert.equal(current.audit.length, action === 'assign' || action === 'default' ? 2 : 1);
        } else {
            assert.equal(receipt.outcome, 'rejected');
            assert.equal(b.result.status, action === 'child' ? 201 : 200);
            assert.equal(current.audit.length, action === 'default' ? 2 : 1);
            assert.ok(current.rows.some(row => row.id === 'target'));
        }
        if (action === 'assign') assert.equal(current.patients[0].deleted_at === null, first === 'other');
        if (action === 'child') assert.equal(current.rows.some(row => row.id === 'race-child'), first === 'other');
    });
}

for (const phase of ['before-begin', 'before-update', 'after-update', 'after-audit', 'after-receipt', 'after-commit']) {
    test(`real process crash ${phase} recovers only by read/close without re-execution`, { timeout: 30_000 }, async () => {
        const f = fixture(true), command = worker(f.data, { action: 'clear', crash: phase });
        const { marker } = JSON.parse(await command.line('READY ')); command.go();
        assert.equal((await command.completion).code, 77);
        const committed = phase === 'after-commit', current = state(f.file);
        observations.push({ phase, committed, state: current });
        assert.equal(current.ledger.length, committed ? 1 : 0);
        assert.equal(current.audit.length, committed ? 2 : 0);
        assert.equal(current.rows.find(row => row.id === 'target')!.version, committed ? 2 : 1);
        assert.equal(current.patients[0].deleted_at === null, !committed);
        const read = worker(f.data, { action: 'read', marker }); await read.line('READY '); read.go();
        const result = await read.result(); assert.equal(result.result.value.outcome, committed ? 'terminal' : 'unknown');
        assert.deepEqual(state(f.file), current, 'recovery read must never execute the old command');
        if (!committed) {
            const close = worker(f.data, { action: 'close', marker }); await close.line('READY '); close.go();
            assert.equal((await close.result()).result.value.receipt.outcome, 'closed');
            const after = state(f.file); assert.equal(after.audit.length, 0); assert.equal(after.ledger.length, 1);
            assert.equal(after.rows.find(row => row.id === 'target')!.version, 1);
        }
    });
}
