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
const DB_SOURCE_ROW_LIMIT = 1_024;
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
    generation: current.generation,
    revocationGeneration: current.revocationGeneration,
    selectionEpoch: current.selectionEpoch,
    restartGeneration: 2,
    expiresAt: NOW + 10_000,
    scopeDigest: SCOPE_DIGEST,
});
const READ_INPUT = closed({ schemaVersion: 'mediflow.patient.open_loops.read.input.v1',
    operationId: 'mediflow.patient.open_loops.read.v1' });

function harness(options: { scope?: Readonly<Record<string, unknown>>; ownerScopeDigest?: string;
    mutateOnAllowed?: boolean; mutateOnFinalize?: boolean;
    onResolveHostScope?: () => void } = {}) {
    const brokerAudits: unknown[] = [];
    const operationAudits: unknown[] = [];
    const refs = ['agent.synthetic.open-loops', 'lease.synthetic.open-loops'];
    const scopesByExecution = new WeakMap<object, Readonly<Record<string, unknown>>>();
    const begunExecutions: object[] = [];
    const resolvedExecutions: object[] = [];
    const registeredScope = options.scope ?? scope;
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
        scopeDigest: options.ownerScopeDigest ?? SCOPE_DIGEST,
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
    const resolveHostScope = (execution: unknown) => {
        if (!execution || typeof execution !== 'object') return null;
        resolvedExecutions.push(execution);
        options.onResolveHostScope?.();
        return scopesByExecution.get(execution) ?? null;
    };
    const candidate = createPatientOpenLoopsReadInternalCandidateV1(closed({
        now: () => NOW,
        current: () => current,
        beginPermit: (permit: unknown, currentValue: unknown, claimValue: unknown) => {
            const execution = broker.beginPermit(permit, currentValue, claimValue);
            scopesByExecution.set(execution, registeredScope);
            begunExecutions.push(execution);
            return execution;
        },
        bindPermit: broker.bindPermit,
        finalizeBoundPermit: (execution: unknown, binding: unknown, currentValue: unknown, claimValue: unknown) => {
            const finalized = broker.finalizeBoundPermit(execution, binding, currentValue, claimValue);
            if (options.mutateOnFinalize) {
                const database = new Database(databasePath);
                try {
                    database.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id = ? AND ambulatory_id = ?')
                        .run(PATIENT_ID, AMBULATORY_ID);
                } finally { database.close(); }
            }
            return finalized;
        },
        denyPermit: broker.denyPermit,
        resolveHostScope,
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
        begunExecutions,
        resolvedExecutions,
        resolveHostScope,
        permit: () => broker.authorize(broker.issueLease(owner), current, claim),
    };
}

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('reads the host-owned selection through the Application Service and publishes opaque minimized loops', async () => {
    const value = harness();
    try {
        assert.deepEqual(Reflect.ownKeys(scope), [
            'status', 'patientId', 'ambulatoryId', 'generation', 'revocationGeneration',
            'selectionEpoch', 'restartGeneration', 'expiresAt', 'scopeDigest',
        ]);
        const result = await value.candidate.service.read(await value.permit(), READ_INPUT);

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
        await assert.rejects(value.candidate.service.read(await value.permit(), READ_INPUT),
            (error: unknown) => (error as { code?: unknown }).code === 'scope_changed');
        assert.deepEqual(value.operationAudits.map((audit) => [
            (audit as { outcome: string }).outcome,
            (audit as { denialCode: string | null }).denialCode,
        ]), [['allowed', null], ['denied', 'scope_changed']]);
        assert.doesNotMatch(JSON.stringify(value.operationAudits), /patient\.synthetic|ambulatory\.synthetic|SYN-LOOP/u);
    } finally { value.candidate.service.dispose(); }
});

test('keeps different patient scopes bound to their own opaque permit execution', async () => {
    const otherDigest = `sha256:${'b'.repeat(64)}`;
    const first = harness();
    const second = harness({ ownerScopeDigest: otherDigest,
        scope: closed({ ...scope, patientId: OTHER_PATIENT_ID, scopeDigest: otherDigest }) });
    try {
        assert.equal((await first.candidate.service.read(await first.permit(), READ_INPUT)).items.length, 2);
        await assert.rejects(second.candidate.service.read(await second.permit(), READ_INPUT),
            (error: unknown) => (error as { code?: unknown }).code === 'snapshot_unavailable');
        assert.notEqual(first.begunExecutions[0], second.begunExecutions[0]);
        assert.ok(first.resolvedExecutions.every((execution) => execution === first.begunExecutions[0]));
        assert.ok(second.resolvedExecutions.every((execution) => execution === second.begunExecutions[0]));
        assert.equal(first.resolveHostScope(second.begunExecutions[0]), null);
        assert.equal(second.resolveHostScope(first.begunExecutions[0]), null);
    } finally {
        first.candidate.service.dispose();
        second.candidate.service.dispose();
    }
});

test('rejects the legacy zero-argument scope source instead of accepting caller-selected IDs', () => {
    const legacy = {
        now: () => NOW,
        current: () => current,
        beginPermit: () => Object.freeze(Object.create(null)),
        bindPermit: () => Object.freeze(Object.create(null)),
        finalizeBoundPermit: () => true,
        denyPermit: () => true,
        readHostScopeCandidate: () => scope,
        writeAudit: () => Promise.resolve(),
    };
    const rejected = (sources: Record<string, unknown>) => assert.throws(
        () => createPatientOpenLoopsReadInternalCandidateV1(closed(sources)),
        (error: unknown) => (error as { code?: unknown }).code === 'operation_unavailable');
    rejected(legacy);
    rejected({ now: legacy.now, current: legacy.current, beginPermit: legacy.beginPermit,
        bindPermit: legacy.bindPermit, finalizeBoundPermit: legacy.finalizeBoundPermit,
        denyPermit: legacy.denyPermit, resolveHostScope: () => scope, writeAudit: legacy.writeAudit });
});

test('fails closed on execution scope mismatch, broker revocation and broker restart', async () => {
    const mismatch = harness({ scope: closed({ ...scope, scopeDigest: `sha256:${'c'.repeat(64)}` }) });
    try {
        await assert.rejects(mismatch.candidate.service.read(await mismatch.permit(), READ_INPUT),
            (error: unknown) => (error as { code?: unknown }).code === 'authorization_denied');
    } finally { mismatch.candidate.service.dispose(); }

    for (const invalidate of [
        (value: ReturnType<typeof harness>) => value.broker.revokeOwner(value.owner),
        (value: ReturnType<typeof harness>) => value.broker.restart(),
    ]) {
        const value = harness();
        try {
            const permit = await value.permit();
            invalidate(value);
            await assert.rejects(value.candidate.service.read(permit, READ_INPUT),
                (error: unknown) => (error as { code?: unknown }).code === 'authorization_denied');
            assert.equal(value.resolvedExecutions.length, 0);
        } finally { value.candidate.service.dispose(); }
    }
});

test('rejects oversized host patient and ambulatory identifiers before any DB projection', async () => {
    const oversized = 'x'.repeat(257);
    for (const candidateScope of [
        closed({ ...scope, patientId: oversized }),
        closed({ ...scope, ambulatoryId: oversized }),
    ]) {
        const value = harness({ scope: candidateScope });
        try {
            await assert.rejects(value.candidate.service.read(await value.permit(), READ_INPUT),
                (error: unknown) => (error as { code?: unknown }).code === 'lease_unavailable');
            assert.deepEqual(value.operationAudits.map((audit) => (audit as { outcome: string }).outcome), ['denied']);
        } finally { value.candidate.service.dispose(); }
    }
});

test('namespaces every opaque loop reference to the broker-bound host scope digest', async () => {
    const otherDigest = `sha256:${'b'.repeat(64)}`;
    const first = harness();
    const second = harness({ ownerScopeDigest: otherDigest, scope: closed({ ...scope, scopeDigest: otherDigest }) });
    try {
        const left = await first.candidate.service.read(await first.permit(), READ_INPUT);
        const right = await second.candidate.service.read(await second.permit(), READ_INPUT);
        assert.deepEqual(left.items.map((item) => item.kind), right.items.map((item) => item.kind));
        assert.equal(new Set([
            ...left.items.map((item) => item.loopRef),
            ...right.items.map((item) => item.loopRef),
        ]).size, left.items.length + right.items.length);
    } finally {
        first.candidate.service.dispose();
        second.candidate.service.dispose();
    }
});

test('fails closed when either patient-scoped source query exceeds its explicit DB row cap', async () => {
    const database = new Database(databasePath);
    const expectOverflowDenial = async () => {
        const value = harness();
        try {
            await assert.rejects(value.candidate.service.read(await value.permit(), READ_INPUT),
                (error: unknown) => (error as { code?: unknown }).code === 'snapshot_unavailable');
            assert.deepEqual(value.operationAudits.map((audit) => (audit as { outcome: string }).outcome), ['denied']);
        } finally { value.candidate.service.dispose(); }
    };
    try {
        const insertObservation = database.prepare(`INSERT INTO observations
            (id, patient_id, code_system, code, display, unit_system, unit_code, value, observed_at,
                source, version, created_at, updated_at)
            VALUES (?, ?, 'LOINC', ?, 'Serie sintetica overflow', 'UCUM', '1', '1', ?,
                'manual', 1, ?, ?)`);
        database.transaction(() => {
            for (let index = 0; index <= DB_SOURCE_ROW_LIMIT; index += 1) {
                const timestamp = Math.floor(NOW / 1_000) - (index + 100) * DAY_SECONDS;
                insertObservation.run(`observation.synthetic.overflow.${index}`, PATIENT_ID,
                    `SYN-OVERFLOW-${index}`, timestamp, timestamp, timestamp);
            }
        })();
        await expectOverflowDenial();
        database.prepare("DELETE FROM observations WHERE id LIKE 'observation.synthetic.overflow.%'").run();

        const insertItem = database.prepare(`INSERT INTO service_prescription_items
            (id, patient_id, prescription_id, ordinal, status, category, service_name, match_status,
                version, created_at, updated_at)
            VALUES (?, ?, 'prescription.synthetic.open-loops', ?, 'prescribed', 'lab',
                'Esame sintetico overflow', 'unmatched', 1, ?, ?)`);
        database.transaction(() => {
            for (let index = 0; index <= DB_SOURCE_ROW_LIMIT; index += 1) {
                const timestamp = Math.floor(NOW / 1_000) - 20 * DAY_SECONDS;
                insertItem.run(`item.synthetic.overflow.${index}`, PATIENT_ID, index + 1, timestamp, timestamp);
            }
        })();
        await expectOverflowDenial();
    } finally {
        database.prepare("DELETE FROM observations WHERE id LIKE 'observation.synthetic.overflow.%'").run();
        database.prepare("DELETE FROM service_prescription_items WHERE id LIKE 'item.synthetic.overflow.%'").run();
        database.close();
    }
});

test('revalidates membership after the final scope and broker callbacks before publication', async () => {
    const restoreMembership = () => {
        const database = new Database(databasePath);
        try {
            database.prepare('INSERT OR IGNORE INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)')
                .run(PATIENT_ID, AMBULATORY_ID);
        } finally { database.close(); }
    };
    let reads = 0;
    const afterFingerprint = harness({
        onResolveHostScope: () => {
            reads += 1;
            if (reads === 5) {
                const database = new Database(databasePath);
                try {
                    database.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id = ? AND ambulatory_id = ?')
                        .run(PATIENT_ID, AMBULATORY_ID);
                } finally { database.close(); }
            }
        },
    });
    try {
        await assert.rejects(afterFingerprint.candidate.service.read(await afterFingerprint.permit(), READ_INPUT),
            (error: unknown) => (error as { code?: unknown }).code === 'scope_changed');
        assert.equal(reads, 5);
        assert.deepEqual(afterFingerprint.operationAudits.map((audit) => (audit as { outcome: string }).outcome),
            ['allowed', 'denied']);
    } finally {
        afterFingerprint.candidate.service.dispose();
        restoreMembership();
    }

    const afterFinalize = harness({ mutateOnFinalize: true });
    try {
        await assert.rejects(afterFinalize.candidate.service.read(await afterFinalize.permit(), READ_INPUT),
            (error: unknown) => (error as { code?: unknown }).code === 'operation_unavailable');
        assert.deepEqual(afterFinalize.operationAudits.map((audit) => (audit as { outcome: string }).outcome),
            ['allowed', 'denied']);
        assert.doesNotMatch(JSON.stringify(afterFinalize.operationAudits), /patient\.synthetic|ambulatory\.synthetic/u);
    } finally {
        afterFinalize.candidate.service.dispose();
        restoreMembership();
    }
});
