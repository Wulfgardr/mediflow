/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    createServerSessionProjectionOwnerRegistry,
    disposeDurableReviewCommitPort,
    isServerSessionProjectionOwner,
    ServerSessionProjectionOwnerError,
    spendDurableReviewCommitPort,
} from './server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession, type ServerSession } from './server-session.ts';
import { digestDocumentSynthesisSourceSet } from './document-synthesis-source-set-digest.ts';

const USER = { id: ['synthetic', 'user'].join('-'), username: ['synthetic', 'clinician'].join('-'), role: 'clinician' };
const PAIR = { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };

afterEach(() => clearAllSessions());

function session(channel: ServerSession['authChannel'] = 'web') {
    return createSession(USER, channel);
}

function ownerWithSelection(now = 1_000, onClock: (() => void) | null = null) {
    let clock = now;
    let entropy = 0;
    const registry = createServerSessionProjectionOwnerRegistry({
        clock: () => { onClock?.(); return clock; },
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (entropy += 1) + index),
        resolve: (_session, pair) => Object.freeze({ ...pair }),
    });
    const value = session();
    const owner = registry.acquire(value);
    owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    return { registry, value, owner, setClock: (next: number) => { clock = next; } };
}

function currentness(documentRevision = 1, documentFreshnessEpoch = 1, documentSourceRef = 'document-source.synthetic.01') {
    return Object.freeze({ documentSourceRef, documentRevision, documentFreshnessEpoch });
}

function projection(sourceKind: 'native_text' | 'ocr_text' = 'native_text') {
    return Object.freeze({ sourceKind, sourceText: 'Synthetic source.' });
}

function productionTypeScriptFiles(directory: URL): URL[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
        if (entry.isDirectory()) return productionTypeScriptFiles(target);
        return /\.(?:[cm]?[jt]sx?)$/u.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name) ? [target] : [];
    });
}

test('keeps authentic owner identity private to the registry', () => {
    const { registry, value, owner } = ownerWithSelection();
    const lookalike = Object.freeze({ ...owner });
    assert.equal(isServerSessionProjectionOwner(owner), true);
    assert.equal(registry.isAuthenticOwner(owner), true);
    assert.equal(isServerSessionProjectionOwner(lookalike), false);
    assert.equal(registry.isAuthenticOwner(lookalike), false);
    assert.equal(registry.acquire(value), owner);
});

test('removes the generic commit turn surface and mints separated closed ports', () => {
    const source = readFileSync(new URL('./server-session-projection-owner.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:LeaseCommitTurn|spendLeaseCommitTurn|withLeaseCommitTurn)/u);
    const { value, owner } = ownerWithSelection();
    const patientInsight = owner.mintPatientInsightLeaseCommitPort(value);
    const secondPatientInsight = owner.mintPatientInsightLeaseCommitPort(value);
    const ocr = owner.mintOcrLeaseCommitPort(value);
    const documentSynthesis = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const treatmentReasoning = owner.mintTreatmentReasoningLeaseCommitPort(value);
    const patientSnapshot = patientInsight.snapshot();
    const ocrSnapshot = ocr.snapshot();
    const documentSnapshot = documentSynthesis.snapshot();
    assert.ok(patientSnapshot); assert.ok(ocrSnapshot); assert.ok(documentSnapshot);
    assert.notEqual(patientInsight, secondPatientInsight);
    assert.notEqual(patientInsight, ocr);
    assert.notEqual(patientInsight, documentSynthesis);
    assert.notEqual(ocr, documentSynthesis);
    assert.notEqual(patientInsight, treatmentReasoning);
    assert.notEqual(ocr, treatmentReasoning);
    assert.notEqual(documentSynthesis, treatmentReasoning);
    assert.deepEqual(Object.keys(patientInsight), ['snapshot', 'prepare', 'commit', 'abort', 'dispose']);
    assert.equal(Object.isFrozen(patientInsight), true);
    assert.equal(Object.getPrototypeOf(patientSnapshot.currentRef), null);
    assert.equal(Object.isFrozen(patientSnapshot.currentRef), true);
    const replacement = patientInsight.prepare(Object.freeze({ expected: patientSnapshot.currentRef }));
    assert.ok(replacement);
    assert.equal(secondPatientInsight.commit(Object.freeze({
        expected: secondPatientInsight.snapshot()!.currentRef, replacement,
    } as never)), false);
    assert.equal(ocr.commit(Object.freeze({ expected: ocrSnapshot.currentRef, replacement } as never)), false);
    assert.equal(documentSynthesis.commit(Object.freeze({ expected: documentSnapshot.currentRef, replacement } as never)), false);
    assert.equal(treatmentReasoning.commit(Object.freeze({ expected: treatmentReasoning.snapshot()!.currentRef, replacement } as never)), false);
    assert.equal(patientInsight.commit(Object.freeze({ expected: patientSnapshot.currentRef, replacement })), true);
    assert.equal(patientInsight.snapshot()!.terminal, true);
    assert.equal(patientInsight.commit(Object.freeze({ expected: patientSnapshot.currentRef, replacement })), false);
    assert.equal(patientInsight.abort(Object.freeze({ replacement })), false);
});

test('mints a data-only durable review commit port that remains owner-locked until disposal', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintDurableReviewCommitPort(value);
    assert.equal(Object.getPrototypeOf(port), null);
    assert.equal(Object.isFrozen(port), true);
    assert.deepEqual(Object.keys(port), []);
    assert.equal(spendDurableReviewCommitPort(port), true);
    assert.equal(spendDurableReviewCommitPort(port), false);
    assert.throws(() => owner.mintDurableReviewCommitPort(value),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'stale_selection');
    disposeDurableReviewCommitPort(port);
    assert.doesNotThrow(() => owner.mintDurableReviewCommitPort(value));
});

function assertNoBigIntInDescriptors(value: unknown, seen = new Set<object>()): void {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null || seen.has(value)) return;
    seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if ('value' in descriptor) {
            assert.notEqual(typeof descriptor.value, 'bigint');
            assertNoBigIntInDescriptors(descriptor.value, seen);
        }
    }
}

test('Document Synthesis lineage opens, verifies, burns, and exposes neither counters nor serializable authority', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintDocumentSynthesisSourceLineagePort(value);
    assert.equal(Object.getPrototypeOf(port), null); assert.equal(Object.isFrozen(port), true);
    assert.deepEqual(Object.keys(port), ['open', 'verify', 'burn', 'observeRevocation']);
    const first = port.open(); const grant = port.open();
    assert.ok(first); assert.ok(grant); assert.notEqual(first, grant);
    assert.equal(Object.getPrototypeOf(grant), null); assert.equal(Object.isFrozen(grant), true);
    assert.equal(JSON.stringify(grant), '{}'); assertNoBigIntInDescriptors([port, first, grant]);
    const capability = port.verify(grant);
    assert.ok(capability); assert.notEqual(capability, grant);
    assert.equal(Object.getPrototypeOf(capability), null); assert.equal(Object.isFrozen(capability), true);
    assert.equal(JSON.stringify(capability), '{}'); assertNoBigIntInDescriptors(capability);
    assert.equal(port.verify(grant), null);
    assert.equal(port.burn(grant), false);
    assert.equal(port.burn(capability), true);
    assert.equal(port.burn(capability), false);
    assert.equal(port.observeRevocation(capability), false);
});

test('Document Synthesis lineage denies forged, cloned, proxied, accessor, prototype, symbol, and thenable capabilities without traps', () => {
    const { value, owner } = ownerWithSelection(); const port = owner.mintDocumentSynthesisSourceLineagePort(value);
    const grant = port.open(); assert.ok(grant);
    let reads = 0; let traps = 0;
    const proxy = new Proxy(grant, { get() { traps += 1; throw new Error('synthetic trap'); } });
    const accessor = Object.freeze(Object.defineProperty({}, 'value', { enumerable: true, get() { reads += 1; return grant; } }));
    const custom = Object.freeze(Object.create({ grant }));
    const symbolic = Object.freeze({ [Symbol('synthetic')]: grant });
    const hidden = Object.freeze(Object.defineProperty({}, 'grant', { value: grant }));
    const thenable = Object.freeze(Object.defineProperty({}, 'then', { enumerable: true, get() { reads += 1; return () => undefined; } }));
    for (const forged of [null, Object.freeze(Object.create(null)), Object.freeze({ ...grant}), Object.freeze(structuredClone(grant)), proxy, accessor, custom, symbolic, hidden, thenable]) {
        assert.equal(port.verify(forged), null); assert.equal(port.burn(forged), false); assert.equal(port.observeRevocation(forged), false);
    }
    assert.equal(reads, 0); assert.equal(traps, 0);
    assert.ok(port.verify(grant), 'forged verification must not consume the authentic grant');
});

test('Document Synthesis lineage revocation is owner-wide, repeat-idempotent, and cross-owner/session closed', () => {
    const source = readFileSync(new URL('./server-session-projection-owner.ts', import.meta.url), 'utf8');
    assert.match(source, /observeDocumentSynthesisRevocation\(documentSynthesisLineage, entry\.revocationTarget\)/u);
    assert.doesNotMatch(source, /entry\.revocationState/u);
    assert.match(source, /weakMapSet, records, \[currentnessTarget, entry\]/u);
    const first = ownerWithSelection(); const firstPort = first.owner.mintDocumentSynthesisSourceLineagePort(first.value);
    const grant = firstPort.open(); assert.ok(grant); const capability = firstPort.verify(grant); assert.ok(capability);
    assert.equal(firstPort.observeRevocation(capability), true);
    assert.equal(firstPort.observeRevocation(capability), true);
    assert.equal(firstPort.burn(capability), false);
    const unaffected = firstPort.open(); assert.ok(unaffected); const unaffectedCapability = firstPort.verify(unaffected); assert.ok(unaffectedCapability);
    assert.equal(firstPort.observeRevocation(unaffectedCapability), true, 'a distinct target advances the owner-wide lineage once');
    assert.equal(firstPort.burn(unaffectedCapability), false, 'a revoked target cannot be replayed');
    const second = ownerWithSelection(); const secondPort = second.owner.mintDocumentSynthesisSourceLineagePort(second.value);
    assert.equal(secondPort.verify(grant), null); assert.equal(secondPort.observeRevocation(capability), false);
    const live = firstPort.open(); assert.ok(live);
    deleteSession(first.value.id);
    assert.equal(firstPort.verify(live), null); assert.equal(firstPort.open(), null);
    const disposed = ownerWithSelection(); const disposedPort = disposed.owner.mintDocumentSynthesisSourceLineagePort(disposed.value);
    const pending = disposedPort.open(); assert.ok(pending); disposed.owner.dispose();
    assert.equal(disposedPort.verify(pending), null); assert.equal(disposedPort.open(), null);
    const restarted = ownerWithSelection(); const restartedPort = restarted.owner.mintDocumentSynthesisSourceLineagePort(restarted.value);
    const restartGrant = restartedPort.open(); assert.ok(restartGrant); clearAllSessions();
    assert.equal(restartedPort.verify(restartGrant), null);
});

test('Document Synthesis lineage poisons nested owner port operations and leaves no denied publication residue', () => {
    let armed = false; let nested: unknown = undefined; let calls = 0;
    const registry = createServerSessionProjectionOwnerRegistry({
        resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
        clock: () => { if (armed && ++calls === 2) nested = port.open(); return 1_000; },
    });
    const value = session(); const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const port = owner.mintDocumentSynthesisSourceLineagePort(value);
    armed = true; calls = 0;
    assert.equal(port.open(), null); assert.equal(nested, null);
    armed = false;
    const grant = port.open(); assert.ok(grant);
    const capability = port.verify(grant); assert.ok(capability);
    assert.equal(port.burn(capability), true);
});

test('Document Synthesis lineage ignores ambient then while performing synchronous opaque operations', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); let reads = 0;
    const { value, owner } = ownerWithSelection(); const port = owner.mintDocumentSynthesisSourceLineagePort(value);
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    try {
        const grant = port.open(); assert.ok(grant); const capability = port.verify(grant); assert.ok(capability);
        assert.equal(port.burn(capability), true);
    } finally {
        if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor); else delete (Object.prototype as { then?: unknown }).then;
    }
    assert.equal(reads, 0);
});

test('Document Synthesis attachment capture retains owner-private evidence through a burned opaque grant', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintDocumentSynthesisAttachmentCapturePort(value);
    assert.equal(Object.getPrototypeOf(port), null); assert.equal(Object.isFrozen(port), true);
    assert.deepEqual(Object.keys(port), ['observeCurrentness', 'begin', 'retain', 'sealRetainedProjection', 'observeRevocation']);
    const capture = port.observeCurrentness(currentness()); assert.ok(capture);
    assert.equal(Object.getPrototypeOf(capture), null); assert.equal(Object.isFrozen(capture), true);
    const grant = port.begin(capture); assert.ok(grant); assert.equal(port.begin(capture), null);
    const retained = port.retain(Object.freeze({ grant, observedCurrentness: currentness(), projection: projection('ocr_text') }));
    assert.ok(retained); assert.equal(Object.getPrototypeOf(retained), null); assert.equal(Object.isFrozen(retained), true);
    assert.deepEqual(Object.keys(retained), []); assert.equal(JSON.stringify(retained), '{}');
    assertNoBigIntInDescriptors([port, capture, grant, retained]);
    assert.equal(port.retain(Object.freeze({ grant, observedCurrentness: currentness(), projection: projection() })), null);
    const seal = port.sealRetainedProjection(retained); assert.ok(seal);
    assert.equal(Object.getPrototypeOf(seal), null); assert.equal(Object.isFrozen(seal), true);
    assert.deepEqual(Object.keys(seal), []); assert.equal(JSON.stringify(seal), '{}');
    assertNoBigIntInDescriptors([port, capture, grant, retained, seal]);
    assert.equal(port.sealRetainedProjection(retained), null);
    assert.equal(port.observeRevocation(retained), false);
    assert.equal(port.observeRevocation(seal), true); assert.equal(port.observeRevocation(seal), true);
});

test('Document Synthesis attachment seal rereads private source and revocation lineage snapshots at its final fence', () => {
    const source = readFileSync(new URL('./server-session-projection-owner.ts', import.meta.url), 'utf8');
    assert.match(source, /const finalSourceSetEpoch = entry\.sourceSetEpoch;\s+const finalRevocationGeneration = entry\.revocationGeneration;/u);
    assert.match(source, /finalSourceSetEpoch !== sourceSetEpoch \|\| finalRevocationGeneration !== revocationGeneration/u);
    assert.match(source, /finalNextSourceSetEpoch !== nextSourceSetEpoch \|\| finalLineageRevocationGeneration !== lineageRevocationGeneration/u);

    const { value, owner } = ownerWithSelection(); const port = owner.mintDocumentSynthesisAttachmentCapturePort(value);
    const firstCapture = port.observeCurrentness(currentness(1, 1, 'document-source.synthetic.a')); assert.ok(firstCapture);
    const firstGrant = port.begin(firstCapture); assert.ok(firstGrant);
    const firstEvidence = port.retain(Object.freeze({ grant: firstGrant, observedCurrentness: currentness(1, 1, 'document-source.synthetic.a'), projection: projection() })); assert.ok(firstEvidence);
    const secondCapture = port.observeCurrentness(currentness(1, 1, 'document-source.synthetic.b')); assert.ok(secondCapture);
    const secondGrant = port.begin(secondCapture); assert.ok(secondGrant);
    const secondEvidence = port.retain(Object.freeze({ grant: secondGrant, observedCurrentness: currentness(1, 1, 'document-source.synthetic.b'), projection: projection('ocr_text') })); assert.ok(secondEvidence);
    assert.equal(port.sealRetainedProjection(firstEvidence), null, 'a subsequent authentic source allocation drifts the first lineage snapshot');
    assert.ok(port.sealRetainedProjection(secondEvidence));
});

test('Document Synthesis sealed evidence consumes one owner-bound seal into only the canonical provider projection and raw32 digest', () => {
    const { value, owner } = ownerWithSelection(); const capturePort = owner.mintDocumentSynthesisAttachmentCapturePort(value);
    const capture = capturePort.observeCurrentness(currentness()); assert.ok(capture);
    const grant = capturePort.begin(capture); assert.ok(grant);
    const retained = capturePort.retain(Object.freeze({ grant, observedCurrentness: currentness(), projection: projection('ocr_text') })); assert.ok(retained);
    const seal = capturePort.sealRetainedProjection(retained); assert.ok(seal);
    const evidencePort = owner.mintDocumentSynthesisSealedEvidencePort(value);
    assert.equal(Object.getPrototypeOf(evidencePort), null); assert.equal(Object.isFrozen(evidencePort), true);
    assert.deepEqual(Object.keys(evidencePort), ['begin', 'consume']);
    const evidenceGrant = evidencePort.begin(seal); assert.ok(evidenceGrant);
    const output = evidencePort.consume(evidenceGrant); assert.ok(output);
    assert.equal(Object.getPrototypeOf(output), null); assert.equal(Object.isFrozen(output), true);
    assert.deepEqual(Object.keys(output), ['providerProjection', 'sourceSetDigestSha256']);
    assert.equal(Object.getPrototypeOf(output.providerProjection), null); assert.equal(Object.isFrozen(output.providerProjection), true);
    assert.equal(output.providerProjection.label, 'S1'); assert.equal(output.providerProjection.sourceText, 'Synthetic source.');
    assert.equal(Object.isFrozen(output.sourceSetDigestSha256), true); assert.equal(output.sourceSetDigestSha256.length, 32);
    assertNoBigIntInDescriptors(output); assert.equal(evidencePort.consume(evidenceGrant), null); assert.equal(evidencePort.begin(seal), null);
    assert.equal(capturePort.observeRevocation(seal), false);
    const laterCapture = capturePort.observeCurrentness(currentness(1, 1, 'document-source.synthetic.later')); assert.ok(laterCapture);
    const laterGrant = capturePort.begin(laterCapture); assert.ok(laterGrant); const laterRetained = capturePort.retain(Object.freeze({ grant: laterGrant, observedCurrentness: currentness(1, 1, 'document-source.synthetic.later'), projection: projection() })); assert.ok(laterRetained);
    const laterSeal = capturePort.sealRetainedProjection(laterRetained); assert.ok(laterSeal); assert.ok(owner.mintDocumentSynthesisSealedEvidencePort(value).begin(laterSeal));
    const projectionDigest = Array.from(createHash('sha256').update(new TextEncoder().encode('Synthetic source.')).digest());
    const expected = digestDocumentSynthesisSourceSet(Object.freeze({ sourceSetEpoch: BigInt(1), revocationGeneration: BigInt(0), sources: Object.freeze([
        Object.freeze({ label: 'S1', documentSourceRef: 'document-source.synthetic.01', documentRevision: BigInt(1),
            documentFreshnessEpoch: BigInt(1), sourceByteLength: 17, projectionDigestSha256: Object.freeze(projectionDigest) }),
    ]) }));
    assert.equal(expected.status, 'available'); assert.deepEqual(output.sourceSetDigestSha256, expected.sourceSetDigestSha256);
});

test('Document Synthesis sealed evidence burns hostile, stale, revoked, cross-owner, and lineage-drift authority without observation', () => {
    const makeSeal = () => {
        const fixture = ownerWithSelection(); const capturePort = fixture.owner.mintDocumentSynthesisAttachmentCapturePort(fixture.value);
        const capture = capturePort.observeCurrentness(currentness()); assert.ok(capture); const grant = capturePort.begin(capture); assert.ok(grant);
        const retained = capturePort.retain(Object.freeze({ grant, observedCurrentness: currentness(), projection: projection() })); assert.ok(retained);
        const seal = capturePort.sealRetainedProjection(retained); assert.ok(seal);
        return { ...fixture, capturePort, seal, evidencePort: fixture.owner.mintDocumentSynthesisSealedEvidencePort(fixture.value) };
    };
    const hostile = makeSeal(); let reads = 0; let traps = 0;
    const proxy = new Proxy(hostile.seal, { get() { traps += 1; throw new Error('synthetic trap'); } });
    const accessor = Object.freeze(Object.defineProperty({}, 'seal', { enumerable: true, get() { reads += 1; return hostile.seal; } }));
    const thenable = Object.freeze(Object.defineProperty({}, 'then', { enumerable: true, get() { reads += 1; return () => undefined; } }));
    for (const forged of [null, Object.freeze({ ...hostile.seal }), structuredClone(hostile.seal), proxy, accessor,
        Object.freeze(Object.create({ seal: hostile.seal })), Object.freeze({ [Symbol('synthetic')]: hostile.seal }),
        Object.freeze(Object.defineProperty({}, 'seal', { value: hostile.seal })), thenable]) assert.equal(hostile.evidencePort.begin(forged), null);
    assert.equal(reads, 0); assert.equal(traps, 0); assert.ok(hostile.evidencePort.begin(hostile.seal));
    const foreign = ownerWithSelection(); assert.equal(foreign.owner.mintDocumentSynthesisSealedEvidencePort(foreign.value).begin(hostile.seal), null);
    const revoked = makeSeal(); const revokedGrant = revoked.evidencePort.begin(revoked.seal); assert.ok(revokedGrant);
    assert.equal(revoked.capturePort.observeRevocation(revoked.seal), true); assert.equal(revoked.evidencePort.consume(revokedGrant), null);
    const stale = makeSeal(); const staleGrant = stale.evidencePort.begin(stale.seal); assert.ok(staleGrant);
    assert.ok(stale.capturePort.observeCurrentness(currentness(2, 2))); assert.equal(stale.evidencePort.consume(staleGrant), null);
    const drift = makeSeal(); const driftGrant = drift.evidencePort.begin(drift.seal); assert.ok(driftGrant);
    const other = drift.capturePort.observeCurrentness(currentness(1, 1, 'document-source.synthetic.other')); assert.ok(other);
    const otherGrant = drift.capturePort.begin(other); assert.ok(otherGrant);
    assert.ok(drift.capturePort.retain(Object.freeze({ grant: otherGrant, observedCurrentness: currentness(1, 1, 'document-source.synthetic.other'), projection: projection() })));
    assert.equal(drift.evidencePort.consume(driftGrant), null);
});

test('Document Synthesis sealed evidence burns on final selection, expiry, logout, disposal, restart, and ambient-then drift', () => {
    const make = () => {
        const fixture = ownerWithSelection(); const capturePort = fixture.owner.mintDocumentSynthesisAttachmentCapturePort(fixture.value);
        const capture = capturePort.observeCurrentness(currentness()); assert.ok(capture); const ingest = capturePort.begin(capture); assert.ok(ingest);
        const retained = capturePort.retain(Object.freeze({ grant: ingest, observedCurrentness: currentness(), projection: projection() })); assert.ok(retained);
        const seal = capturePort.sealRetainedProjection(retained); assert.ok(seal); const evidence = fixture.owner.mintDocumentSynthesisSealedEvidencePort(fixture.value);
        const grant = evidence.begin(seal); assert.ok(grant); return { ...fixture, evidence, grant };
    };
    const reselection = make(); reselection.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
    assert.equal(reselection.evidence.consume(reselection.grant), null); assert.equal(reselection.evidence.consume(reselection.grant), null);
    const expiry = make(); expiry.setClock(expiry.value.expiresAt); assert.equal(expiry.evidence.consume(expiry.grant), null);
    const logout = make(); deleteSession(logout.value.id); assert.equal(logout.evidence.consume(logout.grant), null);
    const disposal = make(); disposal.owner.dispose(); assert.equal(disposal.evidence.consume(disposal.grant), null);
    const restart = make(); clearAllSessions(); assert.equal(restart.evidence.consume(restart.grant), null);
    const ambient = make(); const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); let reads = 0;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    try { assert.ok(ambient.evidence.consume(ambient.grant)); } finally {
        if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor); else delete (Object.prototype as { then?: unknown }).then;
    }
    assert.equal(reads, 0);
});

test('Document Synthesis sealed evidence burns at begin after a later allocation or unrelated owner-wide revocation', () => {
    const fixture = ownerWithSelection(); const capturePort = fixture.owner.mintDocumentSynthesisAttachmentCapturePort(fixture.value);
    const capture = capturePort.observeCurrentness(currentness(1, 1, 'document-source.synthetic.first')); assert.ok(capture);
    const grant = capturePort.begin(capture); assert.ok(grant);
    const retained = capturePort.retain(Object.freeze({ grant, observedCurrentness: currentness(1, 1, 'document-source.synthetic.first'), projection: projection() })); assert.ok(retained);
    const seal = capturePort.sealRetainedProjection(retained); assert.ok(seal);
    const laterCapture = capturePort.observeCurrentness(currentness(1, 1, 'document-source.synthetic.second')); assert.ok(laterCapture);
    const laterGrant = capturePort.begin(laterCapture); assert.ok(laterGrant);
    const laterEvidence = capturePort.retain(Object.freeze({ grant: laterGrant,
        observedCurrentness: currentness(1, 1, 'document-source.synthetic.second'), projection: projection() })); assert.ok(laterEvidence);
    assert.equal(fixture.owner.mintDocumentSynthesisSealedEvidencePort(fixture.value).begin(seal), null);
    assert.equal(fixture.owner.mintDocumentSynthesisSealedEvidencePort(fixture.value).begin(seal), null);

    const revoked = ownerWithSelection(); const revokedPort = revoked.owner.mintDocumentSynthesisAttachmentCapturePort(revoked.value);
    const revokedCapture = revokedPort.observeCurrentness(currentness()); assert.ok(revokedCapture); const revokedGrant = revokedPort.begin(revokedCapture); assert.ok(revokedGrant);
    const revokedEvidence = revokedPort.retain(Object.freeze({ grant: revokedGrant, observedCurrentness: currentness(), projection: projection() })); assert.ok(revokedEvidence);
    const revokedSeal = revokedPort.sealRetainedProjection(revokedEvidence); assert.ok(revokedSeal);
    const lineage = revoked.owner.mintDocumentSynthesisSourceLineagePort(revoked.value); const lineageGrant = lineage.open(); assert.ok(lineageGrant);
    const lineageCapability = lineage.verify(lineageGrant); assert.ok(lineageCapability); assert.equal(lineage.observeRevocation(lineageCapability), true);
    assert.equal(revoked.owner.mintDocumentSynthesisSealedEvidencePort(revoked.value).begin(revokedSeal), null);
});

function sealedDocumentSynthesisRecord(onClock: (() => void) | null = null) {
    const fixture = ownerWithSelection(1_000, onClock); const capturePort = fixture.owner.mintDocumentSynthesisAttachmentCapturePort(fixture.value);
    const capture = capturePort.observeCurrentness(currentness()); assert.ok(capture);
    const grant = capturePort.begin(capture); assert.ok(grant);
    const retained = capturePort.retain(Object.freeze({ grant, observedCurrentness: currentness(), projection: projection() })); assert.ok(retained);
    const seal = capturePort.sealRetainedProjection(retained); assert.ok(seal);
    return { ...fixture, capturePort, capture, grant, retained, seal,
        capsules: fixture.owner.mintDocumentSynthesisExecutionCapsulePort(fixture.value) };
}

test('Document Synthesis sealed evidence disposal burns one exact seal and every capture alias', () => {
    const record = sealedDocumentSynthesisRecord();
    const disposal = record.owner.mintDocumentSynthesisSealedEvidenceDisposalPort(record.value);
    const evidence = record.owner.mintDocumentSynthesisSealedEvidencePort(record.value);
    const evidenceGrant = evidence.begin(record.seal); assert.ok(evidenceGrant);
    assert.equal(Object.getPrototypeOf(disposal), null); assert.equal(Object.isFrozen(disposal), true);
    assert.deepEqual(Object.keys(disposal), ['discard']);
    assert.equal(disposal.discard(record.seal), true);
    for (const alias of [record.capture, record.grant, record.retained, record.seal]) {
        assert.equal(record.capturePort.observeRevocation(alias), false);
    }
    assert.equal(evidence.consume(evidenceGrant), null);
    assert.equal(record.capsules.promote(record.seal), null);
    assert.equal(record.owner.mintDocumentSynthesisSealedEvidencePort(record.value).begin(record.seal), null);
    assert.equal(disposal.discard(record.seal), false);
});

test('Document Synthesis sealed evidence disposal remains burn-only after owner lifecycle drift', () => {
    const cases: readonly ((record: ReturnType<typeof sealedDocumentSynthesisRecord>) => void)[] = [
        (record) => { assert.ok(record.capturePort.observeCurrentness(currentness(2, 2))); },
        (record) => {
            const lineage = record.owner.mintDocumentSynthesisSourceLineagePort(record.value);
            const grant = lineage.open(); assert.ok(grant); const capability = lineage.verify(grant); assert.ok(capability);
            assert.equal(lineage.observeRevocation(capability), true);
        },
        (record) => { record.owner.issueSelection({ expectedEpoch: 1, ...PAIR }); },
        (record) => { record.setClock(record.value.expiresAt); },
        (record) => { deleteSession(record.value.id); },
        () => { clearAllSessions(); },
        (record) => { record.owner.dispose(); },
    ];
    for (const drift of cases) {
        const record = sealedDocumentSynthesisRecord();
        const disposal = record.owner.mintDocumentSynthesisSealedEvidenceDisposalPort(record.value);
        drift(record);
        assert.equal(disposal.discard(record.seal), true);
        assert.equal(disposal.discard(record.seal), false);
        for (const alias of [record.capture, record.grant, record.retained, record.seal]) {
            assert.equal(record.capturePort.observeRevocation(alias), false);
        }
    }
});

test('Document Synthesis sealed evidence disposal rejects hostile and foreign seals without observation', async () => {
    const record = sealedDocumentSynthesisRecord(); const disposal = record.owner.mintDocumentSynthesisSealedEvidenceDisposalPort(record.value);
    let reads = 0; let traps = 0;
    const proxy = new Proxy(record.seal, { get() { traps += 1; throw new Error('synthetic trap'); },
        ownKeys() { traps += 1; throw new Error('synthetic trap'); } });
    const accessor = Object.freeze(Object.defineProperty({}, 'seal', { enumerable: true, get() { reads += 1; return record.seal; } }));
    const thenable = Object.freeze(Object.defineProperty({}, 'then', { enumerable: true, get() { reads += 1; return () => undefined; } }));
    for (const forged of [null, Object.freeze({ ...record.seal }), structuredClone(record.seal),
        Object.freeze(Object.create(record.seal)), proxy, accessor, Object.freeze({ [Symbol('seal')]: record.seal }),
        Object.freeze(Object.defineProperty({}, 'seal', { value: record.seal })), thenable]) {
        assert.equal(disposal.discard(forged), false);
    }
    const foreign = sealedDocumentSynthesisRecord();
    assert.equal(foreign.owner.mintDocumentSynthesisSealedEvidenceDisposalPort(foreign.value).discard(record.seal), false);
    const copyUrl = new URL('./server-session-projection-owner.ts', import.meta.url); copyUrl.search = 'copy=sealed-evidence-disposal';
    const moduleCopy = await import(copyUrl.href);
    const copyRegistry = moduleCopy.createServerSessionProjectionOwnerRegistry({
        clock: () => 1_000, entropy: () => new Uint8Array(16),
        resolve: (_session: ServerSession, pair: typeof PAIR) => Object.freeze({ ...pair }),
    });
    const copyOwner = copyRegistry.acquire(record.value); copyOwner.issueSelection({ expectedEpoch: 0, ...PAIR });
    assert.equal(copyOwner.mintDocumentSynthesisSealedEvidenceDisposalPort(record.value).discard(record.seal), false);
    assert.equal(reads, 0); assert.equal(traps, 0); assert.equal(disposal.discard(record.seal), true);
});

test('Document Synthesis sealed evidence disposal avoids ambient callbacks and poisoned registries', () => {
    let nested = 0; let reads = 0;
    const record = sealedDocumentSynthesisRecord(() => { nested += 1; });
    const disposal = record.owner.mintDocumentSynthesisSealedEvidenceDisposalPort(record.value);
    nested = 0;
    const descriptors = {
        then: Object.getOwnPropertyDescriptor(Object.prototype, 'then'), get: Object.getOwnPropertyDescriptor(WeakMap.prototype, 'get'),
        remove: Object.getOwnPropertyDescriptor(WeakMap.prototype, 'delete'), weakRemove: Object.getOwnPropertyDescriptor(WeakSet.prototype, 'delete'),
        iterator: Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator),
    };
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; record.owner.dispose(); return undefined; } });
    Object.defineProperty(WeakMap.prototype, 'get', { configurable: true, value() { nested += 1; disposal.discard(record.seal); throw new Error('synthetic get trap'); } });
    Object.defineProperty(WeakMap.prototype, 'delete', { configurable: true, value() { nested += 1; record.owner.dispose(); throw new Error('synthetic delete trap'); } });
    Object.defineProperty(WeakSet.prototype, 'delete', { configurable: true, value() { nested += 1; throw new Error('synthetic weak-set trap'); } });
    Object.defineProperty(Array.prototype, Symbol.iterator, { configurable: true, value() { nested += 1; throw new Error('synthetic iterator trap'); } });
    try { assert.equal(disposal.discard(record.seal), true); } finally {
        if (descriptors.then) Object.defineProperty(Object.prototype, 'then', descriptors.then); else delete (Object.prototype as { then?: unknown }).then;
        Object.defineProperty(WeakMap.prototype, 'get', descriptors.get!); Object.defineProperty(WeakMap.prototype, 'delete', descriptors.remove!);
        Object.defineProperty(WeakSet.prototype, 'delete', descriptors.weakRemove!);
        Object.defineProperty(Array.prototype, Symbol.iterator, descriptors.iterator!);
    }
    assert.equal(reads, 0); assert.equal(nested, 0); assert.equal(disposal.discard(record.seal), false);
});

test('Document Synthesis sealed evidence disposal remains private to the owner before A3c3', () => {
    const ownerSource = new URL('./server-session-projection-owner.ts', import.meta.url);
    const root = new URL('../../', import.meta.url);
    const references = ['app', 'components', 'lib', 'packages', 'scripts'].flatMap((directory) => {
        try { return productionTypeScriptFiles(new URL(`${directory}/`, root)); } catch { return []; }
    }).filter((file) => readFileSync(file, 'utf8').includes('DocumentSynthesisSealedEvidenceDisposalPort'))
        .map((file) => file.href).sort();
    assert.deepEqual(references, [ownerSource.href]);
});

function documentSynthesisExecutionCapsuleIdentityRecord(onClock: (() => void) | null = null) {
    const fixture = sealedDocumentSynthesisRecord(onClock);
    const capsule = fixture.capsules.promote(fixture.seal); assert.ok(capsule);
    return { ...fixture, capsule,
        identities: fixture.owner.mintDocumentSynthesisExecutionCapsuleIdentityPort(fixture.value) };
}

test('Document Synthesis execution capsule promotes one authentic seal into a frozen zero-field inert value', () => {
    const { owner, value, seal, capsules } = sealedDocumentSynthesisRecord();
    assert.equal(Object.getPrototypeOf(capsules), null); assert.equal(Object.isFrozen(capsules), true);
    assert.deepEqual(Object.keys(capsules), ['promote']);
    const capsule = capsules.promote(seal); assert.ok(capsule);
    assert.equal(Object.getPrototypeOf(capsule), null); assert.equal(Object.isFrozen(capsule), true);
    assert.deepEqual(Object.keys(capsule), []); assert.deepEqual(Object.getOwnPropertySymbols(capsule), []);
    assert.equal(JSON.stringify(capsule), '{}'); assertNoBigIntInDescriptors([capsules, capsule]);
    assert.equal(capsules.promote(seal), null); assert.equal(capsules.promote(capsule), null);
    assert.equal(owner.mintDocumentSynthesisSealedEvidencePort(value).begin(seal), null);
});

test('Document Synthesis execution capsule identity retains and consumes one exact capsule reference', () => {
    const record = documentSynthesisExecutionCapsuleIdentityRecord();
    assert.equal(Object.getPrototypeOf(record.identities), null); assert.equal(Object.isFrozen(record.identities), true);
    assert.deepEqual(Object.keys(record.identities), ['retain', 'consume']);
    const token = record.identities.retain(record.capsule); assert.ok(token);
    assert.equal(Object.getPrototypeOf(token), null); assert.equal(Object.isFrozen(token), true);
    assert.deepEqual(Object.keys(token), []); assert.deepEqual(Object.getOwnPropertySymbols(token), []);
    assert.equal(JSON.stringify(token), '{}'); assertNoBigIntInDescriptors([record.identities, token]);
    assert.equal(record.identities.retain(record.capsule), null);
    assert.equal(record.identities.consume(token), record.capsule);
    assert.equal(record.identities.consume(token), null);
});

test('Document Synthesis execution capsule identity rejects forged, foreign, and hostile values without observation', () => {
    const record = documentSynthesisExecutionCapsuleIdentityRecord(); let reads = 0; let traps = 0;
    const proxy = new Proxy(record.capsule, { get() { traps += 1; throw new Error('synthetic trap'); },
        ownKeys() { traps += 1; throw new Error('synthetic trap'); } });
    const accessor = Object.freeze(Object.defineProperty({}, 'capsule', { enumerable: true, get() { reads += 1; return record.capsule; } }));
    const nonEnumerable = Object.freeze(Object.defineProperty({}, 'capsule', { enumerable: false, value: record.capsule }));
    const symbol = Object.freeze({ [Symbol('capsule')]: record.capsule });
    const thenable = Object.freeze(Object.defineProperty({}, 'then', { enumerable: true, get() { reads += 1; return () => undefined; } }));
    for (const forged of [null, Object.freeze({ ...record.capsule }), structuredClone(record.capsule),
        Object.freeze(Object.create(record.capsule)), proxy, accessor, nonEnumerable, symbol, thenable]) {
        assert.equal(record.identities.retain(forged), null);
    }
    const foreign = documentSynthesisExecutionCapsuleIdentityRecord(); assert.equal(foreign.identities.retain(record.capsule), null);
    const token = record.identities.retain(record.capsule); assert.ok(token);
    const tokenProxy = new Proxy(token, { get() { traps += 1; throw new Error('synthetic trap'); } });
    for (const forged of [Object.freeze({ ...token }), structuredClone(token), tokenProxy, accessor, nonEnumerable, symbol, thenable]) {
        assert.equal(record.identities.consume(forged), null);
    }
    assert.equal(reads, 0); assert.equal(traps, 0); assert.equal(record.identities.consume(token), record.capsule);
});

test('Document Synthesis execution capsule identity burns on currentness, lineage, selection, and session drift', () => {
    const source = documentSynthesisExecutionCapsuleIdentityRecord(); const sourceToken = source.identities.retain(source.capsule); assert.ok(sourceToken);
    assert.ok(source.capturePort.observeCurrentness(currentness(2, 2))); assert.equal(source.identities.consume(sourceToken), null);

    const lineage = documentSynthesisExecutionCapsuleIdentityRecord(); const lineageToken = lineage.identities.retain(lineage.capsule); assert.ok(lineageToken);
    const lineagePort = lineage.owner.mintDocumentSynthesisSourceLineagePort(lineage.value);
    const lineageGrant = lineagePort.open(); assert.ok(lineageGrant); const lineageCapability = lineagePort.verify(lineageGrant); assert.ok(lineageCapability);
    assert.equal(lineagePort.observeRevocation(lineageCapability), true); assert.equal(lineage.identities.consume(lineageToken), null);

    const selection = documentSynthesisExecutionCapsuleIdentityRecord(); const selectionToken = selection.identities.retain(selection.capsule); assert.ok(selectionToken);
    selection.owner.issueSelection({ expectedEpoch: 1, ...PAIR }); assert.equal(selection.identities.consume(selectionToken), null);
    const freshPort = selection.owner.mintDocumentSynthesisExecutionCapsuleIdentityPort(selection.value);
    assert.equal(freshPort.retain(selection.capsule), null, 'a new post-reselection port cannot adopt the old capsule');
    const unclaimed = documentSynthesisExecutionCapsuleIdentityRecord(); unclaimed.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
    const postReselection = unclaimed.owner.mintDocumentSynthesisExecutionCapsuleIdentityPort(unclaimed.value);
    assert.equal(postReselection.retain(unclaimed.capsule), null, 'an unclaimed old capsule remains bound to its original selection');
    const expiry = documentSynthesisExecutionCapsuleIdentityRecord(); const expiryToken = expiry.identities.retain(expiry.capsule); assert.ok(expiryToken);
    expiry.setClock(expiry.value.expiresAt); assert.equal(expiry.identities.consume(expiryToken), null);
    const logout = documentSynthesisExecutionCapsuleIdentityRecord(); const logoutToken = logout.identities.retain(logout.capsule); assert.ok(logoutToken);
    deleteSession(logout.value.id); assert.equal(logout.identities.consume(logoutToken), null);
    const disposed = documentSynthesisExecutionCapsuleIdentityRecord(); const disposedToken = disposed.identities.retain(disposed.capsule); assert.ok(disposedToken);
    disposed.owner.dispose(); assert.equal(disposed.identities.consume(disposedToken), null);

    const foreign = documentSynthesisExecutionCapsuleIdentityRecord(); const foreignToken = foreign.identities.retain(foreign.capsule); assert.ok(foreignToken);
    const other = documentSynthesisExecutionCapsuleIdentityRecord(); assert.equal(other.identities.consume(foreignToken), null);
    assert.equal(foreign.identities.consume(foreignToken), foreign.capsule);
    const restart = documentSynthesisExecutionCapsuleIdentityRecord(); const restartToken = restart.identities.retain(restart.capsule); assert.ok(restartToken);
    deleteSession(restart.value.id); const restarted = documentSynthesisExecutionCapsuleIdentityRecord();
    assert.equal(restarted.identities.consume(restartToken), null); assert.equal(restart.identities.consume(restartToken), null);
    const channel = documentSynthesisExecutionCapsuleIdentityRecord(); const channelToken = channel.identities.retain(channel.capsule); assert.ok(channelToken);
    channel.value.authChannel = 'native'; assert.equal(channel.identities.consume(channelToken), null); channel.value.authChannel = 'web';
    assert.equal(channel.identities.retain(channel.capsule), null, 'denial terminalizes the exact A3c1 capsule');
});

test('Document Synthesis execution capsule identity poisons retain, consume, and disposal reentry without residue', () => {
    let nested: (() => void) | null = null;
    const retain = documentSynthesisExecutionCapsuleIdentityRecord(() => nested?.());
    nested = () => { retain.identities.consume(Object.freeze(Object.create(null))); };
    assert.equal(retain.identities.retain(retain.capsule), null); nested = null;
    assert.equal(retain.identities.retain(retain.capsule), null);

    const consume = documentSynthesisExecutionCapsuleIdentityRecord(() => nested?.());
    const token = consume.identities.retain(consume.capsule); assert.ok(token);
    nested = () => { consume.identities.retain(consume.capsule); };
    assert.equal(consume.identities.consume(token), null); nested = null;
    assert.equal(consume.identities.consume(token), null); assert.equal(consume.identities.retain(consume.capsule), null);

    const disposal = documentSynthesisExecutionCapsuleIdentityRecord(() => nested?.());
    const disposalToken = disposal.identities.retain(disposal.capsule); assert.ok(disposalToken);
    nested = () => { disposal.owner.dispose(); };
    assert.equal(disposal.identities.consume(disposalToken), null); nested = null;
    assert.equal(disposal.identities.consume(disposalToken), null);
});

test('Document Synthesis execution capsule identity ignores ambient then and poisoned object registries', () => {
    const record = documentSynthesisExecutionCapsuleIdentityRecord(); let reads = 0;
    const descriptors = {
        then: Object.getOwnPropertyDescriptor(Object.prototype, 'then'), create: Object.getOwnPropertyDescriptor(Object, 'create'),
        freeze: Object.getOwnPropertyDescriptor(Object, 'freeze'), get: Object.getOwnPropertyDescriptor(WeakMap.prototype, 'get'),
        set: Object.getOwnPropertyDescriptor(WeakMap.prototype, 'set'), remove: Object.getOwnPropertyDescriptor(WeakMap.prototype, 'delete'),
        has: Object.getOwnPropertyDescriptor(WeakSet.prototype, 'has'), add: Object.getOwnPropertyDescriptor(WeakSet.prototype, 'add'),
    };
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    Object.defineProperty(Object, 'create', { configurable: true, value() { throw new Error('synthetic create trap'); } });
    Object.defineProperty(Object, 'freeze', { configurable: true, value() { throw new Error('synthetic freeze trap'); } });
    for (const [prototype, method] of [[WeakMap.prototype, 'get'], [WeakMap.prototype, 'set'], [WeakMap.prototype, 'delete'],
        [WeakSet.prototype, 'has'], [WeakSet.prototype, 'add']] as const) {
        Object.defineProperty(prototype, method, { configurable: true, value() { throw new Error('synthetic registry trap'); } });
    }
    let token: unknown;
    try { token = record.identities.retain(record.capsule); assert.ok(token); assert.equal(record.identities.consume(token), record.capsule); }
    finally {
        if (descriptors.then) Object.defineProperty(Object.prototype, 'then', descriptors.then); else delete (Object.prototype as { then?: unknown }).then;
        Object.defineProperty(Object, 'create', descriptors.create!); Object.defineProperty(Object, 'freeze', descriptors.freeze!);
        Object.defineProperty(WeakMap.prototype, 'get', descriptors.get!); Object.defineProperty(WeakMap.prototype, 'set', descriptors.set!);
        Object.defineProperty(WeakMap.prototype, 'delete', descriptors.remove!); Object.defineProperty(WeakSet.prototype, 'has', descriptors.has!);
        Object.defineProperty(WeakSet.prototype, 'add', descriptors.add!);
    }
    assert.equal(reads, 0);
});

test('Document Synthesis execution capsule identity remains private to the owner before A3c3', () => {
    const ownerSource = new URL('./server-session-projection-owner.ts', import.meta.url);
    const root = new URL('../../', import.meta.url);
    const references = ['app', 'components', 'lib', 'packages', 'scripts'].flatMap((directory) => {
        try { return productionTypeScriptFiles(new URL(`${directory}/`, root)); } catch { return []; }
    }).filter((file) => readFileSync(file, 'utf8').includes('DocumentSynthesisExecutionCapsuleIdentity'))
        .map((file) => file.href).sort();
    assert.deepEqual(references, [ownerSource.href]);
});

test('Document Synthesis execution capsule rejects hostile, foreign, and drifted seals without observing them', () => {
    const hostile = sealedDocumentSynthesisRecord(); let reads = 0; let traps = 0;
    const proxy = new Proxy(hostile.seal, { get() { traps += 1; throw new Error('synthetic trap'); } });
    const accessor = Object.freeze(Object.defineProperty({}, 'seal', { enumerable: true, get() { reads += 1; return hostile.seal; } }));
    const thenable = Object.freeze(Object.defineProperty({}, 'then', { enumerable: true, get() { reads += 1; return () => undefined; } }));
    for (const forged of [null, Object.freeze({ ...hostile.seal }), structuredClone(hostile.seal), proxy, accessor, thenable]) {
        assert.equal(hostile.capsules.promote(forged), null);
    }
    assert.equal(reads, 0); assert.equal(traps, 0);
    const foreign = sealedDocumentSynthesisRecord(); assert.equal(foreign.capsules.promote(hostile.seal), null);
    assert.ok(hostile.capsules.promote(hostile.seal));

    const currentnessDrift = sealedDocumentSynthesisRecord();
    assert.ok(currentnessDrift.capturePort.observeCurrentness(currentness(2, 2)));
    assert.equal(currentnessDrift.capsules.promote(currentnessDrift.seal), null);
    const reselection = sealedDocumentSynthesisRecord(); reselection.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
    assert.equal(reselection.capsules.promote(reselection.seal), null);
    const expiry = sealedDocumentSynthesisRecord(); expiry.setClock(expiry.value.expiresAt);
    assert.equal(expiry.capsules.promote(expiry.seal), null);
    const logout = sealedDocumentSynthesisRecord(); deleteSession(logout.value.id);
    assert.equal(logout.capsules.promote(logout.seal), null);
    const disposal = sealedDocumentSynthesisRecord(); disposal.owner.dispose();
    assert.equal(disposal.capsules.promote(disposal.seal), null);
});

test('Document Synthesis execution capsule promotion does not read ambient then', () => {
    const record = sealedDocumentSynthesisRecord(); const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); let reads = 0;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    try { assert.ok(record.capsules.promote(record.seal)); } finally {
        if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor); else delete (Object.prototype as { then?: unknown }).then;
    }
    assert.equal(reads, 0);
});

test('Document Synthesis execution capsule uses captured WeakMap intrinsics after prototype poisoning', () => {
    const record = sealedDocumentSynthesisRecord(); const set = Object.getOwnPropertyDescriptor(WeakMap.prototype, 'set');
    const remove = Object.getOwnPropertyDescriptor(WeakMap.prototype, 'delete');
    Object.defineProperty(WeakMap.prototype, 'set', { configurable: true, value() { throw new Error('synthetic set trap'); } });
    Object.defineProperty(WeakMap.prototype, 'delete', { configurable: true, value() { throw new Error('synthetic delete trap'); } });
    try { assert.ok(record.capsules.promote(record.seal)); } finally {
        Object.defineProperty(WeakMap.prototype, 'set', set!); Object.defineProperty(WeakMap.prototype, 'delete', remove!);
    }
    assert.equal(record.capsules.promote(record.seal), null);
});

test('Document Synthesis execution capsule burns when its clock changes the authenticated channel', () => {
    let mutateChannel = false; let value: ServerSession | null = null;
    const registry = createServerSessionProjectionOwnerRegistry({
        clock: () => { if (mutateChannel && value) value.authChannel = 'native'; return 1_000; },
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index + 1),
        resolve: (_session, pair) => Object.freeze({ ...pair }),
    });
    value = session(); const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const capturePort = owner.mintDocumentSynthesisAttachmentCapturePort(value);
    const capture = capturePort.observeCurrentness(currentness()); assert.ok(capture);
    const grant = capturePort.begin(capture); assert.ok(grant);
    const retained = capturePort.retain(Object.freeze({ grant, observedCurrentness: currentness(), projection: projection() })); assert.ok(retained);
    const seal = capturePort.sealRetainedProjection(retained); assert.ok(seal);
    const capsules = owner.mintDocumentSynthesisExecutionCapsulePort(value); mutateChannel = true;
    assert.equal(capsules.promote(seal), null);
    assert.equal(capsules.promote(seal), null);
});

test('Document Synthesis retain accepts only pre-canonical source text without hostile observation', () => {
    const retain = (sourceText: unknown) => {
        const { value, owner } = ownerWithSelection(); const port = owner.mintDocumentSynthesisAttachmentCapturePort(value);
        const capture = port.observeCurrentness(currentness()); assert.ok(capture); const grant = port.begin(capture); assert.ok(grant);
        return port.retain(Object.freeze({ grant, observedCurrentness: currentness(), projection: Object.freeze({ sourceKind: 'native_text', sourceText }) } as never));
    };
    for (const text of ['  synthetic', 'synthetic  ', 'synthetic\r\ntext', 'synthetic\u0000text', 'e\u0301', '\ud800']) assert.equal(retain(text), null);
    let reads = 0; let traps = 0;
    const accessor = Object.freeze(Object.defineProperty({ sourceKind: 'native_text' }, 'sourceText', { enumerable: true, get() { reads += 1; return 'Synthetic source.'; } }));
    const proxy = new Proxy(Object.freeze({ sourceKind: 'native_text', sourceText: 'Synthetic source.' }), { get() { traps += 1; throw new Error('synthetic trap'); } });
    for (const projectionValue of [accessor, proxy]) {
        const { value, owner } = ownerWithSelection(); const port = owner.mintDocumentSynthesisAttachmentCapturePort(value);
        const capture = port.observeCurrentness(currentness()); assert.ok(capture); const grant = port.begin(capture); assert.ok(grant);
        assert.equal(port.retain(Object.freeze({ grant, observedCurrentness: currentness(), projection: projectionValue } as never)), null);
    }
    assert.equal(reads, 0); assert.equal(traps, 0); assert.ok(retain('Synthetic source.'));
});

test('Document Synthesis attachment capture closes replay, stale currentness, foreign authority, and lifecycle changes', () => {
    const first = ownerWithSelection(); const port = first.owner.mintDocumentSynthesisAttachmentCapturePort(first.value);
    const stale = port.observeCurrentness(currentness()); assert.ok(stale);
    const fresh = port.observeCurrentness(currentness(2, 2)); assert.ok(fresh);
    assert.equal(port.begin(stale), null);
    const grant = port.begin(fresh); assert.ok(grant);
    assert.equal(port.retain(Object.freeze({ grant, observedCurrentness: currentness(), projection: projection() })), null);
    const second = ownerWithSelection(); const foreign = second.owner.mintDocumentSynthesisAttachmentCapturePort(second.value);
    assert.equal(foreign.begin(fresh), null); assert.equal(foreign.observeRevocation(grant), false);
    const reselection = port.observeCurrentness(currentness(3, 3)); assert.ok(reselection);
    first.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
    assert.equal(port.begin(reselection), null);

    const expired = ownerWithSelection(); const expiryPort = expired.owner.mintDocumentSynthesisAttachmentCapturePort(expired.value);
    const expiryCapture = expiryPort.observeCurrentness(currentness()); assert.ok(expiryCapture);
    expired.setClock(expired.value.expiresAt); assert.equal(expiryPort.begin(expiryCapture), null);
    const loggedOut = ownerWithSelection(); const logoutPort = loggedOut.owner.mintDocumentSynthesisAttachmentCapturePort(loggedOut.value);
    const logoutCapture = logoutPort.observeCurrentness(currentness()); assert.ok(logoutCapture); deleteSession(loggedOut.value.id);
    assert.equal(logoutPort.begin(logoutCapture), null);
    const disposed = ownerWithSelection(); const disposePort = disposed.owner.mintDocumentSynthesisAttachmentCapturePort(disposed.value);
    const disposeCapture = disposePort.observeCurrentness(currentness()); assert.ok(disposeCapture); disposed.owner.dispose();
    assert.equal(disposePort.begin(disposeCapture), null);
    const restarted = ownerWithSelection(); const restartPort = restarted.owner.mintDocumentSynthesisAttachmentCapturePort(restarted.value);
    const restartCapture = restartPort.observeCurrentness(currentness()); assert.ok(restartCapture); clearAllSessions();
    assert.equal(restartPort.begin(restartCapture), null);
    assert.equal(createServerSessionProjectionOwnerRegistry().lookup(first.value.id), null);
});

test('Document Synthesis attachment capture denies hostile data without observation or deferred work', async () => {
    const { value, owner } = ownerWithSelection(); const port = owner.mintDocumentSynthesisAttachmentCapturePort(value);
    let reads = 0; let traps = 0; let unhandled = 0;
    const capture = port.observeCurrentness(currentness()); assert.ok(capture);
    const captureProxy = new Proxy(capture, { get() { traps += 1; throw new Error('synthetic trap'); } });
    for (const forged of [Object.freeze(Object.create(null)), Object.freeze({ ...capture }), structuredClone(capture), captureProxy,
        Object.freeze(Object.create({ capture })), Object.freeze({ [Symbol('x')]: capture }),
        Object.freeze(Object.defineProperty({}, 'capture', { value: capture })), Object.freeze({ then() {} })]) {
        assert.equal(port.begin(forged), null); assert.equal(port.observeRevocation(forged), false);
    }
    const grant = port.begin(capture); assert.ok(grant);
    const accessor = Object.freeze(Object.defineProperty({}, 'documentSourceRef', { enumerable: true, get() { reads += 1; return 'x'; } }));
    const proxy = new Proxy(Object.freeze({ grant, observedCurrentness: currentness(), projection: projection() }), {
        get() { traps += 1; throw new Error('synthetic trap'); }, ownKeys() { traps += 1; throw new Error('synthetic trap'); },
    });
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    const onUnhandled = () => { unhandled += 1; };
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } }); process.on('unhandledRejection', onUnhandled);
    try {
        for (const hostile of [accessor, proxy, Object.freeze({ grant, observedCurrentness: currentness(), projection: projection(), extra: true }),
            Object.freeze(Object.create(null)), Object.freeze({ grant, observedCurrentness: currentness(), projection: projection(), [Symbol('x')]: true }),
            Object.freeze(Object.defineProperty({ grant, observedCurrentness: currentness(), projection: projection() }, 'hidden', { value: true })),
            Object.freeze({ grant, observedCurrentness: currentness(), projection: Object.freeze({ sourceKind: 'native_text', sourceText: 'x', then() {} }) })]) {
            assert.equal(port.retain(hostile as never), null);
        }
    } finally {
        if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor); else delete (Object.prototype as { then?: unknown }).then;
    }
    await new Promise<void>((resolve) => setImmediate(resolve)); process.off('unhandledRejection', onUnhandled);
    assert.equal(reads, 0); assert.equal(traps, 0); assert.equal(unhandled, 0);
});

test('Document Synthesis attachment capture poisons reentry before minting authority', () => {
    let armed = false; let nested = false;
    const registry = createServerSessionProjectionOwnerRegistry({
        resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
        clock: () => { if (armed) { armed = false;
            for (const mint of [() => owner.mintDocumentSynthesisAttachmentCapturePort(value), () => owner.mintPatientInsightLeaseCommitPort(value),
                () => owner.mintOcrLeaseCommitPort(value), () => owner.mintDocumentSynthesisLeaseCommitPort(value),
                () => owner.mintDocumentSynthesisSourceLineagePort(value)]) {
                assert.throws(mint, (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'selection_busy');
            } nested = true; } return 1_000; },
    });
    const value = session(); const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const port = owner.mintDocumentSynthesisAttachmentCapturePort(value);
    armed = true; assert.equal(port.observeCurrentness(currentness()), null); assert.equal(nested, true);
    const capture = port.observeCurrentness(currentness()); assert.ok(capture);
    armed = true; nested = false; assert.equal(port.begin(capture), null); assert.equal(nested, true);
    const retryCapture = port.observeCurrentness(currentness(2, 2)); assert.ok(retryCapture); const grant = port.begin(retryCapture); assert.ok(grant);
    const input = Object.freeze({ grant, observedCurrentness: currentness(2, 2), projection: projection() });
    armed = true; nested = false; assert.equal(port.retain(input), null); assert.equal(nested, true);
    const finalCapture = port.observeCurrentness(currentness(3, 3)); assert.ok(finalCapture); const finalGrant = port.begin(finalCapture); assert.ok(finalGrant);
    const retained = port.retain(Object.freeze({ grant: finalGrant, observedCurrentness: currentness(3, 3), projection: projection() })); assert.ok(retained);
    armed = true; nested = false; assert.equal(port.observeRevocation(retained), false); assert.equal(nested, true);
    assert.equal(port.observeRevocation(retained), true);
    armed = true; nested = false;
    assert.throws(() => owner.mintDocumentSynthesisAttachmentCapturePort(value),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'stale_selection');
    assert.equal(nested, true); assert.ok(owner.mintDocumentSynthesisAttachmentCapturePort(value));
});

test('Document Synthesis attachment capture burns expired, invalid-retain, and channel-drift authority', () => {
    const expired = ownerWithSelection(); const expiryPort = expired.owner.mintDocumentSynthesisAttachmentCapturePort(expired.value);
    const expiryCapture = expiryPort.observeCurrentness(currentness()); assert.ok(expiryCapture); expired.setClock(expired.value.expiresAt);
    assert.equal(expiryPort.begin(expiryCapture), null); expired.setClock(1_000); assert.equal(expiryPort.begin(expiryCapture), null);

    const invalid = ownerWithSelection(); const invalidPort = invalid.owner.mintDocumentSynthesisAttachmentCapturePort(invalid.value);
    const capture = invalidPort.observeCurrentness(currentness()); assert.ok(capture); const grant = invalidPort.begin(capture); assert.ok(grant);
    assert.equal(invalidPort.retain(Object.freeze({ grant, observedCurrentness: currentness(),
        projection: Object.freeze({ sourceKind: 'invalid', sourceText: 'synthetic' }) } as never)), null);
    assert.equal(invalidPort.retain(Object.freeze({ grant, observedCurrentness: currentness(), projection: projection() })), null);

    const channel = ownerWithSelection(); const channelPort = channel.owner.mintDocumentSynthesisAttachmentCapturePort(channel.value);
    const channelCapture = channelPort.observeCurrentness(currentness()); assert.ok(channelCapture);
    (channel.value as { authChannel: ServerSession['authChannel'] }).authChannel = 'native'; assert.equal(channelPort.begin(channelCapture), null);
    (channel.value as { authChannel: ServerSession['authChannel'] }).authChannel = 'web'; assert.equal(channelPort.begin(channelCapture), null);

    let drift = false; const hostileValue = session();
    const hostileRegistry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
        clock: () => { if (drift) (hostileValue as { authChannel: ServerSession['authChannel'] }).authChannel = 'native'; return 1_000; } });
    const hostileOwner = hostileRegistry.acquire(hostileValue); hostileOwner.issueSelection({ expectedEpoch: 0, ...PAIR });
    const hostilePort = hostileOwner.mintDocumentSynthesisAttachmentCapturePort(hostileValue); const hostileCapture = hostilePort.observeCurrentness(currentness(2, 2)); assert.ok(hostileCapture);
    drift = true; assert.equal(hostilePort.begin(hostileCapture), null); drift = false; (hostileValue as { authChannel: ServerSession['authChannel'] }).authChannel = 'web'; assert.equal(hostilePort.begin(hostileCapture), null);
    const retry = hostilePort.observeCurrentness(currentness(3, 3)); assert.ok(retry); const hostileGrant = hostilePort.begin(retry); assert.ok(hostileGrant);
    drift = true; assert.equal(hostilePort.retain(Object.freeze({ grant: hostileGrant, observedCurrentness: currentness(3, 3), projection: projection() })), null);
    drift = false; (hostileValue as { authChannel: ServerSession['authChannel'] }).authChannel = 'web'; assert.equal(hostilePort.retain(Object.freeze({ grant: hostileGrant, observedCurrentness: currentness(3, 3), projection: projection() })), null);
    const lineage = hostileOwner.mintDocumentSynthesisSourceLineagePort(hostileValue); drift = true; assert.equal(lineage.open(), null);
    drift = false; (hostileValue as { authChannel: ServerSession['authChannel'] }).authChannel = 'web'; assert.ok(lineage.open());
});

test('Document Synthesis attachment capture latches duplicate, rollback, and ABA currentness across ports', () => {
    const { value, owner } = ownerWithSelection(); const first = owner.mintDocumentSynthesisAttachmentCapturePort(value);
    const initial = first.observeCurrentness(currentness()); assert.ok(initial);
    const second = owner.mintDocumentSynthesisAttachmentCapturePort(value); const newer = second.observeCurrentness(currentness(2, 2)); assert.ok(newer);
    assert.equal(first.begin(initial), null, 'newer owner observation invalidates an older capture');
    assert.equal(first.observeCurrentness(currentness(2, 2)), null, 'duplicate latches the source');
    assert.equal(second.begin(newer), null, 'latch revokes newer capability use');
    assert.equal(second.observeCurrentness(currentness(3, 3)), null, 'latched source cannot reset');

    const rollback = ownerWithSelection(); const port = rollback.owner.mintDocumentSynthesisAttachmentCapturePort(rollback.value);
    assert.ok(port.observeCurrentness(currentness(3, 3)));
    assert.equal(port.observeCurrentness(currentness(2, 4)), null);
    assert.equal(port.observeCurrentness(currentness(4, 4)), null);
});

test('Document Synthesis attachment capture ignores a poisoned Set iterator and rejects mint at lease expiry', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Set.prototype, Symbol.iterator); let reads = 0;
    const { value, owner } = ownerWithSelection(); const port = owner.mintDocumentSynthesisAttachmentCapturePort(value);
    Object.defineProperty(Set.prototype, Symbol.iterator, { configurable: true, get() { reads += 1; throw new Error('synthetic iterator'); } });
    try { assert.ok(port.observeCurrentness(currentness())); } finally {
        if (descriptor) Object.defineProperty(Set.prototype, Symbol.iterator, descriptor); else delete (Set.prototype as { [Symbol.iterator]?: unknown })[Symbol.iterator];
    }
    assert.equal(reads, 0);
    const expired = ownerWithSelection(); expired.setClock(expired.value.expiresAt);
    assert.throws(() => expired.owner.mintDocumentSynthesisAttachmentCapturePort(expired.value),
        (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'lease_expired');
});

test('durable review commit port rejects forged, cloned, proxied, foreign, expired, stale, logged-out, and disposed values', () => {
    const first = ownerWithSelection();
    const port = first.owner.mintDurableReviewCommitPort(first.value);
    let traps = 0; let thenReads = 0;
    const proxy = new Proxy(port, { get() { traps += 1; throw new Error('synthetic trap'); } });
    const thenable = Object.freeze(Object.defineProperty({}, 'then', { enumerable: true, get() { thenReads += 1; return () => undefined; } }));
    for (const value of [null, Object.freeze(Object.create(null)), Object.freeze({ ...port }), proxy, thenable]) {
        assert.equal(spendDurableReviewCommitPort(value), false);
        disposeDurableReviewCommitPort(value);
    }
    assert.equal(traps, 0);
    assert.equal(thenReads, 0);
    const second = ownerWithSelection();
    assert.equal(spendDurableReviewCommitPort(second.owner.mintDurableReviewCommitPort(second.value)), true);
    first.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
    assert.equal(spendDurableReviewCommitPort(port), false);
    disposeDurableReviewCommitPort(port);

    const expired = ownerWithSelection(); const expiryPort = expired.owner.mintDurableReviewCommitPort(expired.value);
    expired.setClock(expired.value.expiresAt);
    assert.equal(spendDurableReviewCommitPort(expiryPort), false);
    const loggedOut = ownerWithSelection(); const logoutPort = loggedOut.owner.mintDurableReviewCommitPort(loggedOut.value);
    deleteSession(loggedOut.value.id);
    assert.equal(spendDurableReviewCommitPort(logoutPort), false);
    const disposed = ownerWithSelection(); const disposedPort = disposed.owner.mintDurableReviewCommitPort(disposed.value);
    disposed.owner.dispose();
    assert.equal(spendDurableReviewCommitPort(disposedPort), false);
    const restarted = ownerWithSelection(); const restartedPort = restarted.owner.mintDurableReviewCommitPort(restarted.value);
    clearAllSessions();
    assert.equal(spendDurableReviewCommitPort(restartedPort), false);
});

test('durable review commit port poisons hostile-clock reentry into generic and H1f mint paths', () => {
    for (const reenter of ['durable', 'patient', 'ocr', 'document', 'treatment', 'dispose'] as const) {
        let armed = false;
        const registry = createServerSessionProjectionOwnerRegistry({
            resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
            clock: () => { if (armed) {
                armed = false;
                if (reenter === 'durable') spendDurableReviewCommitPort(port);
                else if (reenter === 'patient') owner.mintPatientInsightLeaseCommitPort(value);
                else if (reenter === 'ocr') owner.mintOcrLeaseCommitPort(value);
                else if (reenter === 'document') owner.mintDocumentSynthesisLeaseCommitPort(value);
                else if (reenter === 'treatment') owner.mintTreatmentReasoningLeaseCommitPort(value);
                else owner.dispose();
            } return 1_000; },
        });
        const value = session(); const owner = registry.acquire(value);
        owner.issueSelection({ expectedEpoch: 0, ...PAIR });
        const port = owner.mintDurableReviewCommitPort(value);
        armed = true;
        assert.equal(spendDurableReviewCommitPort(port), false);
        assert.equal(spendDurableReviewCommitPort(port), false);
        disposeDurableReviewCommitPort(port);
        if (reenter !== 'dispose') assert.doesNotThrow(() => owner.mintDurableReviewCommitPort(value));
    }
});

test('owner-wide lease-port isolation denies every H1f outer operation against durable mint, spend, and dispose', () => {
    for (const kind of ['patient', 'ocr', 'document', 'treatment'] as const)
        for (const outer of ['snapshot', 'prepare', 'commit', 'abort'] as const)
            for (const nested of ['mint', 'spend', 'dispose'] as const) {
                let armed = false; let nestedResult: unknown = undefined;
                const registry = createServerSessionProjectionOwnerRegistry({
                    resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
                    clock: () => { if (armed) { armed = false;
                        try { nestedResult = nested === 'mint' ? owner.mintDurableReviewCommitPort(value)
                            : nested === 'spend' ? spendDurableReviewCommitPort(durable) : disposeDurableReviewCommitPort(durable); } catch { nestedResult = 'denied'; }
                    } return 1_000; },
                });
                const value = session(); const owner = registry.acquire(value);
                owner.issueSelection({ expectedEpoch: 0, ...PAIR });
                const h1f = kind === 'patient' ? owner.mintPatientInsightLeaseCommitPort(value) : kind === 'ocr' ? owner.mintOcrLeaseCommitPort(value)
                    : kind === 'document' ? owner.mintDocumentSynthesisLeaseCommitPort(value) : owner.mintTreatmentReasoningLeaseCommitPort(value);
                const before = h1f.snapshot()!;
                const staged = outer === 'commit' || outer === 'abort' ? h1f.prepare(Object.freeze({ expected: before.currentRef }))! : null;
                const durable = nested === 'mint' ? null : owner.mintDurableReviewCommitPort(value);
                armed = true;
                const result = outer === 'snapshot' ? h1f.snapshot() : outer === 'prepare' ? h1f.prepare(Object.freeze({ expected: before.currentRef }))
                    : outer === 'commit' ? h1f.commit(Object.freeze({ expected: before.currentRef, replacement: staged! })) : h1f.abort(Object.freeze({ replacement: staged! }));
                assert.equal(result, outer === 'snapshot' || outer === 'prepare' ? null : false);
                assert.equal(nestedResult, nested === 'mint' ? 'denied' : nested === 'spend' ? false : undefined);
                const after = h1f.snapshot()!;
                assert.equal(after.currentRef, before.currentRef);
                assert.equal(after.stagedRef, staged);
                assert.equal(after.generation, before.generation);
                assert.equal(after.terminal, false);
                if (durable) { assert.equal(spendDurableReviewCommitPort(durable), true); disposeDurableReviewCommitPort(durable); }
            }
});

test('owner-wide lease-port isolation denies durable mint and spend against every H1f port operation', () => {
    for (const kind of ['patient', 'ocr', 'document', 'treatment'] as const)
        for (const nested of ['snapshot', 'prepare', 'commit', 'abort', 'dispose'] as const)
            for (const outer of ['mint', 'spend'] as const) {
                let armed = false; let nestedResult: unknown = undefined;
                const registry = createServerSessionProjectionOwnerRegistry({
                    resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
                    clock: () => { if (armed) { armed = false;
                        nestedResult = nested === 'snapshot' ? h1f.snapshot() : nested === 'prepare' ? h1f.prepare(Object.freeze({ expected: before.currentRef }))
                            : nested === 'commit' ? h1f.commit(Object.freeze({ expected: before.currentRef, replacement: staged! }))
                                : nested === 'abort' ? h1f.abort(Object.freeze({ replacement: staged! })) : h1f.dispose();
                    } return 1_000; },
                });
                const value = session(); const owner = registry.acquire(value);
                owner.issueSelection({ expectedEpoch: 0, ...PAIR });
                const h1f = kind === 'patient' ? owner.mintPatientInsightLeaseCommitPort(value) : kind === 'ocr' ? owner.mintOcrLeaseCommitPort(value)
                    : kind === 'document' ? owner.mintDocumentSynthesisLeaseCommitPort(value) : owner.mintTreatmentReasoningLeaseCommitPort(value);
                const before = h1f.snapshot()!;
                const staged = nested === 'commit' || nested === 'abort' ? h1f.prepare(Object.freeze({ expected: before.currentRef }))! : null;
                const durable = outer === 'spend' ? owner.mintDurableReviewCommitPort(value) : null;
                armed = true;
                if (outer === 'mint') assert.throws(() => owner.mintDurableReviewCommitPort(value), ServerSessionProjectionOwnerError);
                else assert.equal(spendDurableReviewCommitPort(durable), false);
                assert.equal(nestedResult, nested === 'snapshot' || nested === 'prepare' ? null : nested === 'commit' || nested === 'abort' ? false : undefined);
                const after = h1f.snapshot()!;
                assert.equal(after.currentRef, before.currentRef);
                assert.equal(after.stagedRef, staged);
                assert.equal(after.generation, before.generation);
                assert.equal(after.terminal, false);
                if (durable) disposeDurableReviewCommitPort(durable);
            }
});

test('Treatment Reasoning port has a private brand and fails closed for stale, expired, replayed, disposed, and foreign authority', () => {
    const first = ownerWithSelection();
    const treatment = first.owner.mintTreatmentReasoningLeaseCommitPort(first.value);
    const patientInsight = first.owner.mintPatientInsightLeaseCommitPort(first.value);
    const ocr = first.owner.mintOcrLeaseCommitPort(first.value);
    const documentSynthesis = first.owner.mintDocumentSynthesisLeaseCommitPort(first.value);
    const current = treatment.snapshot()!.currentRef;
    const replacement = treatment.prepare(Object.freeze({ expected: current }));
    assert.ok(replacement);
    assert.equal(patientInsight.commit(Object.freeze({ expected: patientInsight.snapshot()!.currentRef, replacement } as never)), false);
    assert.equal(ocr.abort(Object.freeze({ replacement } as never)), false);
    assert.equal(documentSynthesis.commit(Object.freeze({ expected: documentSynthesis.snapshot()!.currentRef, replacement } as never)), false);
    first.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
    first.owner.issueSelection({ expectedEpoch: 2, ...PAIR });
    assert.equal(treatment.commit(Object.freeze({ expected: current, replacement })), false);

    const expired = ownerWithSelection();
    const expiredPort = expired.owner.mintTreatmentReasoningLeaseCommitPort(expired.value);
    const expiredCurrent = expiredPort.snapshot()!.currentRef;
    const expiredReplacement = expiredPort.prepare(Object.freeze({ expected: expiredCurrent }));
    assert.ok(expiredReplacement);
    expired.setClock(expired.value.expiresAt);
    assert.equal(expiredPort.commit(Object.freeze({ expected: expiredCurrent, replacement: expiredReplacement })), false);

    const loggedOut = ownerWithSelection();
    const loggedOutPort = loggedOut.owner.mintTreatmentReasoningLeaseCommitPort(loggedOut.value);
    deleteSession(loggedOut.value.id);
    assert.equal(loggedOutPort.snapshot(), null);
    assert.throws(() => first.owner.mintTreatmentReasoningLeaseCommitPort(session()));
    first.owner.dispose();
    assert.equal(treatment.snapshot(), null);
});

test('Treatment Reasoning accepts frozen exact data without hostile or ambient then reads and does no post-return work', async () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintTreatmentReasoningLeaseCommitPort(value);
    const current = port.snapshot()!.currentRef;
    let traps = 0; let ambientReads = 0; let unhandled = 0;
    const hostile = new Proxy(Object.freeze({ expected: current }), {
        get() { traps += 1; throw new Error('synthetic hostile get'); },
        ownKeys() { traps += 1; throw new Error('synthetic hostile ownKeys'); },
    });
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    const onUnhandled = () => { unhandled += 1; };
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { ambientReads += 1; return undefined; } });
    process.on('unhandledRejection', onUnhandled);
    try {
        assert.equal(port.prepare(hostile as never), null);
        const replacement = port.prepare(Object.freeze({ expected: current }));
        assert.ok(replacement);
        assert.equal(port.commit(Object.freeze({ expected: current, replacement })), true);
        assert.deepEqual(port.snapshot(), { currentRef: replacement, stagedRef: null, generation: 1, terminal: true });
    } finally {
        if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor); else delete (Object.prototype as { then?: unknown }).then;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', onUnhandled);
    assert.equal(traps, 0);
    assert.equal(ambientReads, 0);
    assert.equal(unhandled, 0);
});

test('Document Synthesis accepts only frozen exact own data records without reading hostile inputs', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const current = port.snapshot()!.currentRef;
    let reads = 0; let traps = 0;
    const accessor = Object.freeze(Object.defineProperty({}, 'expected', {
        enumerable: true, get() { reads += 1; return current; },
    }));
    const proxy = new Proxy(Object.freeze({ expected: current }), {
        get() { traps += 1; throw new Error('synthetic get trap'); },
        ownKeys() { traps += 1; throw new Error('synthetic ownKeys trap'); },
    });
    const hidden = Object.freeze(Object.defineProperty({ expected: current }, 'hidden', { value: true }));
    const custom = Object.freeze(Object.assign(Object.create(null), { expected: current }));
    const thenable = Object.freeze(Object.defineProperty({ expected: current }, 'then', { enumerable: true, get() { reads += 1; return () => undefined; } }));

    for (const request of [accessor, proxy, Object.freeze({ expected: current, extra: true }), hidden,
        Object.freeze({ expected: current, [Symbol('synthetic')]: true }), custom, thenable, { expected: current }]) {
        assert.equal(port.prepare(request as never), null);
    }
    assert.equal(reads, 0);
    assert.equal(traps, 0);
});

test('Document Synthesis stages a private replacement before a single terminal owner-state replacement', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const before = port.snapshot()!;
    const replacement = port.prepare(Object.freeze({ expected: before.currentRef }));
    assert.ok(replacement);
    const staged = port.snapshot()!;
    assert.equal(staged.currentRef, before.currentRef);
    assert.equal(staged.stagedRef, replacement);
    assert.equal(staged.generation, before.generation);
    assert.equal(port.commit(Object.freeze({ expected: before.currentRef, replacement })), true);
    const committed = port.snapshot()!;
    assert.equal(committed.currentRef, replacement);
    assert.equal(committed.stagedRef, null);
    assert.equal(committed.generation, before.generation + 1);
    assert.equal(committed.terminal, true);
});

test('Document Synthesis aborts once before commit and never rolls a completed state back', () => {
    const { value, owner } = ownerWithSelection();
    const port = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const current = port.snapshot()!.currentRef;
    const replacement = port.prepare(Object.freeze({ expected: current }));
    assert.ok(replacement);
    assert.equal(port.abort(Object.freeze({ replacement })), true);
    assert.equal(port.snapshot()!.currentRef, current);
    assert.equal(port.snapshot()!.stagedRef, null);
    assert.equal(port.abort(Object.freeze({ replacement })), false);
    assert.equal(port.commit(Object.freeze({ expected: current, replacement })), false);
});

test('fails closed on reselection, expiry, logout, disposal, cross-session, and fresh registry', () => {
    const first = ownerWithSelection();
    const port = first.owner.mintPatientInsightLeaseCommitPort(first.value);
    const current = port.snapshot()!.currentRef;
    const replacement = port.prepare(Object.freeze({ expected: current }));
    assert.ok(replacement);
    first.owner.issueSelection({ expectedEpoch: 1, ...PAIR });
    assert.equal(port.commit(Object.freeze({ expected: current, replacement })), false);

    const expired = ownerWithSelection(); const expiryPort = expired.owner.mintOcrLeaseCommitPort(expired.value);
    const expiryCurrent = expiryPort.snapshot()!.currentRef;
    const expiryReplacement = expiryPort.prepare(Object.freeze({ expected: expiryCurrent }));
    expired.setClock(expired.value.expiresAt);
    assert.equal(expiryPort.commit(Object.freeze({ expected: expiryCurrent, replacement: expiryReplacement! })), false);

    const loggedOut = ownerWithSelection(); const logoutPort = loggedOut.owner.mintOcrLeaseCommitPort(loggedOut.value);
    deleteSession(loggedOut.value.id);
    assert.equal(logoutPort.snapshot(), null);
    const foreign = session();
    assert.throws(() => first.owner.mintPatientInsightLeaseCommitPort(foreign));
    assert.throws(() => ({ mint: first.owner.mintPatientInsightLeaseCommitPort }).mint(first.value));
    assert.equal(createServerSessionProjectionOwnerRegistry().lookup(first.value.id), null);
    first.owner.dispose();
    assert.equal(port.snapshot(), null);
});

test('denies same-kind nested operations and isolates all four kinds during snapshots', () => {
    for (const kind of ['patient-insight', 'ocr', 'document-synthesis', 'treatment-reasoning'] as const) for (const operation of ['snapshot', 'prepare', 'commit', 'abort', 'dispose'] as const) {
        let armed = false;
        const registry = createServerSessionProjectionOwnerRegistry({
            resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
            clock: () => { if (armed) { armed = false;
                if (operation === 'snapshot') port.snapshot(); else if (operation === 'prepare') port.prepare(Object.freeze({ expected: current } as never));
                else if (operation === 'commit') port.commit(Object.freeze({ expected: current, replacement: current } as never));
                else if (operation === 'abort') port.abort(Object.freeze({ replacement: current } as never)); else port.dispose();
            } return 1_000; },
        });
        const value = session(); const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
        const port = kind === 'patient-insight' ? owner.mintPatientInsightLeaseCommitPort(value) : kind === 'ocr' ? owner.mintOcrLeaseCommitPort(value)
            : kind === 'document-synthesis' ? owner.mintDocumentSynthesisLeaseCommitPort(value) : owner.mintTreatmentReasoningLeaseCommitPort(value);
        const current = port.snapshot()!.currentRef;
        armed = true;
        assert.equal(port.snapshot(), null);
        assert.deepEqual(port.snapshot(), { currentRef: current, stagedRef: null, generation: 0, terminal: operation === 'dispose' });
    }
});

test('all ports deny every nested operation while snapshot, prepare, commit, or abort is in flight', () => {
    for (const kind of ['patient-insight', 'ocr', 'document-synthesis', 'treatment-reasoning'] as const)
        for (const outer of ['snapshot', 'prepare', 'commit', 'abort'] as const)
            for (const nested of ['snapshot', 'prepare', 'commit', 'abort', 'dispose'] as const) {
                let armed = false;
                const registry = createServerSessionProjectionOwnerRegistry({
                    resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
                    clock: () => { if (armed) { armed = false;
                        if (nested === 'snapshot') port.snapshot(); else if (nested === 'prepare') port.prepare(Object.freeze({ expected: current } as never));
                        else if (nested === 'commit') port.commit(Object.freeze({ expected: current, replacement } as never));
                        else if (nested === 'abort') port.abort(Object.freeze({ replacement } as never)); else port.dispose();
                    } return 1_000; },
                });
                const value = session(); const owner = registry.acquire(value); owner.issueSelection({ expectedEpoch: 0, ...PAIR });
                const port = kind === 'patient-insight' ? owner.mintPatientInsightLeaseCommitPort(value) : kind === 'ocr' ? owner.mintOcrLeaseCommitPort(value)
                    : kind === 'document-synthesis' ? owner.mintDocumentSynthesisLeaseCommitPort(value) : owner.mintTreatmentReasoningLeaseCommitPort(value);
                const current = port.snapshot()!.currentRef;
                const replacement = outer === 'commit' || outer === 'abort' ? port.prepare(Object.freeze({ expected: current }))! : current;
                armed = true;
                if (outer === 'snapshot') assert.equal(port.snapshot(), null);
                else if (outer === 'prepare') assert.equal(port.prepare(Object.freeze({ expected: current })), null);
                else if (outer === 'commit') assert.equal(port.commit(Object.freeze({ expected: current, replacement })), false);
                else assert.equal(port.abort(Object.freeze({ replacement })), false);
                assert.equal(port.snapshot()!.terminal, nested === 'dispose');
            }
});

test('all ports dispose synchronously without a reentry boundary', () => {
    const { value, owner } = ownerWithSelection();
    for (const port of [owner.mintPatientInsightLeaseCommitPort(value), owner.mintOcrLeaseCommitPort(value),
        owner.mintDocumentSynthesisLeaseCommitPort(value), owner.mintTreatmentReasoningLeaseCommitPort(value)]) {
        port.dispose();
        assert.equal(port.snapshot()!.terminal, true);
    }
});

test('Document Synthesis ports cannot union authority with Patient Insight or OCR ports', () => {
    const { value, owner } = ownerWithSelection();
    const document = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const patient = owner.mintPatientInsightLeaseCommitPort(value);
    const ocr = owner.mintOcrLeaseCommitPort(value);
    const current = document.snapshot()!.currentRef;
    const replacement = document.prepare(Object.freeze({ expected: current }));
    assert.ok(replacement);
    assert.equal(patient.commit(Object.freeze({ expected: patient.snapshot()!.currentRef, replacement } as never)), false);
    assert.equal(ocr.abort(Object.freeze({ replacement } as never)), false);
    assert.equal(document.commit(Object.freeze({ expected: current, replacement })), true);
    assert.deepEqual(document.snapshot(), { currentRef: replacement, stagedRef: null, generation: 1, terminal: true });
});

test('Document Synthesis port never reads ambient then or schedules post-return work', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let reads = 0; let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    const { value, owner } = ownerWithSelection(); const port = owner.mintDocumentSynthesisLeaseCommitPort(value);
    const current = port.snapshot()!.currentRef;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    process.on('unhandledRejection', onUnhandled);
    try {
        const before = reads; const replacement = port.prepare(Object.freeze({ expected: current }));
        assert.ok(replacement); assert.equal(port.commit(Object.freeze({ expected: current, replacement })), true);
        assert.deepEqual(port.snapshot(), { currentRef: replacement, stagedRef: null, generation: 1, terminal: true });
        assert.equal(reads, before);
    } finally {
        if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor); else delete (Object.prototype as { then?: unknown }).then;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', onUnhandled);
    assert.equal(unhandled, 0);
});

test('denies a result when the final critical-section clock disposes its session owner', () => {
    for (const result of [Object.freeze({ kind: 'normal' }), Object.freeze({ then() { /* probe only */ } })]) {
        let arm = false; let armedClockReads = 0;
        const registry = createServerSessionProjectionOwnerRegistry({
            resolve: (_session, pair) => pair, entropy: () => new Uint8Array(16),
            clock: () => { if (arm && ++armedClockReads === 2) deleteSession(value.id); return 1_000; },
        });
        const value = session(); const owner = registry.acquire(value);
        owner.issueSelection({ expectedEpoch: 0, ...PAIR });
        assert.throws(() => owner.withLeaseCriticalSection(value, () => { arm = true; return result; }),
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
        assert.equal(registry.lookup(value.id), null);
    }
});

test('never republishes selection after lifecycle disposal during resolve or final clock', () => {
    for (const phase of ['resolve', 'clock'] as const) for (const lifecycle of ['owner', 'session'] as const) for (const existing of [false, true]) {
        let arm = false; let entropy = 0;
        const registry = createServerSessionProjectionOwnerRegistry({
            resolve: (_session, pair) => { if (arm && phase === 'resolve') dispose(); return pair; },
            entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (entropy += 1) + index),
            clock: () => { if (arm && phase === 'clock') dispose(); return 1_000; },
        });
        const value = session(); const owner = registry.acquire(value);
        if (existing) owner.issueSelection({ expectedEpoch: 0, ...PAIR });
        const expectedEpoch = existing ? 1 : 0;
        const dispose = () => { if (lifecycle === 'owner') owner.dispose(); else deleteSession(value.id); };
        arm = true;
        assert.throws(() => owner.issueSelection({ expectedEpoch, ...PAIR }),
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
        assert.equal(registry.lookup(value.id), null);
        assert.throws(() => owner.snapshotSelectionEpoch(value),
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
        assert.throws(() => owner.issueSelection({ expectedEpoch, ...PAIR }),
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'session_unavailable');
    }
});

test('keeps nested issueSelection busy while resolving the outer selection', () => {
    let arm = false;
    const registry = createServerSessionProjectionOwnerRegistry({
        resolve: (_session, pair) => { if (arm) assert.throws(() => owner.issueSelection({ expectedEpoch: 0, ...PAIR }),
            (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === 'selection_busy'); return pair; },
        entropy: () => new Uint8Array(16), clock: () => 1_000,
    });
    const value = session(); const owner = registry.acquire(value); arm = true;
    assert.equal(owner.issueSelection({ expectedEpoch: 0, ...PAIR }).selectionEpoch, 1);
    assert.equal(owner.snapshotSelectionEpoch(value), 1);
});
