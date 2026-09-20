/* @Codex */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createGlinerRedactionRunner, decodeGlinerEntities, GLINER_REDACTION_REVISION } from './gliner-redaction-runner';

test('converts Unicode code points, preserving exact source text and canonical types', () => {
    const text = '😀 Maria Rossi';
    const spans = decodeGlinerEntities(text, { person: [{ start: 2, end: 13, text: 'Maria Rossi', confidence: 0.9 }] });
    assert.deepEqual(spans, [{ type: 'person', start: 3, end: 14, text: 'Maria Rossi', confidence: 0.9 }]);
    assert.ok(Object.isFrozen(spans) && Object.isFrozen(spans[0]));
});

test('rejects unknown labels, invalid offsets, malformed confidence and excessive results', () => {
    const entity = { start: 0, end: 5, text: 'Maria', confidence: 0.9 };
    for (const input of [null, [], { unknown: [] }, { person: null }, { person: [{ ...entity, end: 6 }] },
        { person: [{ ...entity, text: 'altro' }] }, { person: [{ ...entity, confidence: Number.NaN }] },
        { person: [{ ...entity, start: 0.5 }] }, { person: Array(513).fill(entity) }]) {
        assert.throws(() => decodeGlinerEntities('Maria', input), /local_redaction_unavailable/);
    }
});

// These stdlib-only workers exercise transport and lifecycle, not model quality.
function fixture(body: string) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'mediflow-gliner-protocol-'));
    const workerPath = path.join(root, 'worker.py');
    writeFileSync(workerPath, `import sys,json,time,socket,signal\n${body}\n`);
    const runner = createGlinerRedactionRunner({ pythonExecutable: '/usr/bin/python3', workerPath, modelDirectory: root });
    return { runner, async cleanup() { await runner.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('Mac runner handles sequential requests, rejects concurrent use and closes idempotently', { skip: process.platform !== 'darwin' }, async () => {
    const owned = fixture(`print(json.dumps({'ready':'${GLINER_REDACTION_REVISION}'}),flush=True)
for line in sys.stdin:
 request=json.loads(line)
 print(json.dumps({'id':request['id'],'entities':{}}),flush=True)`);
    try {
        const first = owned.runner.extract('Test sintetico');
        await assert.rejects(owned.runner.extract('Secondo'), /local_redaction_unavailable/);
        assert.deepEqual(await first, []);
        assert.deepEqual(await owned.runner.extract('Secondo'), []);
        await owned.runner.close(); await owned.runner.close();
        await assert.rejects(owned.runner.extract('Terzo'), /local_redaction_unavailable/);
    } finally { await owned.cleanup(); }
});

test('Mac runner denies network at OS level and keeps local protocol usable', { skip: process.platform !== 'darwin' }, async () => {
    const owned = fixture(`try:
 s=socket.socket()
 s.bind(('127.0.0.1',0))
 print(json.dumps({'error':'network_not_denied'}),flush=True)
except PermissionError:
 try:
  socket.socket().connect(('127.0.0.1',9))
  print(json.dumps({'error':'connect_not_denied'}),flush=True)
 except PermissionError:
  print(json.dumps({'ready':'${GLINER_REDACTION_REVISION}'}),flush=True)
request=json.loads(sys.stdin.readline())
print(json.dumps({'id':request['id'],'entities':{}}),flush=True)
time.sleep(1)`);
    try { assert.deepEqual(await owned.runner.extract('Sintetico'), []); }
    finally { await owned.cleanup(); }
});

test('Mac runner invalidates wrong greeting, correlation, oversized output and unexpected exit', { skip: process.platform !== 'darwin' }, async () => {
    const greeting = `print(json.dumps({'ready':'${GLINER_REDACTION_REVISION}'}),flush=True)`;
    for (const body of [
        "print(json.dumps({'ready':'wrong'}),flush=True)",
        `${greeting}\nsys.stdin.readline()\nprint(json.dumps({'id':999,'entities':{}}),flush=True)`,
        `${greeting}\nsys.stdin.readline()\nprint('x'*300000,flush=True)`,
        `${greeting}\nsys.stdin.readline()`,
    ]) {
        const owned = fixture(body);
        try {
            await assert.rejects(owned.runner.extract('Sintetico'), /local_redaction_unavailable/);
            await assert.rejects(owned.runner.extract('Non riavviare'), /local_redaction_unavailable/);
        } finally { await owned.cleanup(); }
    }
});

test('Mac cancellation drains the child and never resumes that runner', { skip: process.platform !== 'darwin' }, async () => {
    const owned = fixture(`signal.signal(signal.SIGTERM,signal.SIG_IGN)\nprint(json.dumps({'ready':'${GLINER_REDACTION_REVISION}'}),flush=True)\ntime.sleep(60)`);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 200);
    try {
        await assert.rejects(owned.runner.extract('Sintetico', abort.signal), /local_redaction_unavailable/);
        await assert.rejects(owned.runner.extract('Non riavviare'), /local_redaction_unavailable/);
    } finally { clearTimeout(timer); await owned.cleanup(); }
});

test('canonical worker rejects a changed model before loading or inference', { skip: process.platform !== 'darwin' }, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'mediflow-gliner-artifact-'));
    writeFileSync(path.join(root, 'model.safetensors'), 'synthetic-wrong-weights');
    const runner = createGlinerRedactionRunner({ pythonExecutable: '/usr/bin/python3', workerPath: path.join(process.cwd(), 'scripts/gliner-redaction-worker.py'), modelDirectory: root });
    try { await assert.rejects(runner.extract('Sintetico'), /local_redaction_unavailable/); }
    finally { await runner.close(); rmSync(root, { recursive: true, force: true }); }
});
