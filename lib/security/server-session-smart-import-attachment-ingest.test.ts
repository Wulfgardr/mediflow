/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    ingestServerSessionSmartImportAttachment,
    ServerSessionSmartImportAttachmentIngestError,
} from './server-session-smart-import-attachment-ingest.ts';
import type { ServerSession } from './server-session.ts';
import { createFullPortProjectionOwnerFactory, ServerSessionProjectionOwnerError } from './server-session-projection-owner.ts';
import {
    issueSyntheticWebSession,
    retireSyntheticWebSession,
} from './web-auth-lifecycle-owner-test-fixture.ts';
import { ProjectionBrokerError } from '../typed-projection-broker.ts';
import { SmartImportProjectionError } from '../smart-import-projection.ts';

const USER = { id: ['synthetic', 'user'].join('-'), username: ['synthetic', 'clinician'].join('-'), role: 'clinician' };
const PAIR = { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };
const sessions: ServerSession[] = [];
let sequence = 0;

afterEach(() => {
    while (sessions.length > 0) retireSyntheticWebSession(sessions.pop()!);
});

function attachment() {
    const now = new Date().toISOString();
    return { schemaVersion: 'mediflow.smart-import.projection-attachment.v1', capability: 'smart_import',
        patientRevision: 1, sourceRevision: 1, capturedAt: now, currentDiagnoses: [], currentActiveTherapies: [],
        therapyCandidateHints: [], sources: [{ id: 'source.synthetic.0001', kind: 'clinical-entry',
            label: 'Fonte sintetica', date: null, content: 'Contenuto sintetico.' }] };
}
function setup() {
    const registry = createFullPortProjectionOwnerFactory({
        resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }),
    });
    const session = issueSyntheticWebSession(USER, `smart-import-ingest-${sequence += 1}`);
    sessions.push(session);
    const owner = registry.create(session);
    const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    return { registry, session, owner, lease };
}
function input(lease: ReturnType<typeof setup>['lease'], requestId = 'request.synthetic.0001') {
    return { tuple: { sessionRef: lease.sessionRef, selectionEpoch: lease.selectionEpoch, patientRef: lease.patientRef,
        ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef }, attachment: attachment(), requestId };
}

test('attaches an authority-free attachment and returns only an opaque handle', () => {
    const { registry, session, owner, lease } = setup();
    const handle = ingestServerSessionSmartImportAttachment(session, registry, input(lease));

    assert.match(handle, /^prj_[0-9a-f]{32}$/u);
    assert.doesNotMatch(handle, /patient|Fonte|Contenuto/u);
    assert.equal(owner.resolveProjectionService(session).consume({ handle, capability: 'smart_import',
        requestId: 'request.synthetic.0002' }).patientRef, lease.patientRef);
});

test('maps hostile caller input to a fixed typed error', () => {
    const { registry, session } = setup();
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('synthetic raw detail'); } });

    assert.throws(() => ingestServerSessionSmartImportAttachment(session, registry, hostile),
        (error) => error instanceof ServerSessionSmartImportAttachmentIngestError && error.code === 'input_invalid'
            && !/synthetic raw/u.test(error.message));
});

test('keeps broker replay, selection replacement, and session revocation fail closed', () => {
    const first = setup(); const payload = input(first.lease);
    assert.match(ingestServerSessionSmartImportAttachment(first.session, first.registry, payload), /^prj_[0-9a-f]{32}$/u);
    assert.throws(() => ingestServerSessionSmartImportAttachment(first.session, first.registry, payload),
        (error) => error instanceof ProjectionBrokerError && error.code === 'request_replayed');

    const replaced = setup(); const stale = input(replaced.lease);
    replaced.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
    assert.throws(() => ingestServerSessionSmartImportAttachment(replaced.session, replaced.registry, stale),
        (error) => error instanceof ServerSessionProjectionOwnerError && error.code === 'stale_selection');

    const revoked = setup(); retireSyntheticWebSession(revoked.session);
    assert.throws(() => ingestServerSessionSmartImportAttachment(revoked.session, revoked.registry, input(revoked.lease)),
        (error) => error instanceof ServerSessionSmartImportAttachmentIngestError && error.code === 'session_unavailable');
});

test('rejects extra, accessor, prototype, authority, and request inputs without raw errors', () => {
    const { registry, session, lease } = setup();
    const accessor = input(lease); Object.defineProperty(accessor.tuple, 'patientRef', { get() { return lease.patientRef; } });
    const prototype = { tuple: Object.create(input(lease).tuple), attachment: attachment(), requestId: 'request.synthetic.0002' };
    for (const value of [{ ...input(lease), extra: true }, accessor, prototype, { ...input(lease), requestId: 'short' }]) {
        assert.throws(() => ingestServerSessionSmartImportAttachment(session, registry, value),
            (error) => error instanceof ServerSessionSmartImportAttachmentIngestError && error.code === 'input_invalid');
    }
    assert.throws(() => ingestServerSessionSmartImportAttachment(session, registry,
        { ...input(lease), attachment: { ...attachment(), patientRef: lease.patientRef } }),
    (error) => error instanceof SmartImportProjectionError && error.code === 'projection_invalid');
});

test('keeps selection, broker controls, service, and app surfaces outside the seam', () => {
    const source = readFileSync(new URL('./server-session-smart-import-attachment-ingest.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /resolveProjectionService|createTypedProjectionBroker|issueSelection|(?:provider|preview|apply|route)/u);
});
