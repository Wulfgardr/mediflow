import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_OPERATIONS, type AgentMandateInput } from './agent-mandate-contract';
import { agentBase64 } from './agent-cassette-crypto';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';
import { encryptData, generateMasterKey } from './security/security';
import { sealPatientDocumentFile } from './security/attachment-file-envelope';
import { agentApplicationSchema, type AgentApplicationInput } from './agent-visit-application-contract';

const directory = mkdtempSync(join(tmpdir(), 'mediflow-agent-application-'));
process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
const fixture = await import('./test-fixtures/clinical-writer-composition.ts');
fixture.seedComposition();
const { createAgentMandateStore } = await import('./agent-mandate-store.ts');
const { createAgentPairingStore } = await import('./agent-pairing-store.ts');
const { createAgentCassetteStore, readAgentCassette, readAgentCassetteIndex } = await import('./agent-cassette-store.ts');
const { applyAgentVisit, agentAppliedItemIds, applyConfirmedAgentVisit, agentConfirmationPatientState, hasAgentVisitConfirmationReceipt } = await import('./agent-visit-application.ts');
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

async function visit(provider: AgentMandateInput['provider'] = 'local', allowsClinicalEgress = false) {
    const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicKey = agentBase64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
    const mandates = createAgentMandateStore(database), pairings = createAgentPairingStore(database), store = createAgentCassetteStore(database);
    const generation = archiveGenerationForSession(fixture.session)!;
    const mandate = mandates.create({ id: randomUUID(), durationMs: 43200000, operations: [...AGENT_OPERATIONS], provider, allowsClinicalEgress,
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
    const notePdfId = randomUUID();
    const items: AgentApplicationInput['items'] = [
        { id: randomUUID(), kind: 'note', values: note },
        { id: randomUUID(), kind: 'pdf', values: { name: await field('synthetic.pdf'), data: file.data, size: 45 } },
        { id: notePdfId, kind: 'pdf', values: { name: await field('nota-visita.pdf'), data: file.data, size: 45 } },
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
            items: items.filter(item => (['transcription', 'pdf'].includes(item.kind) && item.id !== notePdfId) === (phase === 'automatic')) }; },
        whole(): AgentApplicationInput { return { visitId: id, phase: 'review', patientId: fixture.patientId, expectedVersion: version(), cassetteRevision: receipt.revision, items }; } };
}

test('automatic application consumes only the PDF, leaves the note and all clinical proposals pending and replays without duplicates', async () => {
    const f = await visit(), input = f.input('automatic'), initial = snapshot();
    const receipt = applyAgentVisit(request, fixture.session, input);
    assert.equal(receipt.status, 'applied');
    assert.deepEqual(agentAppliedItemIds(f.id).sort(), input.items.map(item => item.id).sort());
    const after = snapshot();
    assert.deepEqual(after.slice(0, 6).map((rows, index) => rows.length - initial[index].length), [0, 1, 0, 0, 0, 0]);
    assert.equal(applyAgentVisit(request, fixture.session, input).eventId, receipt.eventId);
    assert.deepEqual(snapshot(), after);
    const forged = { ...input, patientId: 'another-synthetic-patient' };
    assert.throws(() => applyAgentVisit(request, fixture.session, forged));
    assert.deepEqual(snapshot(), after);
});

for (const provider of ['openai', 'anthropic'] as const) test(`J5: the ${provider} cassette deposited without clinical egress is never applied automatically and the doctor applies it whole on review`, async () => {
    const f = await visit(provider, false), before = snapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, f.input('automatic')), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(agentAppliedItemIds(f.id), []);
    assert.ok(readAgentCassetteIndex(database, fixture.session.userId, null).visits.some(row => row.id === f.id));
    assert.throws(() => applyAgentVisit(request, fixture.session, f.input('review')), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(snapshot(), before);
    const input = f.whole(), receipt = applyAgentVisit(request, fixture.session, input), after = snapshot();
    assert.deepEqual(after.slice(0, 6).map((rows, index) => rows.length - before[index].length), [1, 2, 1, 1, 2, 1]);
    assert.deepEqual(agentAppliedItemIds(f.id).sort(), input.items.map(item => item.id).sort());
    assert.ok(!readAgentCassetteIndex(database, fixture.session.userId, null).visits.some(row => row.id === f.id));
    const audit = database.prepare('SELECT * FROM audit_events WHERE event_id=?').get(receipt.eventId) as Record<string, string>;
    assert.equal(audit.model_provider, provider);
    assert.equal(audit.proposer_ref, f.principal.agentRef);
    assert.deepEqual(JSON.parse(audit.redacted_metadata).flags, ['review', 'cassette_complete']);
    assert.equal(receipt.allowsClinicalEgress, false);
    assert.equal(applyAgentVisit(request, fixture.session, input).eventId, receipt.eventId);
    assert.deepEqual(snapshot(), after);
});

test('J4: a cloud cassette deposited with clinical egress keeps the automatic pass and the separate review', async () => {
    const f = await visit('openai', true);
    assert.equal(applyAgentVisit(request, fixture.session, f.input('automatic')).allowsClinicalEgress, true);
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...f.whole(), expectedVersion: version() }), /AGENT_APPLICATION_DENIED/);
    assert.equal(applyAgentVisit(request, fixture.session, f.input('review')).status, 'applied');
    assert.equal(agentAppliedItemIds(f.id).length, 8);
});

test('one explicit review commits all structured proposals, service lines and proposer audit atomically', async () => {
    const f = await visit();
    applyAgentVisit(request, fixture.session, f.input('automatic'));
    assert.ok(readAgentCassetteIndex(database, fixture.session.userId, null).visits.some(row => row.id === f.id));
    const before = snapshot(), input = f.input('review');
    const receipt = applyAgentVisit(request, fixture.session, input);
    const after = snapshot();
    assert.deepEqual(after.slice(0, 6).map((rows, index) => rows.length - before[index].length), [1, 1, 1, 1, 2, 1]);
    assert.equal((after[0].at(-1) as { recorded_by: string }).recorded_by, 'Medico Sintetico');
    assert.equal(agentAppliedItemIds(f.id).length, 8);
    assert.ok(!readAgentCassetteIndex(database, fixture.session.userId, null).visits.some(row => row.id === f.id));
    assert.equal(readAgentCassette(database, f.id, fixture.session.userId)?.id, f.id);
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
    const expectedAuditCount = phase === 'automatic' ? 4 : 17;
    for (let offset = 0; offset < expectedAuditCount; offset++) {
        const count = (database.prepare('SELECT count(*) AS n FROM audit_events').get() as { n: number }).n + offset;
        database.exec(`CREATE TRIGGER synthetic_application_audit_fault BEFORE INSERT ON audit_events WHEN (SELECT count(*) FROM audit_events)=${count} BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_APPLICATION_AUDIT_FAULT'); END`);
        try { assert.throws(() => applyAgentVisit(request, fixture.session, input), /SYNTHETIC_APPLICATION_AUDIT_FAULT/); }
        finally { database.exec('DROP TRIGGER synthetic_application_audit_fault'); }
        assert.deepEqual(snapshot(), before);
        assert.deepEqual(agentAppliedItemIds(f.id), appliedBefore);
    }
});

test('the server never lets the note into the automatic pass and refuses a review that leaves part of the visit behind', async () => {
    const f = await visit(), automatic = f.input('automatic'), note = f.input('review').items.find(item => item.kind === 'note')!, before = snapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...automatic, items: [...automatic.items, note] }), /AGENT_APPLICATION_DENIED/);
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...automatic, items: [note] }), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(snapshot(), before);
    applyAgentVisit(request, fixture.session, automatic);
    const applied = snapshot(), current = f.input('review');
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...current, items: current.items.filter(item => item.kind !== 'note') }), /AGENT_APPLICATION_DENIED/);
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...current, items: [note] }), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(snapshot(), applied);
    assert.equal(applyAgentVisit(request, fixture.session, f.input('review')).status, 'applied');
    assert.equal(agentAppliedItemIds(f.id).length, 8);
});

test('with the note still pending the server refuses an automatic pass that would take every PDF of the cassette', async () => {
    const f = await visit(), automatic = f.input('automatic'), notePdf = f.input('review').items.find(item => item.kind === 'pdf')!, before = snapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...automatic, items: [...automatic.items, notePdf] }), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(snapshot(), before);
    assert.equal(applyAgentVisit(request, fixture.session, automatic).status, 'applied');
});

test('automatic mode cannot consume or relabel a structured proposal', async () => {
    const f = await visit(), input = f.input('automatic'), proposal = f.input('review').items[0], before = snapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...input, items: [proposal] }));
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...input, items: input.items.map((item, index) => index ? item : { ...item, id: proposal.id }) }));
    assert.deepEqual(snapshot(), before);
});


test('native approval commits and audits exactly one plan, and a valid proof cannot be reused or moved', async () => {
    assert.equal(typeof applyConfirmedAgentVisit, 'function');
    const { createVisitConfirmationChallenge } = await import('./agent-visit-confirmation-proof');
    const f = await visit();
    applyAgentVisit(request, fixture.session, f.input('automatic'));
    const plan = agentApplicationSchema.parse(f.input('review'));
    const reference = randomUUID();
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = keys.publicKey.export({ format: 'jwk' });
    const publicKey = Buffer.concat([Buffer.of(4), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64');
    const binding = { reference, ...f.principal, sessionId: fixture.session.id, visitId: plan.visitId, revision: plan.cassetteRevision,
        patientId: plan.patientId, patientVersion: plan.expectedVersion, patientState: agentConfirmationPatientState(plan.patientId, plan.expectedVersion),
        expiresAt: Date.now() + 60_000 };
    const presentation = Buffer.from('synthetic ciphertext representation').toString('base64');
    const challenge = createVisitConfirmationChallenge(binding, plan, presentation, publicKey);
    const policy = 'biometrics-or-companion' as const;
    const proof = { policy, signature: sign('sha256', Buffer.from(challenge.bytes + '\n' + policy),
        { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64') };
    const before = snapshot();
    const grant = { challenge, proof, assertLive() {} };
    assert.throws(() => applyConfirmedAgentVisit(request, fixture.session, plan, { ...grant, proof: { policy, signature: '' } }));
    assert.throws(() => applyConfirmedAgentVisit(request, fixture.session, { ...plan, items: plan.items.toReversed() }, grant));
    assert.throws(() => applyConfirmedAgentVisit(request, fixture.session, plan, { ...grant,
        challenge: createVisitConfirmationChallenge({ ...binding, reference: randomUUID() }, plan, presentation, publicKey) }));
    assert.throws(() => applyConfirmedAgentVisit(request, fixture.session, plan, { ...grant,
        assertLive() { throw new Error('DISCONNECTED_SYNTHETIC_PEER'); } }), /DISCONNECTED_SYNTHETIC_PEER/);
    assert.deepEqual(snapshot(), before);
    assert.equal(hasAgentVisitConfirmationReceipt(reference, f.principal), false);

    const result = applyConfirmedAgentVisit(request, fixture.session, plan, grant);
    const after = snapshot();
    assert.deepEqual(after.slice(0, 6).map((rows, index) => rows.length - before[index].length), [1, 1, 1, 1, 2, 1]);
    assert.equal(hasAgentVisitConfirmationReceipt(reference, f.principal), true);
    assert.equal(hasAgentVisitConfirmationReceipt(reference, { ...f.principal, agentRef: randomUUID() }), false);
    const record = database.prepare('SELECT * FROM audit_events WHERE event_id=?').get(result.eventId) as Record<string, string>;
    assert.equal(record.actor_type, 'user');
    assert.equal(record.actor_ref, fixture.session.userId);
    assert.equal(record.proposer_ref, f.principal.agentRef);
    assert.equal(record.mandate_ref, f.mandate.id);
    assert.equal(record.model_provider, f.principal.modelProvider);
    assert.equal(record.request_id, reference);
    assert.ok(JSON.parse(record.redacted_metadata).flags.includes('confirmation:codex-macos'));
    assert.ok(JSON.parse(record.redacted_metadata).flags.includes('policy:biometrics-or-companion'));
    assert.ok(!record.redacted_metadata.includes(proof.signature));
    assert.throws(() => applyConfirmedAgentVisit(request, fixture.session, plan, grant));
    assert.deepEqual(snapshot(), after);
});
