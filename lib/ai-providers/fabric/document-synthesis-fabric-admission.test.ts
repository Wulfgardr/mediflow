/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { admitDocumentSynthesisFabric, disposeDocumentSynthesisFabricAdmission, resolveDocumentSynthesisFabricAdmissionForExecution } from './document-synthesis-fabric-admission.ts';
import { createDocumentSynthesisProviderBindingForTest } from './document-synthesis-provider-binding.ts';
import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract.ts';
import { createDocumentSynthesisSourceSetCurrentnessOwner } from './document-synthesis-source-set-currentness-owner.ts';
import { createServerSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner.ts';
import { clearAllSessions, createSession } from '../../security/server-session.ts';

const USER = { id: 'synthetic.fabric.admission.user', username: ['synthetic', 'fabric', 'admission', 'clinician'].join('.'), role: 'clinician' };
const PAIR = { patientId: 'patient.synthetic.fabric.admission', ambulatoryId: 'ambulatory.synthetic.fabric.admission' };
const SETTINGS = Object.freeze({ aiProvider: 'ollama', aiModel_reasoning: 'reasoning-local', aiUrl: 'http://localhost:11434' });
const ATTESTATION = Object.freeze({ authorityPlane: 'clinical_application', provider: 'ollama', executionMode: 'local', endpointClass: 'loopback', requestedModel: 'reasoning-local', canonicalModel: 'reasoning-local:latest', digest: 'sha256:synthetic', serverVersion: '0.32.5', checkedAt: '2026-08-25T12:00:00.000Z' });
afterEach(() => clearAllSessions());

function source(epoch = 3) { const result = captureDocumentSynthesisSourceSet({ sourceSetEpoch: BigInt(epoch), revocationGeneration: BigInt(5), sources: [{ documentSourceRef: 'document.synthetic.fabric.admission', documentRevision: BigInt(7), documentFreshnessEpoch: BigInt(11), sourceText: 'Synthetic source.' }] }); assert.equal(result.status, 'available'); if (result.status !== 'available') throw new Error('synthetic source unavailable'); return result.sourceSet; }
function fixture() { let entropy = 0; const registry = createServerSessionProjectionOwnerRegistry({ clock: () => 1_000, entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (entropy += 1) + index), resolve: (_session, pair) => Object.freeze({ ...pair }) }); const session = createSession(USER, 'web'); const owner = registry.acquire(session); owner.issueSelection({ expectedEpoch: 0, ...PAIR }); const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner, session, sourceSet: source() })); return { session, owner, capsule }; }
async function providerToken() { const result = await createDocumentSynthesisProviderBindingForTest({ readSettings: async () => SETTINGS, attest: async () => ATTESTATION }).bind(); assert.equal(result.status, 'available'); if (result.status !== 'available') throw new Error('synthetic binding unavailable'); return result.token; }
async function admitted(state = fixture()) { const result = admitDocumentSynthesisFabric(Object.freeze({ ...state, providerToken: await providerToken() })); assert.equal(result.status, 'available'); if (result.status !== 'available' || !result.token) throw new Error('synthetic admission unavailable'); return { result, state }; }

test('issues an empty opaque admission and only the private resolver reveals sealed execution metadata', async () => {
    const { result } = await admitted(); assert.equal(Object.getPrototypeOf(result.token!), null); assert.equal(Object.isFrozen(result.token!), true); assert.deepEqual(Reflect.ownKeys(result.token!), []); assert.deepEqual({ reviewOnly: result.reviewOnly, writesPerformed: result.writesPerformed, applyPolicy: result.applyPolicy, fallback: result.fallback }, { reviewOnly: true, writesPerformed: 0, applyPolicy: 'none', fallback: 'denied_by_contract' });
    const execution = resolveDocumentSynthesisFabricAdmissionForExecution(result.token); assert.ok(execution); assert.deepEqual({ capability: execution.receipt.capability, venue: execution.receipt.venue, egress: execution.receipt.egressProfile.egress, fallback: execution.receipt.fallbackCount, labels: execution.provenance.preprocessing }, { capability: 'document_synthesis', venue: 'local_process', egress: 'none', fallback: 0, labels: ['context_minimization'] }); assert.equal(Object.isFrozen(execution!.receipt), true); assert.equal(Object.isFrozen(execution!.provenance), true);
});

test('rejects forged, cloned, spread, proxy, thenable, and cross-owner/session/capsule configurations', async () => {
    const state = fixture(); const token = await providerToken(); const config = Object.freeze({ ...state, providerToken: token }); const foreign = fixture();
    assert.throws(() => structuredClone(config));
    for (const value of [{}, { ...config }, new Proxy(config, {}), Object.freeze({ ...config, then() {} }), Object.freeze({ owner: foreign.owner, session: state.session, capsule: state.capsule, providerToken: token }), Object.freeze({ owner: state.owner, session: foreign.session, capsule: state.capsule, providerToken: token }), Object.freeze({ owner: state.owner, session: state.session, capsule: foreign.capsule, providerToken: token })]) assert.notEqual(admitDocumentSynthesisFabric(value).status, 'available');
    const result = await admitted(); for (const value of [{}, { ...result.result.token! }, structuredClone(result.result.token!), new Proxy(result.result.token!, {}), Promise.resolve(result.result.token!)]) assert.equal(resolveDocumentSynthesisFabricAdmissionForExecution(value), null);
});

test('keeps the source lease private and unconsumed until one finalization; drift or disposal cannot publish', async () => {
    const { result, state } = await admitted(); const execution = resolveDocumentSynthesisFabricAdmissionForExecution(result.token)!; assert.equal(Reflect.ownKeys(execution).includes('lease'), false); assert.equal(state.capsule.transition(source(4)), true); assert.equal(execution.finalizeAfterProviderWork(), false); assert.equal(execution.finalizeAfterProviderWork(), false); assert.equal(resolveDocumentSynthesisFabricAdmissionForExecution(result.token), null);
    const successful = await admitted(); const finalizer = resolveDocumentSynthesisFabricAdmissionForExecution(successful.result.token)!; assert.equal(finalizer.finalizeAfterProviderWork(), true); assert.equal(finalizer.finalizeAfterProviderWork(), false);
    const fresh = await admitted(); disposeDocumentSynthesisFabricAdmission(fresh.result.token); assert.equal(resolveDocumentSynthesisFabricAdmissionForExecution(fresh.result.token), null);
});

test('does not invoke a provider during admission and remains inert under ambient then access', async () => {
    const state = fixture(); const token = await providerToken(); let reads = 0; const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    try { const result = admitDocumentSynthesisFabric(Object.freeze({ ...state, providerToken: token })); assert.equal(reads, 0); assert.ok(result.token && resolveDocumentSynthesisFabricAdmissionForExecution(result.token)); } finally { if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor); else delete (Object.prototype as { then?: unknown }).then; }
    const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('./document-synthesis-fabric-admission.ts', import.meta.url), 'utf8')); assert.equal(source.includes('.chat('), false);
});
