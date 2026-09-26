/* @Codex: synthetic-only; no network, installer, model download or clinical DB. */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ATHENA_R1_QWEN3_8B_MODEL_ID } from '../../athena-model-identity.ts';
import { createPortableProvisioning, } from './treatment-reasoning-portable-provisioning.ts';

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn as actualSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createTreatmentReasoningPortableRuntime, PortableRuntimeError } from './treatment-reasoning-portable-runtime.ts';
const runtimeCode = (expected: string) => (e: unknown) => e instanceof PortableRuntimeError && e.code === expected;

// All payloads and version/revision strings below are SYNTHETIC. They are not
// model weights, runtime distributions, licenses or evidence of real inference.
function fixture(t: TestContext) {
    const base = process.env.MEDIFLOW_DATA_DIR;
    assert.ok(base, 'Set an explicit run-owned synthetic MEDIFLOW_DATA_DIR');
    fs.mkdirSync(base, { recursive: true });
    const dataDir = fs.mkdtempSync(path.join(base, 'portable unit-'));
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const root = path.join(dataDir, 'treatment-reasoning-portable');
    const incoming = path.join(root, 'incoming');
    const payloads: Record<string, string | Buffer> = {
        'model/config.json': JSON.stringify({ model_type: 'qwen3' }),
        'model/tokenizer.json': '{}', 'model/tokenizer_config.json': '{}',
        'model/model.safetensors': 'SYNTHETIC-NOT-WEIGHTS', 'model/LICENSE': 'SYNTHETIC LICENSE FIXTURE ONLY',
        'runtime/python': 'SYNTHETIC-NOT-EXECUTABLE', 'runtime/LICENSE': 'SYNTHETIC LICENSE FIXTURE ONLY',
        'worker/treatment-reasoning-portable-worker.py': fs.readFileSync(new URL('../../../scripts/treatment-reasoning-portable-worker.py', import.meta.url)),
    };
    const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
    const manifest = { schemaVersion: 'mediflow.treatment-portable-release.v1', provider: 'athena_transformers', model: ATHENA_R1_QWEN3_8B_MODEL_ID,
        modelRevision: 'a'.repeat(40), format: 'safetensors', platform: 'linux-x64', sourceRef: 'synthetic:source-only', approvalRef: 'synthetic:not-approved-for-use',
        runtime: { python: 'runtime/python', pythonVersion: '0.0.0', transformersVersion: '0.0.0', torchVersion: '0.0.0', sourceRef: 'synthetic:runtime-not-real' },
        licenses: { model: 'model/LICENSE', runtime: ['runtime/LICENSE'] }, limits: { memoryBytes: 8 * 1024 ** 3, threads: 1 },
        files: Object.entries(payloads).map(([name, bytes]) => ({ path: name, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) })),
    };
    for (const [name, bytes] of Object.entries(payloads)) { const f = path.join(incoming, 'artifacts', name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bytes); }
    const rewrite = () => { const bytes = JSON.stringify(manifest); fs.writeFileSync(path.join(incoming, 'release.json'), bytes); return sha(bytes); };
    const digest = rewrite();
    const service = createPortableProvisioning({ dataDir, platform: 'linux', arch: 'x64',
        hardware: () => ({ platform: 'linux', nodeArchitecture: 'x64', machineArchitecture: 'x86_64',
            totalMemoryBytes: 64 * 1024 ** 3, availableMemoryBytes: 60 * 1024 ** 3, logicalCpus: 8 }) });
    const admit = async () => { await service.importOffline({ consentDigest: digest }); await service.activate({ consentDigest: digest }); };
    return { dataDir, root, incoming, manifest, digest, rewrite, service, admit };
}

const instruction = 'task=treatment_reasoning\nSYNTHETIC-NO-PATIENT-CONTEXT';
const signal = Object.freeze({ isAborted: () => false });
const response = (content = '{}') => JSON.stringify({ schemaVersion: 'mediflow.treatment-portable-worker-result.v1', model: ATHENA_R1_QWEN3_8B_MODEL_ID, content });
function fakeChild(result: string | null, closeOnKill = true, delay = 0) {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        kill() { if (closeOnKill) queueMicrotask(() => child.emit('close', null, 'SIGKILL')); return true; } });
    child.stdin.on('finish', () => { if (result !== null) setTimeout(() => { child.stdout.write(result); child.emit('close', 0, null); }, delay); });
    return child as unknown as ChildProcessWithoutNullStreams;
}
test('inference never acquires/installs an artifact, and never launches when missing or unadmitted', async t => {
    const f = fixture(t); let spawned = 0; const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service, spawn: () => { spawned++; return fakeChild(response()); } });
    await assert.rejects(runtime.prepare(), runtimeCode('runtime_unavailable')); assert.equal(spawned, 0);
    assert.equal(f.service.status().state, 'model_not_provisioned');
    await f.service.importOffline({ consentDigest: f.digest });
    await assert.rejects(runtime.prepare(), runtimeCode('runtime_unavailable')); assert.equal(spawned, 0);
});
test('one-shot invocation uses isolated args, offline allowlisted environment and true local identity', async t => {
    const f = fixture(t); await f.admit(); let calls = 0;
    const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service, spawn: (command, args, options) => {
        calls++; assert.equal(command, path.join(f.root, 'objects', f.digest, 'artifacts/runtime/python'));
        assert.equal(args[0], '-I'); assert.equal(args[1], '-B'); assert.equal(args.length, 3);
        assert.equal(JSON.stringify(args).includes(instruction), false); assert.equal(options?.shell, false);
        assert.equal(options?.env?.NODE_ENV, 'production'); assert.equal(options?.env?.HF_HUB_OFFLINE, '1'); assert.equal(options?.env?.TRANSFORMERS_OFFLINE, '1');
        for (const name of ['PATH', 'HTTP_PROXY', 'OPENAI_API_KEY', 'HF_TOKEN', 'PYTHONPATH']) assert.equal(options?.env?.[name], undefined);
        return fakeChild(response());
    } });
    const ready = await runtime.prepare(); try {
        assert.equal(ready.metadata.provider, 'athena_transformers'); assert.equal(ready.metadata.artifactDigest, f.digest);
        assert.equal(await ready.invoke({ instruction, signal }), '{}'); assert.equal(ready.current(), true);
        await assert.rejects(ready.invoke({ instruction, signal }), runtimeCode('binding_stale'));
    } finally { ready.close(); }
    assert.equal(calls, 1);
});
test('single flight blocks concurrent preparation until the verified lease is closed', async t => {
    const f = fixture(t); await f.admit(); const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service });
    const first = await runtime.prepare(); await assert.rejects(runtime.prepare(), runtimeCode('runtime_busy')); first.close();
    const second = await runtime.prepare(); second.close();
});
test('authority lookup is deadline bounded even before process launch', async t => {
    const f = fixture(t); await f.admit(); let calls = 0;
    const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service, timeoutMs: 80, spawn: () => { calls++; return fakeChild(null); } });
    await assert.rejects(runtime.prepare({ verifyChoice: () => new Promise<void>(() => {}) }), runtimeCode('execution_timeout')); assert.equal(calls, 0);
});
test('malformed, wrong-engine, oversized and empty stdout never succeed', async t => {
    const f = fixture(t); await f.admit();
    for (const output of ['', '{', 'x'.repeat(65537), JSON.stringify({ schemaVersion: 'mediflow.treatment-portable-worker-result.v1', model: 'not-athena', content: '{}' })]) {
        const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service, spawn: () => fakeChild(output) });
        const ready = await runtime.prepare(); try { await assert.rejects(ready.invoke({ instruction, signal }), runtimeCode('provider_invalid')); } finally { ready.close(); }
    }
});
test('stderr is discarded and bounded; errors never include the raw process output', async t => {
    const f = fixture(t); await f.admit(); let child: ChildProcessWithoutNullStreams;
    const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service, spawn: () => {
        child = fakeChild(null); child.stdin.on('finish', () => child.stderr.emit('data', Buffer.alloc(16385, 'x'))); return child;
    } });
    const ready = await runtime.prepare(); try { await assert.rejects(ready.invoke({ instruction, signal }), runtimeCode('provider_failed')); } finally { ready.close(); }
});
test('controlled execution deadline kills the child and awaits close before releasing the slot', async t => {
    const f = fixture(t); await f.admit();
    // @Codex: isolate the child-termination transition from real filesystem latency.
    // Real provisioning still runs; separate tests retain real acquisition deadlines.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let kills = 0; let launched!: () => void;
    const started = new Promise<void>(resolve => { launched = resolve; });
    const child = fakeChild(null, false);
    child.kill = () => { kills++; return true; };
    child.stdin.once('finish', launched);
    const runtime = createTreatmentReasoningPortableRuntime({
        provisioning: f.service, timeoutMs: 100, spawn: () => child,
    });
    const ready = await runtime.prepare();
    let settled = false;
    const result = ready.invoke({ instruction, signal }).then(
        value => { settled = true; return { ok: true as const, value }; },
        failure => { settled = true; return { ok: false as const, failure }; },
    );
    try {
        await started;
        t.mock.timers.tick(99); assert.equal(kills, 0);
        t.mock.timers.tick(1); assert.equal(kills, 1);
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(settled, false);
        await assert.rejects(runtime.prepare(), runtimeCode('runtime_busy'));
        child.emit('close', null, 'SIGKILL');
        const outcome = await result;
        assert.equal(outcome.ok, false);
        if (!outcome.ok) assert.equal(runtimeCode('execution_timeout')(outcome.failure), true);
    } finally {
        child.emit('close', null, 'SIGKILL');
        await result;
        ready.close();
    }
    const next = await runtime.prepare(); next.close();
});
test('request cancellation and revocation terminate pending local work', async t => {
    const f = fixture(t); await f.admit(); const controller = new AbortController();
    let pending!: () => void; const started = new Promise<void>(resolve => { pending = resolve; });
    const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service, spawn: () => { const child = fakeChild(null); child.stdin.once('finish', pending); return child; } });
    const ready = await runtime.prepare({ signal: controller.signal }); const task = ready.invoke({ instruction, signal });
    await started; controller.abort(); try { await assert.rejects(task, runtimeCode('execution_cancelled')); } finally { ready.close(); }
    const other = createTreatmentReasoningPortableRuntime({ provisioning: f.service, spawn: () => { const child = fakeChild(null); child.stdin.once('finish', () => f.service.revoke({ consentDigest: f.digest })); return child; } });
    const next = await other.prepare(); try { await assert.rejects(next.invoke({ instruction, signal }), runtimeCode('binding_stale')); } finally { next.close(); }
});
test('unconfirmed termination poisons single flight until the actual close event', async t => {
    const f = fixture(t); await f.admit(); const child = fakeChild(null, false);
    // @Codex: cancel after dispatch; filesystem preparation is not the condition under test.
    const controller = new AbortController();
    child.stdin.once('finish', () => controller.abort());
    const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service, terminationGraceMs: 30, spawn: () => child });
    const ready = await runtime.prepare({ signal: controller.signal }); try { await assert.rejects(ready.invoke({ instruction, signal }), runtimeCode('termination_unconfirmed')); } finally { ready.close(); }
    await assert.rejects(runtime.prepare(), runtimeCode('runtime_busy'));
    child.emit('close', null, 'SIGKILL'); const next = await runtime.prepare(); next.close();
});
test('artifact changed after execution is not published as a successful invocation', async t => {
    const f = fixture(t); await f.admit();
    const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service, spawn: () => {
        const child = fakeChild(response()); child.stdin.on('finish', () => fs.writeFileSync(path.join(f.root, 'objects', f.digest, 'artifacts/model/model.safetensors'), 'TAMPERED')); return child;
    } });
    const ready = await runtime.prepare(); try { await assert.rejects(ready.invoke({ instruction, signal }), runtimeCode('provider_failed')); } finally { ready.close(); }
});
test('real synthetic Node child exercises stdin/stdout and process close, NOT model inference', async t => {
    const f = fixture(t); await f.admit();
    const program = `let x='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>x+=c);process.stdin.on('end',()=>{const f=JSON.parse(x);if(f.model!==${JSON.stringify(ATHENA_R1_QWEN3_8B_MODEL_ID)})process.exit(4);process.stdout.write(${JSON.stringify(response())});});`;
    const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service,
        spawn: (_command, _args, options) => actualSpawn(process.execPath, ['-e', program], options) as ChildProcessWithoutNullStreams });
    const ready = await runtime.prepare(); try { assert.equal(await ready.invoke({ instruction, signal }), '{}'); } finally { ready.close(); }
});

test('mid-flight catalog change and pre-dispatch cancellation prevent output without a fallback', async t => {
    const f = fixture(t); await f.admit(); let changed = false; let starts = 0;
    const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service, spawn: () => {
        starts++; const child = fakeChild(null); child.stdin.once('finish', () => { changed = true; }); return child;
    } });
    const ready = await runtime.prepare({ async verifyChoice() { if (changed) throw new Error('synthetic catalog changed'); } });
    try { await assert.rejects(ready.invoke({ instruction, signal }), runtimeCode('binding_stale')); } finally { ready.close(); }
    assert.equal(starts, 1);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(runtime.prepare({ signal: controller.signal }), runtimeCode('execution_cancelled'));
    assert.equal(starts, 1);
});

// Regression: initialized const timer must also be cleared when spawn throws synchronously.
test('synchronous launch failure clears poll, returns provider_failed and permits a later explicit prepare', async t => {
    const f = fixture(t); await f.admit();
    const runtime = createTreatmentReasoningPortableRuntime({ provisioning: f.service, spawn: () => { throw new Error('synthetic spawn failure'); } });
    for (let attempt = 0; attempt < 2; attempt++) {
        const prepared = await runtime.prepare();
        try { await assert.rejects(prepared.invoke({ instruction, signal }), runtimeCode('provider_failed')); }
        finally { prepared.close(); }
    }
});
