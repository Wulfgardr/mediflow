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
const tables = ['entries', 'attachments', 'therapies', 'service_prescriptions', 'service_prescription_items', 'observations', 'patients', 'audit_events', 'patients_to_ambulatories'];
const snapshot = () => tables.map(table => database.prepare(`SELECT * FROM ${table}`).all());
const version = () => (database.prepare('SELECT version FROM patients WHERE id=?').get(fixture.patientId) as { version: number }).version;
test.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });

async function visit(provider: AgentMandateInput['provider'] = 'local', allowsClinicalEgress = false, content: 'all' | 'note' | 'transcription' = 'all', depositTime = Date.now()) {
    const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicKey = agentBase64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
    const now = () => depositTime;
    const mandates = createAgentMandateStore(database, now), pairings = createAgentPairingStore(database, now), store = createAgentCassetteStore(database, now);
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
    const allItems: AgentApplicationInput['items'] = [
        { id: randomUUID(), kind: 'note', values: note },
        { id: randomUUID(), kind: 'transcription', values: { ...note, title: await field('Trascrizione sintetica') } },
        { id: randomUUID(), kind: 'pdf', values: { name: await field('synthetic.pdf'), data: file.data, size: 45 } },
        { id: randomUUID(), kind: 'pdf', values: { name: await field('nota-visita.pdf'), data: file.data, size: 45 } },
        { id: randomUUID(), kind: 'therapy', values: { drugName: 'Farmaco sintetico', dosage: '1', startDate: '2026-11-17', status: 'active', motivation: await field('Fonte sintetica') } },
        { id: randomUUID(), kind: 'service', values: { serviceName: await field('Prestazione sintetica'), prescribedAt: '2026-11-17',
            lineItems: [{ serviceName: await field('Prima prestazione sintetica') }, { serviceName: await field('Seconda prestazione sintetica') }] } },
        { id: randomUUID(), kind: 'diagnosis', values: { diagnoses: await field([{ code: 'SYNTHETIC', description: 'Diagnosi sintetica', system: 'synthetic', date: '2026-11-17' }]) } },
        { id: randomUUID(), kind: 'exemption', values: { exemptions: await field(['SYNTHETIC']) } },
        { id: randomUUID(), kind: 'observation', values: { codeSystem: 'LOINC', code: 'SYNTHETIC', display: 'Osservazione sintetica', unitSystem: 'UCUM', unitCode: '1', value: '1', observedAt: '2026-11-17', notes: await field('Fonte sintetica') } },
    ];
    const items = content === 'all' ? allItems : allItems.filter(item => item.kind === content);
    const operations = { note: 'visita.nota', pdf: 'visita.allega', therapy: 'visita.proponi.terapia', service: 'visita.proponi.prestazione', diagnosis: 'visita.proponi.diagnosi', exemption: 'visita.proponi.esenzione', observation: 'visita.proponi.osservazione', transcription: 'visita.trascrizione' } as const;
    for (const item of items) receipt = database.transaction(() => store.add(principal, id, receipt.revision, {
        id: item.id, kind: item.kind, envelope: seal(item.id, item.kind), byteLength: new TextEncoder().encode(JSON.stringify({ text: 'SYNTHETIC_APPLICATION' })).length,
        documentHash: item.kind === 'pdf' ? 'a'.repeat(64) : null,
    })).immediate();
    receipt = database.transaction(() => store.close(principal, id, receipt.revision)).immediate();
    function prepareCorrection() {
        const replacement = randomUUID();
        const bytes = new TextEncoder().encode(JSON.stringify({ text: 'SYNTHETIC_APPLICATION_CORRECTION' }));
        const sealCorrection = (itemId: string, kind: 'anchor' | 'note') =>
            sealAgentItemNode(publicKey, { mandateRef: mandate.id, visitId: replacement, itemId, kind }, bytes);
        const opened = database.transaction(() => store.open(principal, replacement, sealCorrection(replacement, 'anchor'), id)).immediate();
        const itemId = randomUUID();
        const staged = database.transaction(() => store.add(principal, replacement, opened.revision, {
            id: itemId, kind: 'note', envelope: sealCorrection(itemId, 'note'), byteLength: bytes.length, documentHash: null,
        })).immediate();
        return { replacement, close: () => database.transaction(() => store.close(principal, replacement, staged.revision)).immediate() };
    }
    return { id, mandate, mandates, principal, operations, prepareCorrection,
        whole(): AgentApplicationInput { return { visitId: id, phase: 'review', patientId: fixture.patientId, expectedVersion: version(), cassetteRevision: receipt.revision, items }; } };
}

const added = (after: unknown[][], before: unknown[][]) => after.slice(0, 6).map((rows, index) => rows.length - before[index]!.length);

for (const [provider, allowsClinicalEgress] of [['local', false], ['openai', false], ['anthropic', false], ['openai', true]] as const) {
    test(`L1 L6: the ${provider} cassette with egress ${allowsClinicalEgress} enters only whole, in one review; an automatic or partial request changes nothing`, async () => {
        const f = await visit(provider, allowsClinicalEgress), whole = f.whole(), before = snapshot();
        const without = (kind: string) => ({ ...whole, items: whole.items.filter(item => item.kind !== kind) });
        const only = (...kinds: string[]) => whole.items.filter(item => kinds.includes(item.kind));
        for (const refused of [{ ...whole, phase: 'automatic' }, { ...whole, phase: 'automatic', items: only('transcription', 'pdf') },
            { ...whole, phase: 'automatic', items: only('transcription') }, { ...whole, phase: 'automatic', items: only('pdf') },
            without('pdf'), without('note'), without('transcription'), { ...whole, items: whole.items.filter(item => item.kind === 'note') }, { ...whole, patientId: 'another-synthetic-patient' }]) {
            assert.throws(() => applyAgentVisit(request, fixture.session, refused), /AGENT_APPLICATION_DENIED/);
        }
        assert.deepEqual(snapshot(), before);
        assert.deepEqual(agentAppliedItemIds(f.id), []);
        assert.ok(readAgentCassetteIndex(database, fixture.session.userId, null).visits.some(row => row.id === f.id));
        const receipt = applyAgentVisit(request, fixture.session, whole), after = snapshot();
        assert.equal(receipt.phase, 'review');
        assert.equal(receipt.allowsClinicalEgress, allowsClinicalEgress);
        assert.deepEqual(added(after, before), [2, 2, 1, 1, 2, 1]);
        assert.deepEqual(agentAppliedItemIds(f.id).sort(), whole.items.map(item => item.id).sort());
        const audit = database.prepare('SELECT * FROM audit_events WHERE event_id=?').get(receipt.eventId) as Record<string, string>;
        assert.equal(audit.model_provider, provider);
        assert.deepEqual(JSON.parse(audit.redacted_metadata).flags, ['review', 'cassette_complete']);
        assert.equal(applyAgentVisit(request, fixture.session, whole).eventId, receipt.eventId);
        assert.throws(() => applyAgentVisit(request, fixture.session, { ...whole, phase: 'automatic' }), /AGENT_APPLICATION_DENIED/);
        assert.deepEqual(snapshot(), after);
    });
}

test('one explicit review commits all structured proposals, service lines and proposer audit atomically', async () => {
    const f = await visit();
    assert.ok(readAgentCassetteIndex(database, fixture.session.userId, null).visits.some(row => row.id === f.id));
    const before = snapshot(), input = f.whole();
    const receipt = applyAgentVisit(request, fixture.session, input);
    const after = snapshot();
    assert.deepEqual(added(after, before), [2, 2, 1, 1, 2, 1]);
    assert.equal((after[0].at(-1) as { recorded_by: string }).recorded_by, 'Medico Sintetico');
    assert.equal(agentAppliedItemIds(f.id).length, 9);
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

test('review before the corrected deposit closes prevents the replacement; review after it closes writes nothing', async () => {
    const reviewedFirst = await visit(), lateCorrection = reviewedFirst.prepareCorrection();
    assert.equal(applyAgentVisit(request, fixture.session, reviewedFirst.whole()).status, 'applied');
    const afterReview = snapshot();
    assert.throws(lateCorrection.close, /AGENT_CASSETTE_DENIED/);
    assert.throws(reviewedFirst.prepareCorrection, /AGENT_CASSETTE_DENIED/);
    assert.equal(readAgentCassette(database, lateCorrection.replacement, fixture.session.userId), undefined);
    assert.deepEqual(snapshot(), afterReview);

    const replacedFirst = await visit(), oldPlan = replacedFirst.whole(), correction = replacedFirst.prepareCorrection();
    assert.equal(correction.close().status, 'closed');
    const afterCorrection = snapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, oldPlan), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(snapshot(), afterCorrection);
});
test('a closed deposit survives expiry and revocation of its mandate with its original audit provenance', async () => {
    const f = await visit('local', false, 'all', Date.now() - 86400000);
    const stale = { ...f.whole(), expectedVersion: version() - 1 };
    const before = snapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, stale), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(snapshot(), before);
    assert.ok(readAgentCassetteIndex(database, fixture.session.userId, null).visits.some(row => row.id === f.id));
    createAgentMandateStore(database).revoke(f.mandate.id, fixture.session.userId, f.mandate.archiveGeneration);
    const input = f.whole();
    const receipt = applyAgentVisit(request, fixture.session, input);
    assert.equal(receipt.status, 'applied');
    const after = snapshot();
    assert.deepEqual(database.prepare('SELECT actor_ref, proposer_ref, mandate_ref FROM audit_events WHERE event_id=?').get(receipt.eventId),
        { actor_ref: fixture.session.userId, proposer_ref: f.principal.agentRef, mandate_ref: f.mandate.id });
    assert.equal(applyAgentVisit(request, fixture.session, input).eventId, receipt.eventId);
    assert.deepEqual(snapshot(), after);
});

test('application requires a closed audit receipt, a current admin session and a non-revoked agent', async () => {
    const f = await visit();
    const before = snapshot();
    for (const session of [{ ...fixture.session, role: 'viewer' as const }, { ...fixture.session, expiresAt: Date.now() - 1 },
        { ...fixture.session, id: 'synthetic-unbound-session' }]) {
        assert.throws(() => applyAgentVisit(request, session, f.whole()), /AGENT_APPLICATION_DENIED/);
    }
    assert.deepEqual(snapshot(), before);
    database.prepare('UPDATE agent_clients SET revoked_at=? WHERE id=?').run(Date.now(), f.principal.agentRef);
    assert.throws(() => applyAgentVisit(request, fixture.session, f.whole()), /AGENT_APPLICATION_DENIED/);
    const unaudited = await visit();
    const otherId = randomUUID();
    database.prepare('UPDATE agent_cassettes SET id=? WHERE id=?').run(otherId, unaudited.id);
    const after = snapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...unaudited.whole(), visitId: otherId }), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(snapshot(), after);
});

test('failure of every audit position rolls back the whole review and its consumption receipts', async () => {
    const f = await visit();
    const input = f.whole(), before = snapshot(), expectedAuditCount = 21;
    const withFault = (offset: number, apply: () => unknown) => {
        const count = (database.prepare('SELECT count(*) AS n FROM audit_events').get() as { n: number }).n + offset;
        database.exec(`CREATE TRIGGER synthetic_application_audit_fault BEFORE INSERT ON audit_events WHEN (SELECT count(*) FROM audit_events)=${count} BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_APPLICATION_AUDIT_FAULT'); END`);
        try { return apply(); } finally { database.exec('DROP TRIGGER synthetic_application_audit_fault'); }
    };
    for (let offset = 0; offset < expectedAuditCount; offset++) {
        withFault(offset, () => assert.throws(() => applyAgentVisit(request, fixture.session, input), /SYNTHETIC_APPLICATION_AUDIT_FAULT/));
        assert.deepEqual(snapshot(), before);
        assert.deepEqual(agentAppliedItemIds(f.id), []);
    }
    assert.equal(withFault(expectedAuditCount, () => applyAgentVisit(request, fixture.session, input).status), 'applied');
});

test('native approval commits and audits exactly one plan, and a valid proof cannot be reused or moved', async () => {
    assert.equal(typeof applyConfirmedAgentVisit, 'function');
    const { createVisitConfirmationChallenge } = await import('./agent-visit-confirmation-proof');
    const f = await visit();
    const plan = agentApplicationSchema.parse(f.whole());
    const reference = randomUUID();
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = keys.publicKey.export({ format: 'jwk' });
    const publicKey = Buffer.concat([Buffer.of(4), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64');
    const binding = { reference, ...f.principal, sessionId: fixture.session.id, visitId: plan.visitId, revision: plan.cassetteRevision,
        patientId: plan.patientId, patientVersion: plan.expectedVersion, patientState: agentConfirmationPatientState(plan.patientId, plan.expectedVersion),
        fiscalCode: 'SYNTHETICXX11A11', expiresAt: Date.now() + 60_000 };
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
    assert.deepEqual(added(after, before), [2, 2, 1, 1, 2, 1]);
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

test('a note-only visit and the named new chart commit together within the reviewed ambulatory', async () => {
    const f = await visit('local', false, 'note');
    const ambulatoryId = 'synthetic-visit-clinic';
    const other = 'synthetic-other-clinic';
    database.prepare('INSERT INTO ambulatories (id, name) VALUES (?, ?)').run(ambulatoryId, 'Ambulatorio sintetico');
    database.prepare('INSERT INTO ambulatories (id, name) VALUES (?, ?)').run(other, 'Altro ambulatorio sintetico');
    const newPatient = { ambulatoryId, taxCode: 'RSSMRA80A01F205X', firstName: 'Ada', lastName: 'Sintetica', birthDate: '1980-01-01' };
    const plan = { ...f.whole(), patientId: f.id, expectedVersion: 1, newPatient };
    const before = snapshot();
    for (const [input, scope] of [[plan, other], [{ ...plan, patientId: fixture.patientId }, ambulatoryId],
        [{ ...plan, newPatient: { ...newPatient, firstName: '  ' } }, ambulatoryId],
        [{ ...plan, newPatient: { ...newPatient, birthDate: '1980-02-01' } }, ambulatoryId]] as const) {
        assert.throws(() => applyAgentVisit(request, fixture.session, input, scope), /AGENT_APPLICATION_DENIED/);
        assert.deepEqual(snapshot(), before);
    }
    database.exec("CREATE TRIGGER synthetic_new_patient_audit_fault BEFORE INSERT ON audit_events WHEN NEW.event_type='agent.visit.applied' BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_NEW_PATIENT_AUDIT_FAULT'); END");
    try {
        assert.throws(() => applyAgentVisit(request, fixture.session, plan, ambulatoryId), /SYNTHETIC_NEW_PATIENT_AUDIT_FAULT/);
        assert.deepEqual(snapshot(), before);
        assert.deepEqual(agentAppliedItemIds(f.id), []);
    } finally {
        database.exec('DROP TRIGGER synthetic_new_patient_audit_fault');
    }
    const receipt = applyAgentVisit(request, fixture.session, plan, ambulatoryId);
    const updated = snapshot();
    assert.equal(receipt.status, 'applied');
    assert.deepEqual(added(updated, before), [1, 0, 0, 0, 0, 0]);
    assert.deepEqual(database.prepare('SELECT first_name, last_name, tax_code FROM patients WHERE id=?').get(f.id),
        { first_name: newPatient.firstName, last_name: newPatient.lastName, tax_code: newPatient.taxCode });
    const membership = database.prepare('SELECT ambulatory_id AS id FROM patients_to_ambulatories WHERE patient_id = ?').all(f.id);
    assert.deepEqual(membership, [{ id: ambulatoryId }]);
    assert.equal(applyAgentVisit(request, fixture.session, plan, ambulatoryId).eventId, receipt.eventId);
    const duplicate = await visit('local', false, 'transcription'), duplicatePlan = { ...duplicate.whole(), patientId: duplicate.id, expectedVersion: 1, newPatient };
    const beforeDuplicate = snapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, duplicatePlan, ambulatoryId), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(snapshot(), beforeDuplicate);
    assert.equal(applyAgentVisit(request, fixture.session, { ...duplicatePlan, newPatient: { ...newPatient, taxCode: 'RSSMRA85T10A562S', birthDate: null } }, ambulatoryId).status, 'applied');
});
