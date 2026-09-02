/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-open-loops-read-'));
const databasePath = path.join(dataDir, 'medical.db');
process.env.MEDIFLOW_DATA_DIR = dataDir;

const bootstrap = new Database(databasePath);
for (const fileName of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    bootstrap.exec(fs.readFileSync(path.join(root, 'drizzle', fileName), 'utf8')
        .replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}

const NOW = 1_800_000_000_000;
const DAY_SECONDS = 86_400;
const PATIENT_ID = 'patient.synthetic.open-loops';
const OTHER_PATIENT_ID = 'patient.synthetic.other-open-loops';
const AMBULATORY_ID = 'ambulatory.synthetic.open-loops';
const SCOPE_DIGEST = `sha256:${'a'.repeat(64)}`;

bootstrap.prepare('INSERT INTO ambulatories (id, name, type, version) VALUES (?, ?, ?, 1)')
    .run(AMBULATORY_ID, 'Ambulatorio sintetico open loops', 'test');
for (const patientId of [PATIENT_ID, OTHER_PATIENT_ID]) {
    bootstrap.prepare(`INSERT INTO patients
        (id, first_name, last_name, tax_code, ambulatory_id, is_archived, version)
        VALUES (?, 'Persona', 'Sintetica', ?, ?, 0, 1)`)
        .run(patientId, `SYNTHETIC${patientId.length}`, AMBULATORY_ID);
}
bootstrap.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)')
    .run(PATIENT_ID, AMBULATORY_ID);
bootstrap.prepare(`INSERT INTO service_prescriptions
    (id, patient_id, prescribed_at, status, category, service_name, version, created_at, updated_at)
    VALUES (?, ?, ?, 'prescribed', 'lab', 'Pannello sintetico', 2, ?, ?)`)
    .run('prescription.synthetic.open-loops', PATIENT_ID, Math.floor(NOW / 1_000) - 25 * DAY_SECONDS,
        Math.floor(NOW / 1_000) - 25 * DAY_SECONDS, Math.floor(NOW / 1_000) - 25 * DAY_SECONDS);
bootstrap.prepare(`INSERT INTO service_prescription_items
    (id, patient_id, prescription_id, ordinal, status, category, service_name, match_status,
        version, created_at, updated_at)
    VALUES (?, ?, ?, 0, 'prescribed', 'lab', 'Esame sintetico riservato', 'unmatched', 4, ?, ?)`)
    .run('item.synthetic.open-loops', PATIENT_ID, 'prescription.synthetic.open-loops',
        Math.floor(NOW / 1_000) - 20 * DAY_SECONDS, Math.floor(NOW / 1_000) - 20 * DAY_SECONDS);
for (const [index, daysAgo] of [60, 50, 40].entries()) {
    bootstrap.prepare(`INSERT INTO observations
        (id, patient_id, code_system, code, display, unit_system, unit_code, value, observed_at,
            source, version, created_at, updated_at)
        VALUES (?, ?, 'LOINC', 'SYN-LOOP', 'Serie sintetica riservata', 'UCUM', '1', ?, ?,
            'manual', ?, ?, ?)`)
        .run(`observation.synthetic.open-loops.${index}`, PATIENT_ID, String(index + 1),
            Math.floor(NOW / 1_000) - daysAgo * DAY_SECONDS, index + 1,
            Math.floor(NOW / 1_000) - daysAgo * DAY_SECONDS,
            Math.floor(NOW / 1_000) - daysAgo * DAY_SECONDS);
}
bootstrap.close();

const { createAipOwnerBrokerV1 } = await import('../../packages/aip/src/owner-broker.ts');
const { createPatientOpenLoopsReadInternalCandidateV1 } =
    await import('./patient-open-loops-read-production.ts');

function closed<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}

const claim = closed({
    operation: 'mediflow.patient.open_loops.read.v1',
    capabilityId: 'mediflow.patient.open_loops.read.v1',
});
const current = closed({
    peerRef: 'peer.local.synthetic.open-loops',
    runtimeRef: 'runtime.local.synthetic.open-loops',
    generation: 4,
    revocationGeneration: 1,
    selectionEpoch: 9,
    parentGeneration: 2,
    policyGeneration: 3,
});
const scope = closed({
    status: 'available' as const,
    patientId: PATIENT_ID,
    ambulatoryId: AMBULATORY_ID,
    scopeDigest: SCOPE_DIGEST,
    generation: current.generation,
    revocationGeneration: current.revocationGeneration,
    selectionEpoch: current.selectionEpoch,
    restartGeneration: 2,
    expiresAt: NOW + 10_000,
});

function harness(options: { scope?: Readonly<Record<string, unknown>>; mutateOnAllowed?: boolean } = {}) {
    const brokerAudits: unknown[] = [];
    const operationAudits: unknown[] = [];
    const refs = ['agent.synthetic.open-loops', 'lease.synthetic.open-loops'];
    const broker = createAipOwnerBrokerV1({
        now: () => NOW,
        nextRef: () => refs.shift(),
        hashRef: (value: string) => `sha256:${Buffer.from(value).toString('hex').padEnd(64, '0').slice(0, 64)}`,
        writeAudit: (audit: unknown) => { brokerAudits.push(audit); return Promise.resolve(); },
    });
    const owner = broker.issueOwner(closed({
        peerRef: current.peerRef,
        runtimeRef: current.runtimeRef,
        parentRef: 'parent.local.synthetic.open-loops',
        purposeCode: 'care_coordination',
        operation: claim.operation,
        capabilityId: claim.capabilityId,
        scopeDigest: SCOPE_DIGEST,
        maxStage: 'read_only',
        budget: 2,
        expiresAt: NOW + 10_000,
        generation: current.generation,
        revocationGeneration: current.revocationGeneration,
        selectionEpoch: current.selectionEpoch,
        parentGeneration: current.parentGeneration,
        policyGeneration: current.policyGeneration,
        venue: 'local_intelligent_host',
        egressAllowed: false,
    }));
    const candidate = createPatientOpenLoopsReadInternalCandidateV1(closed({
        now: () => NOW,
        current: () => current,
        beginPermit: broker.beginPermit,
        bindPermit: broker.bindPermit,
        finalizeBoundPermit: broker.finalizeBoundPermit,
        denyPermit: broker.denyPermit,
        readHostScopeCandidate: () => options.scope ?? scope,
        writeAudit: (audit: unknown) => {
            operationAudits.push(audit);
            if (options.mutateOnAllowed && (audit as { outcome?: unknown }).outcome === 'allowed') {
                const database = new Database(databasePath);
                try {
                    database.prepare('UPDATE service_prescription_items SET version = version + 1 WHERE id = ?')
                        .run('item.synthetic.open-loops');
                } finally { database.close(); }
            }
            return Promise.resolve();
        },
    }));
    return {
        broker,
        owner,
        candidate,
        operationAudits,
        permit: () => broker.authorize(broker.issueLease(owner), current, claim),
    };
}

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('reads the host-owned selection through the Application Service and publishes opaque minimized loops', async () => {
    const value = harness();
    try {
        const result = await value.candidate.service.read(await value.permit(), closed({
            schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
            operationId: 'mediflow.patient.open_loops.read.v1',
        }));

        assert.equal(result.outcome, 'read');
        assert.equal(result.items.length, 2);
        assert.deepEqual(result.items.map((item) => item.kind), ['series_stalled', 'results_pending']);
        for (const item of result.items) {
            assert.match(item.loopRef, /^aipl_[0-9a-f]{64}$/u);
            assert.equal(item.temporalState, 'overdue');
            assert.equal(typeof item.revision, 'number');
        }
        const serialized = JSON.stringify(result);
        assert.doesNotMatch(serialized, /patient\.synthetic|ambulatory\.synthetic|Esame sintetico|Serie sintetica|SYN-LOOP/u);
        assert.deepEqual(value.operationAudits.map((audit) => (audit as { outcome: string }).outcome), ['allowed']);
    } finally { value.candidate.service.dispose(); }
});

test('fails closed before publication when the selected patient projection changes during the audit fence', async () => {
    const value = harness({ mutateOnAllowed: true });
    try {
        await assert.rejects(value.candidate.service.read(await value.permit(), closed({
            schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
            operationId: 'mediflow.patient.open_loops.read.v1',
        })), (error: unknown) => (error as { code?: unknown }).code === 'scope_changed');
        assert.deepEqual(value.operationAudits.map((audit) => [
            (audit as { outcome: string }).outcome,
            (audit as { denialCode: string | null }).denialCode,
        ]), [['allowed', null], ['denied', 'scope_changed']]);
        assert.doesNotMatch(JSON.stringify(value.operationAudits), /patient\.synthetic|ambulatory\.synthetic|SYN-LOOP/u);
    } finally { value.candidate.service.dispose(); }
});

test('denies an unavailable ambulatory membership without returning another patient data', async () => {
    const value = harness({ scope: closed({ ...scope, patientId: OTHER_PATIENT_ID }) });
    try {
        await assert.rejects(value.candidate.service.read(await value.permit(), closed({
            schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
            operationId: 'mediflow.patient.open_loops.read.v1',
        })), (error: unknown) => (error as { code?: unknown }).code === 'snapshot_unavailable');
        assert.deepEqual(value.operationAudits.map((audit) => (audit as { outcome: string }).outcome), ['denied']);
    } finally { value.candidate.service.dispose(); }
});
