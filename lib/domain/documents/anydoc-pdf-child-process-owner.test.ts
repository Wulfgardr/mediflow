/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB,
    ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM,
    ANYDOC_PDF_CHILD_WORKER_SHA256,
} from './anydoc-pdf-child-process-owner';

const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

test('hard-kills a synchronously hung PDF worker and keeps the parent owner usable', async () => {
    const started = performance.now();
    const hung = await ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.runSynchronousHang();

    assert.deepEqual(hung, {
        status: 'failed',
        reason: 'timeout',
        terminationSignal: 'SIGKILL',
    });
    assert.ok(performance.now() - started < 2_000);
    assert.deepEqual(await ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.runValidFailure(), {
        status: 'failed',
        reason: 'malformed_or_encrypted_pdf',
        terminationSignal: null,
    });
});

test('kills oversized output and rejects a malformed child envelope without publishing bytes', async () => {
    assert.deepEqual(await ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.runOversizedOutput(), {
        status: 'failed',
        reason: 'resource_limit',
        terminationSignal: 'SIGKILL',
    });
    assert.deepEqual(await ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.runMalformedOutput(), {
        status: 'failed',
        reason: 'protocol_error',
        terminationSignal: null,
    });
});

test('admits at most one PDF child job per process and releases ownership after kill', async () => {
    const first = ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.runSynchronousHang();
    const concurrent = await ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.runValidFailure();

    assert.deepEqual(concurrent, {
        status: 'failed',
        reason: 'busy',
        terminationSignal: null,
    });
    assert.equal((await first).reason, 'timeout');
    assert.equal((await ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.runValidFailure()).reason,
        'malformed_or_encrypted_pdf');
});

test('shares one page deadline and denies network entrypoints inside the permission-bound child', async () => {
    assert.deepEqual(await ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.runSharedDeadline(), {
        status: 'failed',
        reason: 'timeout',
        terminationSignal: null,
    });
    assert.deepEqual(await ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.runNetworkDenied(), {
        status: 'failed',
        reason: 'invalid_request',
        terminationSignal: null,
    });
});

test('accepts only bounded complete PNG structure whose IHDR matches the child header', () => {
    assert.equal(ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.validatePng(ONE_PIXEL_PNG, 1, 1), true);
    assert.equal(ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.validatePng(ONE_PIXEL_PNG, 2, 1), false);
    assert.equal(ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.validatePng(ONE_PIXEL_PNG.subarray(0, -12), 1, 1), false);
    assert.equal(ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.validatePng(
        Buffer.concat([ONE_PIXEL_PNG, Buffer.from([0])]), 1, 1,
    ), false);

    const duplicateIhdr = Buffer.concat([
        ONE_PIXEL_PNG.subarray(0, 33),
        ONE_PIXEL_PNG.subarray(8, 33),
        ONE_PIXEL_PNG.subarray(33),
    ]);
    assert.equal(ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.validatePng(duplicateIhdr, 1, 1), false);

    const oversizedChunk = Buffer.from(ONE_PIXEL_PNG);
    oversizedChunk.writeUInt32BE(0xffff_ffff, 33);
    assert.equal(ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM.validatePng(oversizedChunk, 1, 1), false);
});

test('pins the regular owned worker and keeps all PDF engines out of parent runtime modules', () => {
    const workerUrl = new URL('../../../scripts/anydoc-pdf-page-worker.mjs', import.meta.url);
    const worker = readFileSync(workerUrl);
    const owner = readFileSync(new URL('./anydoc-pdf-child-process-owner.ts', import.meta.url), 'utf8');
    const materializer = readFileSync(new URL('./anydoc-pdf-page-materializer.ts', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('./anydoc-pdf-page-renderer.ts', import.meta.url), 'utf8');

    assert.equal(createHash('sha256').update(worker).digest('hex'), ANYDOC_PDF_CHILD_WORKER_SHA256);
    assert.match(owner, /child\.kill\('SIGKILL'\)/u);
    assert.match(owner, /--max-old-space-size=\$\{ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB\}/u);
    assert.match(owner, /--permission/u);
    assert.match(owner, /--allow-fs-read=\$\{worker\.root\}/u);
    assert.match(owner, /options\.allowAddons \? \['--allow-addons'\] : \[\]/u);
    assert.equal(ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB, 256);
    assert.doesNotMatch(`${owner}\n${materializer}\n${renderer}`,
        /from ['"](?:pdf-lib|pdfjs-dist|@napi-rs\/canvas)|import\(['"](?:pdf-lib|pdfjs-dist|@napi-rs\/canvas)/u);
    assert.match(worker.toString('utf8'), /import\('pdf-lib'\)/u);
    assert.match(worker.toString('utf8'), /import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/u);
    assert.match(worker.toString('utf8'), /import\('@napi-rs\/canvas'\)/u);
    assert.match(worker.toString('utf8'), /registerHooks/u);
    assert.match(worker.toString('utf8'), /MEDIFLOW_NETWORK_DISABLED/u);
    assert.match(worker.toString('utf8'), /const deadline = started \+ PAGE_TIMEOUT_MS/u);
    assert.doesNotMatch(worker.toString('utf8'),
        /documentSourceRef|documentRevision|documentFreshnessEpoch|attachmentId|patientId|receipt/u);
});
