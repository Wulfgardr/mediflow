import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const load = createRequire(import.meta.url);
const data = mkdtempSync(join(tmpdir(), 'mediflow-command-process-'));
process.env.MEDIFLOW_DATA_DIR = data;
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { users, patients, therapies } = load('./schema.ts') as typeof import('./schema.ts');
const { bindSyntheticArchiveSessions } = load('./security/web-auth-lifecycle-owner-test-fixture.ts') as typeof import('./security/web-auth-lifecycle-owner-test-fixture.ts');
const generation = bindSyntheticArchiveSessions('synthetic-process-session');
const syntheticUsername = 'synthetic-process';
const session = { id: 'synthetic-process-session', userId: 'synthetic-process-actor', username: syntheticUsername, role: 'admin', authChannel: 'web', expiresAt: Date.now() + 600000, createdAt: Date.now() };
dbServer.insert(users).values({ id: session.userId, username: session.username, role: 'admin', passwordHash: 'synthetic', salt: 'synthetic', encryptedMasterKey: 'synthetic' }).run();
const sql = openDbServer();
const script = join(data, 'synthetic-command-child.ts');
writeFileSync(script, `import fs from 'node:fs'; import {createRequire} from 'node:module'; const load=createRequire(${JSON.stringify(import.meta.url)});
const {openDbServer}=load(${JSON.stringify(resolve('lib/db-server.ts'))}); const db=openDbServer();
const service=load(${JSON.stringify(resolve('lib/therapy-status-command-service.ts'))});
const input=JSON.parse(process.env.SYNTHETIC_COMMAND_INPUT); const actor=JSON.parse(process.env.SYNTHETIC_COMMAND_SESSION); const {issueSyntheticWebSession}=load(${JSON.stringify(resolve('lib/security/web-auth-lifecycle-owner-test-fixture.ts'))}); const session=issueSyntheticWebSession({id:actor.userId,username:actor.username,role:'admin'},'command-child');
const sleep=()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
function stop(stage){if(process.env.SYNTHETIC_BARRIER===stage){process.stdout.write('BARRIER:'+stage+'\\n'); while(!fs.existsSync(process.env.SYNTHETIC_RELEASE))sleep();}}
const prepare=db.prepare.bind(db); db.prepare=(source)=>{ const stmt=prepare(source); const run=stmt.run.bind(stmt); stmt.run=(...args)=>{const result=run(...args); if(/^update ["\x60]?therapies/i.test(source))stop('after_update'); if(/^insert into ["\x60]?audit_events/i.test(source))stop('after_audit'); if(/^insert into ["\x60]?therapy_status_commands/i.test(source))stop('after_receipt'); if(/^COMMIT$/i.test(source))stop('after_commit'); return result;};return stmt;};
process.stdout.write('READY\\n');while(!fs.existsSync(process.env.SYNTHETIC_START))sleep();stop('before_begin');
const result=process.env.SYNTHETIC_OPERATION==='close'?service.closeTherapyStatusCommand(session,input):service.executeTherapyStatusCommand(session,input);stop('after_commit');process.stdout.write('RESULT:'+JSON.stringify(result)+'\\n');db.close();`);
function fixture() {
    const patientId = randomUUID(), therapyId = randomUUID();
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: randomUUID() }).run();
    dbServer.insert(therapies).values({ id: therapyId, patientId, drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', status: 'active', version: 1, startDate: new Date() }).run();
    return { commandId: randomUUID(), protocol: 'therapy.status.change.v1', archiveGeneration: generation, patientId, therapyId, expectedVersion: 1 };
}
function child(command: ReturnType<typeof fixture>, op: 'execute' | 'close', barrier = '') {
    const start = join(data, randomUUID()), release = join(data, randomUUID()); let output = '', errors = '';
    const processChild = spawn(process.execPath, ['--experimental-strip-types', '--import', pathToFileURL(resolve('scripts/register-strip-types-loader.mjs')).href, script],
        { cwd: resolve('.'), env: { ...process.env, MEDIFLOW_DATA_DIR: data, SYNTHETIC_COMMAND_SESSION: JSON.stringify(session), SYNTHETIC_COMMAND_INPUT: JSON.stringify(op === 'execute' ? { ...command, target: 'suspended' } : command), SYNTHETIC_OPERATION: op, SYNTHETIC_BARRIER: barrier, SYNTHETIC_START: start, SYNTHETIC_RELEASE: release }, stdio: ['ignore', 'pipe', 'pipe'] });
    processChild.stdout.on('data', chunk => { output += chunk; }); processChild.stderr.on('data', chunk => { errors += chunk; });
    const exited = new Promise<{ code: number | null; signal: string | null }>(yes => processChild.once('exit', (code, signal) => yes({ code, signal })));
    async function wait(text: string) { const deadline = Date.now() + 8000; while (!output.includes(text)) { if (Date.now() > deadline || processChild.exitCode !== null) throw new Error('Child boundary missing: ' + text + ' ' + errors + output); await new Promise(yes => setTimeout(yes, 5)); } }
    return { process: processChild, wait, start: () => writeFileSync(start, ''), release: () => writeFileSync(release, ''), exited,
        result: () => JSON.parse(output.split('\n').find(line => line.startsWith('RESULT:'))!.slice(7)) as { outcome: string } };
}
function check(command: ReturnType<typeof fixture>) {
    return { version: (sql.prepare('SELECT version FROM therapies WHERE id=?').get(command.therapyId) as {version:number}).version,
        audits: (sql.prepare('SELECT count(*) AS n FROM audit_events WHERE subject_ref=?').get(command.therapyId) as {n:number}).n,
        receipt: sql.prepare('SELECT outcome FROM therapy_status_commands WHERE command_id=?').get(command.commandId) as {outcome:string} | undefined };
}
const owned = new Set<ChildProcess>();
for (const stage of ['before_begin', 'after_update', 'after_audit', 'after_receipt', 'after_commit']) test(`real child crash ${stage}: receipt and effect atomic`, async () => {
    const command = fixture(), run = child(command, 'execute', stage); owned.add(run.process);
    await run.wait('READY'); run.start(); await run.wait('BARRIER:' + stage); run.process.kill('SIGKILL'); await run.exited; owned.delete(run.process);
    assert.deepEqual(check(command), stage === 'after_commit' ? { version: 2, audits: 1, receipt: { outcome: 'applied' } } : { version: 1, audits: 0, receipt: undefined });
});
for (const first of ['execute', 'close'] as const) test(`two processes ${first} holds writer lock; other operation serializes`, async () => {
    const command = fixture(), a = child(command, first, 'after_receipt'); owned.add(a.process);
    await a.wait('READY'); a.start(); await a.wait('BARRIER:after_receipt');
    const b = child(command, first === 'execute' ? 'close' : 'execute'); owned.add(b.process);
    // B can wait in versioned schema admission while A owns the writer lock.
    await new Promise(yes => setTimeout(yes, 100)); a.release(); assert.equal((await a.exited).code, 0); owned.delete(a.process);
    await b.wait('READY'); b.start(); assert.equal((await b.exited).code, 0); owned.delete(b.process);
    const expected = first === 'execute' ? 'applied' : 'closed'; assert.equal(a.result().outcome, expected); assert.equal(b.result().outcome, expected);
    assert.deepEqual(check(command), { version: first === 'execute' ? 2 : 1, audits: first === 'execute' ? 1 : 0, receipt: { outcome: expected } });
});
for (const sameId of [true, false]) test(`two simultaneous execute processes ${sameId ? 'same ID' : 'distinct IDs same CAS'} have at most one effect`, async () => {
    const command = fixture(), bCommand = sameId ? command : { ...command, commandId: randomUUID() };
    const a = child(command, 'execute'), b = child(bCommand, 'execute'); owned.add(a.process); owned.add(b.process);
    await Promise.all([a.wait('READY'), b.wait('READY')]); a.start(); b.start();
    assert.equal((await a.exited).code, 0); assert.equal((await b.exited).code, 0); owned.delete(a.process); owned.delete(b.process);
    assert.equal(check(command).version, 2); assert.equal(check(command).audits, 1);
    assert.deepEqual([a.result().outcome, b.result().outcome].sort(), sameId ? ['applied', 'applied'] : ['applied', 'rejected']);
});
test.after(() => { for (const child of owned) child.kill('SIGKILL'); dbServer.$client.close(); });
