/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ClinicalEntry, Patient, Therapy } from '../../db.ts';
import { buildTreatmentReasoningProjectionAttachment } from './treatment-reasoning-projection.ts';
import {
    createTreatmentReasoningAuthenticatedProjectionBroker,
    TreatmentReasoningAuthenticatedProjectionError,
} from './treatment-reasoning-authenticated-projection.ts';

const NOW = new Date('2026-09-01T10:00:00.000Z');
const SESSION = Object.freeze({ id: 'session.synthetic.treatment', userId: 'user.synthetic', username: 'synthetic', role: 'clinician', authChannel: 'web' as const, createdAt: 1, expiresAt: 9_999_999_999_999 });
const PATIENT = 'patient.synthetic.treatment';
const AMBULATORY = 'ambulatory.synthetic.treatment';

function projection() {
    const patient = { id: PATIENT, firstName: 'Synthetic', lastName: 'Person', version: 7, notes: 'Contesto sintetico.', diagnoses: [], createdAt: NOW, updatedAt: NOW } as Patient;
    const therapy = { id: 'therapy.synthetic.treatment', patientId: PATIENT, drugName: 'Farmaco sintetico', dosage: '5 mg', status: 'active', version: 1, startDate: NOW, createdAt: NOW, updatedAt: NOW } as Therapy;
    const entry = { id: 'entry.synthetic.treatment', patientId: PATIENT, type: 'note', title: 'Nota sintetica', content: '<p>Evidenza sintetica.</p>', version: 1, date: NOW, createdAt: NOW, updatedAt: NOW } as ClinicalEntry;
    return buildTreatmentReasoningProjectionAttachment({ patient, therapies: [therapy], entries: [entry], observations: [], attachments: [], now: NOW });
}

function harness(overrides: { epoch?: number; patientVersion?: number; context?: boolean } = {}) {
    let epoch = overrides.epoch ?? 1; let patientVersion = overrides.patientVersion ?? 7;
    let currentRef = Object.freeze(Object.create(null)); let stagedRef: object | null = null; let terminal = false;
    let prepares = 0; let commits = 0; let aborts = 0; let disposed = 0; let registrations = 0;
    const port = Object.freeze({
        snapshot: () => terminal ? null : Object.freeze({ currentRef, stagedRef, generation: 0, terminal: false }),
        prepare: ({ expected }: { expected: object }) => {
            if (terminal || expected !== currentRef || stagedRef) return null;
            prepares += 1; stagedRef = Object.freeze(Object.create(null)); return stagedRef;
        },
        commit: ({ expected, replacement }: { expected: object; replacement: object }) => {
            if (terminal || expected !== currentRef || replacement !== stagedRef) return false;
            commits += 1; currentRef = replacement; stagedRef = null; terminal = true; return true;
        },
        abort: ({ replacement }: { replacement: object }) => {
            if (replacement !== stagedRef) return false;
            aborts += 1; stagedRef = null; terminal = true; return true;
        },
        dispose: () => { disposed += 1; terminal = true; stagedRef = null; },
    });
    const owner = Object.freeze({
        snapshotSelectionEpoch: () => epoch,
        withLeaseCriticalSection: (_session: unknown, operation: (selection: { patientId: string; ambulatoryId: string }) => unknown) => operation({ patientId: PATIENT, ambulatoryId: AMBULATORY }),
        mintTreatmentReasoningLeaseCommitPort: () => port,
    });
    const broker = createTreatmentReasoningAuthenticatedProjectionBroker({
        acquireContext: async () => overrides.context === false ? null : ({ session: SESSION, owner } as never),
        clock: () => NOW.toISOString(),
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index + 1),
        readPatientVersion: () => patientVersion,
        registerResource: () => { registrations += 1; return () => { registrations -= 1; }; },
    });
    return { broker, stats: () => ({ prepares, commits, aborts, disposed, registrations }), setEpoch: (value: number) => { epoch = value; }, setPatientVersion: (value: number) => { patientVersion = value; } };
}

const rejects = (code: TreatmentReasoningAuthenticatedProjectionError['code']) => (
    (error: unknown) => error instanceof TreatmentReasoningAuthenticatedProjectionError && error.code === code
);

test('captures once under the authenticated selection and commits one current review execution', async () => {
    const value = harness();
    const ingest = await value.broker.acquireIngest();
    const handle = ingest.ingest({ projection: projection(), requestId: 'request.synthetic.ingest' });
    assert.match(handle, /^trp_[0-9a-f]{32}$/u);
    const preview = await value.broker.acquirePreview();
    const execution = preview.begin({ handle, requestId: 'request.synthetic.preview' });
    assert.equal(execution.projection.patientRevision, 7);
    assert.equal(execution.patientRef, PATIENT);
    assert.deepEqual(Reflect.ownKeys(execution), ['projection', 'patientRef', 'commit', 'abort']);
    assert.equal(execution.commit(), true);
    assert.deepEqual(value.stats(), { prepares: 1, commits: 1, aborts: 0, disposed: 0, registrations: 0 });
    assert.throws(() => preview.begin({ handle, requestId: 'request.synthetic.replay' }), rejects('handle_missing'));
});

test('fails closed on missing session, request replay, stale selection, and patient revision drift', async () => {
    await assert.rejects(() => harness({ context: false }).broker.acquireIngest(), rejects('session_unavailable'));
    const replay = harness(); const ingest = await replay.broker.acquireIngest(); const input = { projection: projection(), requestId: 'request.synthetic.same' };
    ingest.ingest(input); assert.throws(() => ingest.ingest(input), rejects('request_replayed'));

    const selection = harness(); const selectionHandle = (await selection.broker.acquireIngest()).ingest({ projection: projection(), requestId: 'request.synthetic.selection-ingest' });
    selection.setEpoch(2);
    const selectionPreview = await selection.broker.acquirePreview();
    assert.throws(() => selectionPreview.begin({ handle: selectionHandle, requestId: 'request.synthetic.selection-preview' }), rejects('selection_changed'));

    const revision = harness(); const revisionHandle = (await revision.broker.acquireIngest()).ingest({ projection: projection(), requestId: 'request.synthetic.revision-ingest' });
    revision.setPatientVersion(8); const preview = await revision.broker.acquirePreview();
    assert.throws(() => preview.begin({ handle: revisionHandle, requestId: 'request.synthetic.revision-preview' }), rejects('projection_stale'));
    assert.equal(revision.stats().prepares, 0);
});

test('aborts a staged execution exactly once and rejects caller authority fields', async () => {
    const value = harness(); const ingest = await value.broker.acquireIngest();
    assert.throws(() => ingest.ingest({ projection: projection(), requestId: 'request.synthetic.extra', provider: 'athena_mlx' }), rejects('input_invalid'));
    const handle = ingest.ingest({ projection: projection(), requestId: 'request.synthetic.abort-ingest' });
    const execution = (await value.broker.acquirePreview()).begin({ handle, requestId: 'request.synthetic.abort-preview' });
    execution.abort(); execution.abort();
    assert.deepEqual(value.stats(), { prepares: 1, commits: 0, aborts: 1, disposed: 0, registrations: 0 });
    assert.equal(execution.commit(), false);
});
