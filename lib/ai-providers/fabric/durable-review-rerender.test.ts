/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-durable-rerender-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });

const { DurableReviewRerenderError, createDurableReviewRerender } = await import('./durable-review-rerender.ts');

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const patientRef = `ptr_${'1'.repeat(32)}`;
const otherPatientRef = `ptr_${'5'.repeat(32)}`;
const reviewId = `review_${'2'.repeat(32)}`;
const receiptRef = `receipt_${'3'.repeat(32)}`;
const provenanceRef = `provenance_${'4'.repeat(32)}`;
const receipt = Object.freeze({
    schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'smart_import', class: 'generative', venue: 'local_process',
    egressProfile: { id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' }, provider: 'ollama', model: 'qwen3.5:35b-a3b',
    providerReceipt: { schemaVersion: 'mediflow.ai.provider-selection.v1', authorityPlane: 'clinical_application', task: 'clinical', provider: 'ollama', model: 'qwen3.5:35b-a3b', execution: 'local', endpointClass: 'loopback', egress: 'none', runtimeReadiness: 'required', fallbackCount: 0 }, fallbackCount: 0,
});
const provenance = Object.freeze({
    schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'smart_import', venue: 'local_process', provider: 'ollama', model: 'qwen3.5:35b-a3b',
    preprocessing: ['context_minimization', 'envelope_validation'], receipt,
});
const proposal = Object.freeze({
    schemaVersion: 'mediflow.smart-import.proposal.v1', generatedAt: '2026-08-23T12:00:00.000Z',
    contract: { validJson: true, validTask: true, legacyContract: false }, summary: 'Synthetic review proposal.', diagnoses: [], therapies: [], servicePrescriptions: [], writesPerformed: 0,
});

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: 'mediflow.ai.durable-review-envelope.v1', presentationVersion: 'mediflow.ai.durable-review.presentation.v1', patientRef, reviewId, reviewRevision: 1,
        receiptRef, provenanceRef, proposal, receipt, provenance,
        ...overrides,
    };
}

function seal(value: unknown): string {
    return `ENC:dGVzdC1jbGllbnQ=:${Buffer.from(JSON.stringify(value)).toString('base64')}`;
}

function unsealForTest(value: string): unknown {
    const parts = value.split(':');
    assert.equal(parts.length, 3);
    assert.equal(parts[0], 'ENC');
    assert.equal(parts[1], 'dGVzdC1jbGllbnQ=');
    return JSON.parse(Buffer.from(parts[2], 'base64').toString('utf8'));
}

function record(sealedCiphertext = seal(envelope()), reviewRevision = 1, storedPatientRef = patientRef): Record<string, unknown> {
    return {
        patientRef: storedPatientRef, reviewId, reviewRevision, receiptRef, provenanceRef,
        receiptBinding: digest(`${storedPatientRef}\0${reviewId}\0${receiptRef}`), provenanceBinding: digest(`${storedPatientRef}\0${reviewId}\0${provenanceRef}`),
        presentationVersion: 'mediflow.ai.durable-review.presentation.v1', sealedCiphertext, sealedDigest: digest(sealedCiphertext),
    };
}

function storedRecord(sealedCiphertext = seal(envelope()), reviewRevision = 1, storedPatientRef = patientRef): Record<string, unknown> {
    return { recordId: reviewId, ...record(sealedCiphertext, reviewRevision, storedPatientRef) };
}

function writerProcess(value: unknown): unknown {
    return JSON.parse(execFileSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/durable-review-record-store-worker.mjs', 'create'], {
        encoding: 'utf8', env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_DURABLE_REVIEW_RECORD: JSON.stringify(value) },
    }));
}

function freshReaderClientProcess(): unknown {
    const storeUrl = pathToFileURL(path.join(process.cwd(), 'lib/ai-providers/fabric/durable-review-record-store.ts')).href;
    const rerenderUrl = pathToFileURL(path.join(process.cwd(), 'lib/ai-providers/fabric/durable-review-rerender.ts')).href;
    const source = `import { createDurableReviewRecordStore } from ${JSON.stringify(storeUrl)}; import { createDurableReviewRerender } from ${JSON.stringify(rerenderUrl)}; const reviewId = JSON.parse(process.env.MEDIFLOW_DURABLE_REVIEW_RECORD ?? 'null'); const record = createDurableReviewRecordStore().read(reviewId); const rendered = await createDurableReviewRerender((sealed) => { const parts = sealed.split(':'); if (parts.length !== 3 || parts[0] !== 'ENC' || parts[1] !== 'dGVzdC1jbGllbnQ=') throw new Error(); return JSON.parse(Buffer.from(parts[2], 'base64').toString('utf8')); }).rerender(record); process.stdout.write(JSON.stringify(rendered));`;
    return JSON.parse(execFileSync(process.execPath, ['scripts/run-strip-types.mjs', '--input-type=module', '--eval', source], {
        encoding: 'utf8', env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_DURABLE_REVIEW_RECORD: JSON.stringify(reviewId) },
    }));
}

async function assertRejected(value: unknown): Promise<void> {
    await assert.rejects(
        () => createDurableReviewRerender(unsealForTest).rerender(value),
        (error) => error instanceof DurableReviewRerenderError && error.code === 'invalid_review',
    );
}

test('re-renders the saved sealed review deterministically after a fresh reader process', async () => {
    const persisted = record();
    assert.deepEqual(writerProcess({ record: persisted, expectedReviewRevision: 0, idempotencyKey: 'idem_aaaaaaaaaaaaaaaa' }), { ...persisted, recordId: reviewId });

    const first = freshReaderClientProcess() as Awaited<ReturnType<ReturnType<typeof createDurableReviewRerender>['rerender']>>;
    const second = freshReaderClientProcess() as Awaited<ReturnType<ReturnType<typeof createDurableReviewRerender>['rerender']>>;

    assert.deepEqual(first.model, second.model);
    assert.equal(first.dom, second.dom);
    assert.equal(first.presentationVersion, 'mediflow.ai.durable-review.presentation.v1');
    assert.match(first.dom, /^<article data-durable-review-version="mediflow\.ai\.durable-review\.presentation\.v1">/u);
    assert.match(first.dom, /Synthetic review proposal\./u);
    assert.match(first.dom, /receipt_33333333333333333333333333333333/u);
    assert.match(first.dom, /provenance_44444444444444444444444444444444/u);
});

test('rejects altered record bindings, revision, sealed digest, version, extras, and stale or corrupt ciphertext', async () => {
    const base = storedRecord() as Record<string, unknown> & { receiptBinding: string; sealedDigest: string };
    const cases = [
        { ...base, receiptBinding: base.receiptBinding.replace(/^./u, '0') },
        { ...base, reviewRevision: 0 },
        { ...base, sealedDigest: base.sealedDigest.replace(/^./u, '0') },
        { ...base, presentationVersion: 'mediflow.ai.durable-review.presentation.v2' },
        { ...base, extra: 'forbidden' },
        storedRecord(seal(envelope({ reviewRevision: 2 }))),
        storedRecord(seal(envelope()), 1, otherPatientRef),
        storedRecord('ENC:dGVzdC1jbGllbnQ=:bm90LWpzb24='),
        storedRecord(seal(envelope({ extra: 'forbidden' }))),
    ];
    for (const value of cases) await assertRejected(value);
});

test('keeps the renderer read-only and does not expose plaintext to the host record', async () => {
    const renderer = createDurableReviewRerender(unsealForTest);
    assert.deepEqual(Object.keys(renderer), ['rerender']);
    const persisted = record();
    assert.equal(JSON.stringify(persisted).includes('Synthetic review proposal.'), false);
    assert.equal(JSON.stringify(persisted).includes('patientId'), false);
    await assertRejected({ ...storedRecord(), sealedCiphertext: seal(envelope({ prompt: 'synthetic forbidden prompt' })) });
});

test('escapes synthetic HTML supplied by the sealed proposal', async () => {
    const injected = await createDurableReviewRerender(unsealForTest).rerender(storedRecord(seal(envelope({ proposal: { ...proposal, summary: '<img src=x onerror=alert(1)>' } }))));
    assert.match(injected.dom, /&lt;img src=x onerror=alert\(1\)&gt;/u);
    assert.doesNotMatch(injected.dom, /<img/u);
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
