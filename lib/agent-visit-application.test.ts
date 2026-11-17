import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_OPERATIONS } from './agent-mandate-contract';
import { agentBase64 } from './agent-cassette-crypto';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';
import { encryptData, generateMasterKey } from './security/security';
import { sealPatientDocumentFile } from './security/attachment-file-envelope';
import type { AgentApplicationInput } from './agent-visit-application-contract';

const directory = mkdtempSync(join(tmpdir(), 'mediflow-agent-application-'));
process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
const fixture = await import('./test-fixtures/clinical-writer-composition.ts');
fixture.seedComposition();
const { createAgentMandateStore } = await import('./agent-mandate-store.ts');
const { createAgentPairingStore } = await import('./agent-pairing-store.ts');
const { createAgentCassetteStore } = await import('./agent-cassette-store.ts');
const { applyAgentVisit, agentAppliedItemIds } = await import('./agent-visit-application.ts');
const { archiveGenerationForSession } = await import('./security/archive-session-generation.ts');
const { readBackupAuditRows, canonicalizeBackupAuditRows } = await import('./backup-audit.ts');
const database = dbServer.$client;
const key = await generateMasterKey();
const field = async (value: unknown) => { const sealed = await encryptData(value, key); return `ENC:${sealed.iv}:${sealed.data}`; };
const request = new Request('http://127.0.0.1/api/agent-mandates/incoming', { method: 'POST' });
const tables = ['entries', 'attachments', 'therapies', 'service_prescriptions', 'service_prescription_items', 'observations', 'patients', 'audit_events'];
const snapshot = () => tables.map(table => database.prepare(`SELECT * FROM ${table}`).all());
const version = () => (database.prepare('SELECT version FROM patients WHERE id=?').get(fixture.patientId) as { version: number }).version;
test.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });

async function visit() {
    const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicKey = agentBase64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
    const mandates = createAgentMandateStore(database), pairings = createAgentPairingStore(database), store = createAgentCassetteStore(database);
    const generation = archiveGenerationForSession(fixture.session)!;
    const mandate = mandates.create({ id: randomUUID(), durationMs: 43200000, operations: [...AGENT_OPERATIONS], provider: 'local', allowsClinicalEgress: false,
        publicKey, wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64) }, fixture.session.userId, generation);
    const pairing = pairings.request('Synthetic apply agent', [...AGENT_OPERATIONS]);
    pairings.approve(pairing.request.id, pairing.request.code, mandate.id, fixture.session.userId, generation);
    const token = pairings.poll(pairing.request.id, pairing.claim).credential!.token;
    const principal = database.transaction(() => pairings.principal(token)!).immediate();
    const id = randomUUID();
    const seal = (itemId: string, kind: Parameters<typeof sealAgentItemNode>[1]['kind']) => sealAgentItemNode(publicKey,
        { mandateRef: mandate.id, visitId: id, itemId, kind }, new TextEncoder().encode(JSON.stringify({ text: 'SYNTHETIC_APPLICATION' })));
    let receipt = database.transaction(() => store.open(principal, id, seal(id, 'anchor'))).immediate();
    const file = await sealPatientDocumentFile(new TextEncoder().encode('%PDF-1.4\nSYNTHETIC_APPLICATION\n%%EOF'), key);
    file.fileKey.fill(0);
    const note = { title: await field('Nota sintetica'), content: await field('SYNTHETIC_APPLICATION'), metadata: await field({ synthetic: true }), date: '2026-11-17' };
    const items: AgentApplicationInput['items'] = [
        { id: randomUUID(), kind: 'note', values: note },
        { id: randomUUID(), kind: 'pdf', values: { name: await field('synthetic.pdf'), data: file.data, size: 45 } },
        { id: randomUUID(), kind: 'therapy', values: { drugName: 'Farmaco sintetico', dosage: '1', startDate: '2026-11-17', status: 'active', motivation: await field('Fonte sintetica') } },
        { id: randomUUID(), kind: 'service', values: { serviceName: await field('Prestazione sintetica'), prescribedAt: '2026-11-17',
            lineItems: [{ serviceName: await field('Prima prestazione sintetica') }, { serviceName: await field('Seconda prestazione sintetica') }] } },
        { id: randomUUID(), kind: 'diagnosis', values: { diagnoses: await field([{ code: 'SYNTHETIC', description: 'Diagnosi sintetica', system: 'synthetic', date: '2026-11-17' }]) } },
        { id: randomUUID(), kind: 'exemption', values: { exemptions: await field(['SYNTHETIC']) } },
        { id: randomUUID(), kind: 'observation', values: { codeSystem: 'LOINC', code: 'SYNTHETIC', display: 'Osservazione sintetica', unitSystem: 'UCUM', unitCode: '1', value: '1', observedAt: '2026-11-17', notes: await field('Fonte sintetica') } },
    ];
    const operations = { note: 'visita.nota', pdf: 'visita.allega', therapy: 'visita.proponi.terapia', service: 'visita.proponi.prestazione', diagnosis: 'visita.proponi.diagnosi', exemption: 'visita.proponi.esenzione', observation: 'visita.proponi.osservazione', transcription: 'visita.trascrizione' } as const;
    for (const item of items) receipt = database.transaction(() => store.add(principal, id, receipt.revision, {
        id: item.id, kind: item.kind, envelope: seal(item.id, item.kind), byteLength: new TextEncoder().encode(JSON.stringify({ text: 'SYNTHETIC_APPLICATION' })).length,
        documentHash: item.kind === 'pdf' ? 'a'.repeat(64) : null,
    })).immediate();
    receipt = database.transaction(() => store.close(principal, id, receipt.revision)).immediate();
    return { id, mandate, mandates, principal, operations,
        input(phase: 'automatic' | 'review'): AgentApplicationInput { return { visitId: id, phase, patientId: fixture.patientId, expectedVersion: version(), cassetteRevision: receipt.revision,
            items: items.filter(item => ['note', 'transcription', 'pdf'].includes(item.kind) === (phase === 'automatic')) }; } };
}

test('automatic application consumes only note and PDF, leaves all clinical proposals pending and replays without duplicates', async () => {
    const f = await visit(), input = f.input('automatic'), initial = snapshot();
    const receipt = applyAgentVisit(request, fixture.session, input);
    assert.equal(receipt.status, 'applied');
    assert.deepEqual(agentAppliedItemIds(f.id).sort(), input.items.map(item => item.id).sort());
    const after = snapshot();
    assert.deepEqual(after.slice(0, 6).map((rows, index) => rows.length - initial[index].length), [1, 1, 0, 0, 0, 0]);
    assert.equal((after[0].at(-1) as { recorded_by: string }).recorded_by, 'Medico Sintetico');
    assert.equal(applyAgentVisit(request, fixture.session, input).eventId, receipt.eventId);
    assert.deepEqual(snapshot(), after);
    const forged = { ...input, patientId: 'another-synthetic-patient' };
    assert.throws(() => applyAgentVisit(request, fixture.session, forged));
    assert.deepEqual(snapshot(), after);
});

test('one explicit review commits all structured proposals, service lines and proposer audit atomically', async () => {
    const f = await visit();
    applyAgentVisit(request, fixture.session, f.input('automatic'));
    const before = snapshot(), input = f.input('review');
    const receipt = applyAgentVisit(request, fixture.session, input);
    const after = snapshot();
    assert.deepEqual(after.slice(0, 6).map((rows, index) => rows.length - before[index].length), [0, 0, 1, 1, 2, 1]);
    assert.equal(agentAppliedItemIds(f.id).length, 7);
    const audit = database.prepare("SELECT * FROM audit_events WHERE event_id=?").get(receipt.eventId) as Record<string, unknown>;
    assert.equal(audit.actor_ref, fixture.session.userId);
    assert.equal(audit.proposer_ref, f.principal.agentRef);
    assert.equal(audit.mandate_ref, f.mandate.id);
    assert.equal(audit.source_surface, 'agent');
    assert.equal(audit.model_provider, 'local');
    assert.deepEqual(canonicalizeBackupAuditRows(JSON.parse(JSON.stringify(readBackupAuditRows(database)))), readBackupAuditRows(database));
    assert.equal(applyAgentVisit(request, fixture.session, input).eventId, receipt.eventId);
    assert.deepEqual(snapshot(), after);
});

test('a stale patient revision or a revoked mandate applies nothing and leaves the cassette recoverable', async () => {
    const f = await visit(), stale = { ...f.input('automatic'), expectedVersion: version() - 1 }, before = snapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, stale));
    assert.deepEqual(snapshot(), before);
    f.mandates.revoke(f.mandate.id, fixture.session.userId, f.mandate.archiveGeneration);
    const revoked = snapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, f.input('automatic')));
    assert.deepEqual(snapshot(), revoked);
    assert.equal(agentAppliedItemIds(f.id).length, 0);
});

for (const phase of ['automatic', 'review'] as const) test(`failure of every audit position rolls back the whole ${phase} pass and its consumption receipts`, async () => {
    const f = await visit();
    if (phase === 'review') applyAgentVisit(request, fixture.session, f.input('automatic'));
    const input = f.input(phase), before = snapshot(), appliedBefore = agentAppliedItemIds(f.id);
    const expectedAuditCount = phase === 'automatic' ? 6 : 13;
    for (let offset = 0; offset < expectedAuditCount; offset++) {
        const count = (database.prepare('SELECT count(*) AS n FROM audit_events').get() as { n: number }).n + offset;
        database.exec(`CREATE TRIGGER synthetic_application_audit_fault BEFORE INSERT ON audit_events WHEN (SELECT count(*) FROM audit_events)=${count} BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_APPLICATION_AUDIT_FAULT'); END`);
        try { assert.throws(() => applyAgentVisit(request, fixture.session, input), /SYNTHETIC_APPLICATION_AUDIT_FAULT/); }
        finally { database.exec('DROP TRIGGER synthetic_application_audit_fault'); }
        assert.deepEqual(snapshot(), before);
        assert.deepEqual(agentAppliedItemIds(f.id), appliedBefore);
    }
});

test('automatic mode cannot consume or relabel a structured proposal', async () => {
    const f = await visit(), input = f.input('automatic'), proposal = f.input('review').items[0], before = snapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...input, items: [proposal] }));
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...input, items: input.items.map((item, index) => index ? item : { ...item, id: proposal.id }) }));
    assert.deepEqual(snapshot(), before);
});
