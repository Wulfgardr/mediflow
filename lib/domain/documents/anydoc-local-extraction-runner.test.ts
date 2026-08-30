/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { extractAnyDocLocalBytes } from './anydoc-local-extraction-runner';
import { ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES, ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES } from './anydoc-local-extraction-contract';

const SYNTHETIC_RTF = Buffer.from('{\\rtf1\\ansi Synthetic discharge note.}', 'utf8');
const RUNNER_SOURCE = readFileSync(new URL('./anydoc-local-extraction-runner.ts', import.meta.url), 'utf8');
const NEXT_CONFIG_SOURCE = readFileSync(new URL('../../../next.config.ts', import.meta.url), 'utf8');
const WORKER_PATH = path.resolve(path.dirname(new URL('./anydoc-local-extraction-runner.ts', import.meta.url).pathname), '../../../scripts/anydoc-local-extraction-worker.mjs');
const CHECKER_PATH = path.resolve(path.dirname(WORKER_PATH), 'check-standalone-runtime-bundle.mjs');

function assertIoFailure(result: Awaited<ReturnType<typeof extractAnyDocLocalBytes>>) {
    assert.equal(result.status, 'review_required');
    if (result.status !== 'review_required') return;
    assert.equal(result.reason, 'unsupported_local_extraction');
    assert.equal(result.detail, 'io_failure');
    assert.equal(result.markdown, '');
    assert.equal(result.candidateUse, 'blocked');
}

test('binds successful extraction evidence to the exact copied source bytes', async () => {
    const result = await extractAnyDocLocalBytes('synthetic-attachment-rtf', SYNTHETIC_RTF);

    assert.equal(result.status, 'extracted');
    if (result.status !== 'extracted') return;
    assert.equal(result.markdown, 'Synthetic discharge note.');
    assert.equal(result.provenance.sourceSha256, 'ebf4cc680419e22ec7f636bcb3b5f9767e1edb64b6a47704672c8e9eb9f3a1f4');
    assert.equal(result.provenance.byteLength, 38);
    assert.equal(result.receipt.sourceSha256, result.provenance.sourceSha256);
    assert.equal(result.receipt.sourceByteLength, result.provenance.byteLength);
    assert.equal(result.writes, 0);
    assert.equal(result.apply, 'none');
});

test('copies source bytes before asynchronous conversion', async () => {
    const callerBytes = Buffer.from(SYNTHETIC_RTF);
    const pending = extractAnyDocLocalBytes('synthetic-attachment-copy', callerBytes);
    callerBytes.fill(0);
    const result = await pending;

    assert.equal(result.status, 'extracted');
    if (result.status !== 'extracted') return;
    assert.equal(result.markdown, 'Synthetic discharge note.');
    assert.equal(result.provenance.sourceSha256, 'ebf4cc680419e22ec7f636bcb3b5f9767e1edb64b6a47704672c8e9eb9f3a1f4');
});

test('does not inherit provider, native override or Node option variables', async () => {
    const names = ['FIRECRAWL_API_KEY', 'FIRECRAWL_API_URL', 'NAPI_RS_NATIVE_LIBRARY_PATH', 'NODE_OPTIONS'] as const;
    const previous = names.map((name) => process.env[name]);
    process.env.FIRECRAWL_API_KEY = 'synthetic-forbidden-key';
    process.env.FIRECRAWL_API_URL = 'synthetic-forbidden-url';
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH = '/synthetic/forbidden-native.node';
    process.env.NODE_OPTIONS = '--synthetic-invalid-option';
    try {
        const result = await extractAnyDocLocalBytes('synthetic-attachment-env', SYNTHETIC_RTF);
        assert.equal(result.status, 'extracted');
    } finally {
        names.forEach((name, index) => {
            const value = previous[index];
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        });
    }
});

test('derives the exact digest-bound worker from the physical module directory', () => {
    assert.match(RUNNER_SOURCE, /anydoc-local-extraction-worker\.mjs/u);
    assert.match(RUNNER_SOURCE, /34f2db3d788585dab175b284bc8f1f39395fb66a21780e1782a5d5067073e370/u);
    assert.match(RUNNER_SOURCE, /medical-record-app/u);
    assert.match(RUNNER_SOURCE, /cwd: worker\.directory,/u);
    assert.doesNotMatch(RUNNER_SOURCE, /new URL\([^\n]*scripts\//u);
    assert.doesNotMatch(RUNNER_SOURCE, /process\.(?:cwd|argv|env)/u);
    assert.match(NEXT_CONFIG_SOURCE, /"\.\/package\.json"/u);
    assert.match(NEXT_CONFIG_SOURCE, /"\.\/scripts\/anydoc-local-extraction-worker\.mjs"/u);
    assert.match(NEXT_CONFIG_SOURCE, /"\.\/node_modules\/@firecrawl\/anydoc\*\/\*\*\/\*"/u);
});

test('ignores hostile caller cwd when locating the owned worker', async () => {
    const originalCwd = process.cwd();
    const hostileCwd = mkdtempSync(path.join(os.tmpdir(), 'mediflow-anydoc-hostile-cwd-'));
    try {
        process.chdir(hostileCwd);
        const result = await extractAnyDocLocalBytes('synthetic-attachment-hostile-cwd', SYNTHETIC_RTF);
        assert.equal(result.status, 'extracted');
    } finally {
        process.chdir(originalCwd);
        rmSync(hostileCwd, { recursive: true, force: true });
    }
});

test('fails closed with sanitized io_failure for missing, symlinked, and tampered workers', async () => {
    const backupPath = `${WORKER_PATH}.runner-test-backup`;
    const original = readFileSync(WORKER_PATH);
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-anydoc-worker-outside-'));
    const outsideWorker = path.join(outsideDir, 'worker.mjs');
    try {
        renameSync(WORKER_PATH, backupPath);
        assertIoFailure(await extractAnyDocLocalBytes('synthetic-attachment-worker-missing', SYNTHETIC_RTF));

        writeFileSync(outsideWorker, original);
        symlinkSync(outsideWorker, WORKER_PATH);
        assertIoFailure(await extractAnyDocLocalBytes('synthetic-attachment-worker-symlink', SYNTHETIC_RTF));
        rmSync(WORKER_PATH);

        writeFileSync(WORKER_PATH, Buffer.concat([original, Buffer.from('\n// synthetic tamper\n')]));
        assertIoFailure(await extractAnyDocLocalBytes('synthetic-attachment-worker-tamper', SYNTHETIC_RTF));
    } finally {
        rmSync(WORKER_PATH, { force: true });
        renameSync(backupPath, WORKER_PATH);
        rmSync(outsideDir, { recursive: true, force: true });
    }
});

test('exercises standalone AnyDoc bundle checks through their public CLI seam', () => {
    const result = spawnSync(process.execPath, [CHECKER_PATH, '--self-test'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('maps an unsupported byte snapshot to review-required without candidate output', async () => {
    const result = await extractAnyDocLocalBytes('synthetic-attachment-unsupported', Buffer.from([0, 1, 2, 3]));

    assert.equal(result.status, 'review_required');
    if (result.status !== 'review_required') return;
    assert.equal(result.reason, 'unsupported_local_extraction');
    assert.equal(result.detail, 'unsupported_format');
    assert.equal(result.markdown, '');
    assert.equal(result.candidateUse, 'blocked');
    assert.equal(result.writes, 0);
});

test('denies proxy, empty, oversized and invalid attachment inputs without throwing', async () => {
    const proxy = new Proxy(SYNTHETIC_RTF, { get() { throw new Error('trap'); } });
    const inputs = [
        extractAnyDocLocalBytes('synthetic-attachment-proxy', proxy),
        extractAnyDocLocalBytes('synthetic-attachment-empty', Buffer.alloc(0)),
        extractAnyDocLocalBytes('synthetic-attachment-large', Buffer.alloc(ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES + 1)),
        extractAnyDocLocalBytes('', SYNTHETIC_RTF),
    ];
    const results = await Promise.all(inputs);

    for (const result of results) {
        assert.equal(result.status, 'denied');
        if (result.status === 'denied') assert.equal(result.field, 'source');
        assert.equal(result.writes, 0);
        assert.equal(result.apply, 'none');
    }
});

test('denies a typed-array proxy before instanceof can invoke its prototype trap', async () => {
    let prototypeTrapReads = 0;
    const proxy = new Proxy(SYNTHETIC_RTF, {
        getPrototypeOf() {
            prototypeTrapReads += 1;
            throw new Error('synthetic-prototype-trap');
        },
    });

    let result: Awaited<ReturnType<typeof extractAnyDocLocalBytes>> | undefined;
    await assert.doesNotReject(async () => { result = await extractAnyDocLocalBytes('synthetic-attachment-prototype-proxy', proxy); });
    assert.ok(result);
    assert.equal(result.status, 'denied');
    if (result.status === 'denied') assert.equal(result.field, 'source');
    assert.equal(prototypeTrapReads, 0);
});

test('fails closed when extracted Markdown crosses the output cap', async () => {
    const largeRtf = Buffer.from(`{\\rtf1\\ansi ${'x'.repeat(ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES + 1)}}`, 'utf8');
    const result = await extractAnyDocLocalBytes('synthetic-attachment-output-cap', largeRtf);

    assert.equal(result.status, 'review_required');
    if (result.status !== 'review_required') return;
    assert.equal(result.detail, 'resource_limit');
    assert.equal(result.markdown, '');
    assert.equal(result.candidateUse, 'blocked');
});
