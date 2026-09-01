/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { localProviderRegistry, type LocalProviderResolution } from '../ai-providers/registry.ts';
import { routeHostResolvedCandidateCapability } from '../ai-providers/fabric/candidate-router.ts';
import { createPatientSmartImportHostCapability } from '../domain/documents/patient-smart-import-host-capability.ts';
import { createPatientSmartImportHostKillSwitch } from '../domain/documents/patient-smart-import-host-kill-switch.ts';
import { createTypedProjectionBroker } from '../typed-projection-broker.ts';
import { createAuthenticatedWebSessionSelectionService } from './server-session-authenticated-selection.ts';
import { createAuthenticatedSmartImportAttachmentIngestService } from './server-session-authenticated-smart-import-attachment-ingest.ts';
import { ingestServerSessionSmartImportAttachmentWithOwner } from './server-session-smart-import-attachment-ingest.ts';
import { createAuthenticatedSmartImportPreviewService } from './server-session-authenticated-smart-import-preview.ts';
import { createSmartImportIngestHttpHandler } from './server-session-smart-import-ingest-http.ts';
import { createSmartImportPreviewHttpHandler } from './server-session-smart-import-preview-http.ts';
import { createSmartImportSelectionEpochHttpHandler, createSmartImportSelectionHttpHandler } from './server-session-smart-import-selection-http.ts';
import { createFullPortProjectionOwnerFactory } from './server-session-projection-owner.ts';
import type { ServerSession } from './server-session.ts';
import { createSmartImportProjectionAttachmentBrowserNormalizer } from './smart-import-projection-attachment-browser-normalizer.ts';
import { createSmartImportSelectionBrowserAdapter } from './smart-import-selection-browser-adapter.ts';
import { createSmartImportBrowserOrchestrator } from './smart-import-browser-orchestrator.ts';
import { issueSyntheticWebSession, retireSyntheticWebSession } from './web-auth-lifecycle-owner-test-fixture.ts';
import { parseSmartImportPreviewWireRoot } from '../smart-import-preview-wire.ts';

const USER = { id: 'synthetic-e2e-user', username: ['synthetic', 'e2e'].join('-'), role: 'clinician' };
const sessions: ServerSession[] = [];
let sessionSequence = 0;

afterEach(() => {
    while (sessions.length > 0) retireSyntheticWebSession(sessions.pop()!);
});

const bytes = (value: number) => new Uint8Array(16).fill(value);
const attachmentInput = () => ({ patient: { version: 3 }, currentDiagnoses: [{ system: 'ICD-11', code: 'SYN-1', description: 'Synthetic diagnosis' }], currentActiveTherapies: [], sources: [{ kind: 'clinical-entry', originKey: 'origin.synthetic.1', label: 'Synthetic source', date: null, content: 'Synthetic content' }], therapyCandidateHints: [] });

function resolution(chat: LocalProviderResolution['adapter']['chat']): LocalProviderResolution {
    const base = localProviderRegistry.resolve({ task: 'clinical', models: { clinical: 'synthetic-local-model' }, endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1_000 });
    return { ...base, adapter: Object.freeze({ id: base.adapter.id, kind: base.adapter.kind, capabilities: base.adapter.capabilities,
        getBaseUrl: () => base.adapter.getBaseUrl(), getModel: () => base.adapter.getModel(), chat, listModels: async () => [] }) };
}
function request(path: string, init?: RequestInit): Request { return new Request(new URL(path, 'http://localhost'), { method: init?.method, headers: init?.headers, body: init?.body }); }

function harness(tamper = false) {
    const now = new Date().toISOString(); const noStore: string[] = []; let entropy = 0; let selectionAcquisitions = 0; let ingestAcquisitions = 0; let previewAcquisitions = 0; let selectionCalls = 0; let ingestCalls = 0; let previewCalls = 0; let killSwitchReads = 0; let consumes = 0; let chats = 0; let routers = 0;
    const session = issueSyntheticWebSession(USER, `smart-import-composition-${sessionSequence += 1}`);
    sessions.push(session);
    const registry = createFullPortProjectionOwnerFactory({ resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }), clock: () => Date.parse(now), entropy: () => bytes(++entropy), brokerFactory: (config) => createTypedProjectionBroker(config, { clock: () => now, entropy: () => bytes(++entropy) }) });
    const context = () => Object.freeze({ session, owner: registry.acquire(session) });
    const selection = createAuthenticatedWebSessionSelectionService({ acquireOwner: async () => { selectionAcquisitions += 1; return registry.acquire(session); } });
    const selectionHttp = createSmartImportSelectionHttpHandler({ acquireSelection: async () => {
        const operation = await selection.acquire();
        return Object.freeze({ issueSelection: async (input: unknown) => { selectionCalls += 1; return operation.issueSelection(input); } });
    } });
    const epochHttp = createSmartImportSelectionEpochHttpHandler({ readEpoch: async () => registry.snapshotSelectionEpoch(session) });
    const ingest = createAuthenticatedSmartImportAttachmentIngestService({ acquireContext: async () => { ingestAcquisitions += 1; return context(); }, ingestWithOwner: (current, owner, input) => { ingestCalls += 1; return ingestServerSessionSmartImportAttachmentWithOwner(current, owner, input); } });
    const ingestHttp = createSmartImportIngestHttpHandler({ acquireIngest: ingest.acquire });
    const binding = resolution(async () => { chats += 1; return { content: JSON.stringify({ schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import', summary: 'Synthetic review', data: { diagnoses: [{ label: 'Synthetic diagnosis', icdQuery: 'SYN', confidence: 'high', evidence: 'Synthetic evidence', sourceId: 'source.local.00000000001.01', explicitCode: undefined }], therapies: [], servicePrescriptions: [] } }), stats: { latency: 1, tokensIn: 1, tokensOut: 1 } }; });
    const preview = createAuthenticatedSmartImportPreviewService({ acquireContext: async () => { previewAcquisitions += 1; return context(); }, createCapability: (broker) => createPatientSmartImportHostCapability({ killSwitch: createPatientSmartImportHostKillSwitch({ readSetting: async () => { killSwitchReads += 1; return 'enabled'; } }), broker: { consume: (input) => { consumes += 1; return broker.consume(input); } }, lifecycle: { read: () => ({ status: 'available', record: { schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1', lifecycle: { schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' }, actorClass: 'host_service', actorRef: `actor_${'a'.repeat(32)}`, version: 1, hostTimestamp: now, receiptRef: `receipt_${'b'.repeat(32)}` } }) }, binding: { readClinical: async () => ({ status: 'available', resolution: binding }) }, readiness: { observeClinical: async () => ({ status: 'available', code: null, observation: { venue: 'local_process', state: 'available', reason: null } }) }, route: (input, lifecycle) => { routers += 1; return routeHostResolvedCandidateCapability(input, lifecycle); }, sources: { clock: () => now, entropy: () => bytes(7) } }) });
    const previewHttp = createSmartImportPreviewHttpHandler({ acquirePreview: async () => {
        const operation = await preview.acquire();
        return Object.freeze({ preview: async (input: unknown) => { previewCalls += 1; return operation.preview(input); } });
    } });
    const fetch: typeof globalThis.fetch = async (path, init) => {
        const pathname = String(path); const response = pathname.endsWith('/selection') ? init?.method === 'GET' ? await epochHttp() : await selectionHttp(request(pathname, init)) : pathname.endsWith('/ingest') ? await ingestHttp(request(pathname, init)) : await previewHttp(request(pathname, init));
        noStore.push(response.headers.get('Cache-Control') ?? ''); if (!pathname.endsWith('/ingest') || !response.ok) return response;
        const body = await response.clone().json() as { handle: string }; assert.match(body.handle, /^prj_[0-9a-f]{32}$/u);
        return tamper ? new Response(JSON.stringify({ handle: `prj_${'f'.repeat(32)}` }), { status: response.status, headers: response.headers }) : response;
    };
    const browserSelection = createSmartImportSelectionBrowserAdapter({ fetch }); const normalizer = createSmartImportProjectionAttachmentBrowserNormalizer({ clock: () => new Date(now) });
    const browser = createSmartImportBrowserOrchestrator({ fetch, isCurrent: browserSelection.isCurrent, requestId: (() => { let id = 0; return () => `req_${(++id).toString(16).padStart(32, 'a')}`; })() });
    return { browserSelection, normalizer, browser, counts: () => ({ selectionAcquisitions, ingestAcquisitions, previewAcquisitions, selectionCalls, ingestCalls, previewCalls, killSwitchReads, consumes, chats, routers }), noStore };
}
test('runs the synthetic browser-to-wire contract through real HTTP JSON boundaries', async () => {
    const current = harness(); await current.browserSelection.initialize(); const lease = await current.browserSelection.select({ patientId: 'patient.synthetic.1', ambulatoryId: 'ambulatory.synthetic.1' }, true);
    const bound = current.normalizer.captureForCurrentSelection(attachmentInput(), true, lease, current.browserSelection.isCurrent); const root = await current.browser.run(lease, bound);
    assert.deepEqual(parseSmartImportPreviewWireRoot(root), root); assert.equal(root.preview.status, 'available', JSON.stringify(root.preview)); assert.equal(root.preview.writesPerformed, 0); assert.equal(root.preview.apply, 'denied');
    if (root.preview.status === 'available') { assert.equal(root.preview.receipt.provider, 'ollama'); assert.equal(root.preview.provenance.receipt.model, 'synthetic-local-model'); assert.equal('explicitCode' in root.preview.proposal.diagnoses[0], false); }
    assert.deepEqual(current.counts(), { selectionAcquisitions: 1, ingestAcquisitions: 1, previewAcquisitions: 1, selectionCalls: 1, ingestCalls: 1, previewCalls: 1, killSwitchReads: 1, consumes: 1, chats: 1, routers: 1 }); assert.deepEqual(current.noStore, ['no-store', 'no-store', 'no-store', 'no-store']);
});

test('denies a tampered ingest handle after capability entry and before routing or chat', async () => {
    const current = harness(true); await current.browserSelection.initialize(); const lease = await current.browserSelection.select({ patientId: 'patient.synthetic.1', ambulatoryId: 'ambulatory.synthetic.1' }, true);
    const bound = current.normalizer.captureForCurrentSelection(attachmentInput(), true, lease, current.browserSelection.isCurrent); const root = await current.browser.run(lease, bound);
    assert.equal(root.preview.status, 'denied'); assert.equal(root.preview.code, 'projection_unavailable'); assert.deepEqual(current.counts(), { selectionAcquisitions: 1, ingestAcquisitions: 1, previewAcquisitions: 1, selectionCalls: 1, ingestCalls: 1, previewCalls: 1, killSwitchReads: 1, consumes: 1, chats: 0, routers: 0 });
});
