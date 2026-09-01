/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-checkup-status-candidate-'));
const databasePath = path.join(dataDir, 'medical.db');
process.env.MEDIFLOW_DATA_DIR = dataDir;

const bootstrap = new Database(databasePath);
for (const fileName of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    bootstrap.exec(fs.readFileSync(path.join(root, 'drizzle', fileName), 'utf8')
        .replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}

const ACTOR_ID = 'synthetic-physician-checkup';
const PATIENT_ID = 'synthetic-patient-checkup';
const AMBULATORY_ID = 'synthetic-ambulatory-checkup';
const CHECKUP_ID = 'synthetic-checkup-current';
const REPLAY_CHECKUP_ID = 'synthetic-checkup-replay';
const ROLLBACK_CHECKUP_ID = 'synthetic-checkup-rollback';
const SCOPE_CHECKUP_ID = 'synthetic-checkup-scope';
const EXPIRY_CHECKUP_ID = 'synthetic-checkup-expiry';
const REENTRY_CHECKUP_ID = 'synthetic-checkup-reentry';
const CONCURRENT_CHECKUP_ID = 'synthetic-checkup-concurrent';
const INITIAL_REVISION = 4;

bootstrap.prepare('INSERT INTO ambulatories (id, name, type, version) VALUES (?, ?, ?, 1)')
    .run(AMBULATORY_ID, 'Ambulatorio sintetico checkup', 'test');
bootstrap.prepare(`INSERT INTO patients
    (id, first_name, last_name, tax_code, ambulatory_id, is_archived, version)
    VALUES (?, ?, ?, ?, ?, 0, 1)`)
    .run(PATIENT_ID, 'Paziente', 'Sintetico', 'SYNTHETICCHECKUP01', AMBULATORY_ID);
bootstrap.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)')
    .run(PATIENT_ID, AMBULATORY_ID);
bootstrap.prepare(`INSERT INTO checkups
    (id, patient_id, date, title, status, version) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(CHECKUP_ID, PATIENT_ID, 1_800_000_000, 'Controllo sintetico', INITIAL_REVISION);
bootstrap.prepare(`INSERT INTO checkups
    (id, patient_id, date, title, status, version) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(REPLAY_CHECKUP_ID, PATIENT_ID, 1_800_000_100, 'Replay sintetico', 2);
bootstrap.prepare(`INSERT INTO checkups
    (id, patient_id, date, title, status, version) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(ROLLBACK_CHECKUP_ID, PATIENT_ID, 1_800_000_200, 'Rollback sintetico', 6);
bootstrap.prepare(`INSERT INTO checkups
    (id, patient_id, date, title, status, version) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(SCOPE_CHECKUP_ID, PATIENT_ID, 1_800_000_300, 'Scope sintetico', 3);
bootstrap.prepare(`INSERT INTO checkups
    (id, patient_id, date, title, status, version) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(EXPIRY_CHECKUP_ID, PATIENT_ID, 1_800_000_400, 'Expiry sintetica', 1);
bootstrap.prepare(`INSERT INTO checkups
    (id, patient_id, date, title, status, version) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(REENTRY_CHECKUP_ID, PATIENT_ID, 1_800_000_500, 'Reentry sintetica', 1);
bootstrap.prepare(`INSERT INTO checkups
    (id, patient_id, date, title, status, version) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(CONCURRENT_CHECKUP_ID, PATIENT_ID, 1_800_000_600, 'Concorrenza sintetica', 1);
bootstrap.close();

const { createHeadlessCheckupStatusTransitionInternalCandidateV1 } =
    await import('./headless-checkup-status-transition-production.ts');
const { createHeadlessCheckupStatusTransitionStorageV1 } =
    await import('./headless-checkup-status-transition-storage.ts');

function closed<Value extends Record<string, unknown>>(value: Value): Readonly<Value> {
    return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<Value>;
}

let clock = 1_800_000_000_000;
let currentScope = closed({
    status: 'available' as const,
    actorRef: ACTOR_ID,
    patientId: PATIENT_ID,
    ambulatoryId: AMBULATORY_ID,
    checkupId: CHECKUP_ID,
    generation: 7,
    revocationGeneration: 2,
    selectionEpoch: 11,
});

const candidate = createHeadlessCheckupStatusTransitionInternalCandidateV1({
    now: () => clock,
    readHostScopeCandidate: () => currentScope,
});

after(() => {
    candidate.service.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('couples current scope, status CAS, audit and PHI-safe receipt in one synthetic SQLite commit', () => {
    const checkupRef = candidate.candidateController.issueSelectedCheckupRef();
    assert.match(checkupRef, /^hcsr_[0-9a-f]{64}$/u);
    const input = closed({
        schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
        operationId: 'mediflow.patient.checkup.status.transition.v1',
        checkupRef,
        targetStatus: 'completed' as const,
        expectedRevision: INITIAL_REVISION,
    });
    const preview = candidate.service.preview(input);
    assert.deepEqual(Reflect.ownKeys(preview), [
        'schemaVersion', 'operationId', 'outcome', 'proposalRef', 'expiresAt',
    ]);
    clock += 1_000;
    const proof = candidate.candidateController.issueConfirmationProof(preview.proposalRef);
    const confirmedAt = clock;
    clock += 250;
    const receipt = candidate.service.confirm(preview.proposalRef, proof);
    assert.equal(candidate.service.confirm(preview.proposalRef, proof), receipt);

    assert.equal(Object.getPrototypeOf(receipt), null);
    assert.equal(Object.isFrozen(receipt), true);
    assert.deepEqual(receipt, closed({
        schemaVersion: 'mediflow.patient.checkup.status.transition.receipt.v1',
        operationId: 'mediflow.patient.checkup.status.transition.v1',
        capabilityId: 'mediflow.patient.checkup.status.transition.v1',
        outcome: 'status_transitioned',
        denialCode: null,
        fromStatus: 'pending',
        toStatus: 'completed',
        previousRevision: INITIAL_REVISION,
        newRevision: INITIAL_REVISION + 1,
        ownerRefHash: receipt.ownerRefHash,
        resourceRefHash: receipt.resourceRefHash,
        proofRefHash: receipt.proofRefHash,
        receiptRefHash: receipt.receiptRefHash,
        generation: 7,
        revocationGeneration: 2,
        selectionEpoch: 11,
        timestamp: confirmedAt,
    }));
    for (const value of [receipt.ownerRefHash, receipt.resourceRefHash,
        receipt.proofRefHash, receipt.receiptRefHash]) assert.match(value, /^sha256:[0-9a-f]{64}$/u);

    const check = new Database(databasePath, { readonly: true });
    try {
        assert.deepEqual(check.prepare(`SELECT status, version, updated_at AS updatedAt
            FROM checkups WHERE id = ?`).get(CHECKUP_ID), {
            status: 'completed', version: INITIAL_REVISION + 1, updatedAt: Math.floor(confirmedAt / 1_000),
        });
        const audit = check.prepare(`SELECT event_type AS eventType, outcome, actor_type AS actorType,
            actor_ref AS actorRef, subject_type AS subjectType, subject_ref AS subjectRef,
            source_surface AS sourceSurface, redacted_metadata AS redactedMetadata
            FROM audit_events WHERE event_type = 'checkup.updated'`).get() as Record<string, unknown>;
        assert.deepEqual({ ...audit, redactedMetadata: JSON.parse(audit.redactedMetadata as string) }, {
            eventType: 'checkup.updated', outcome: 'success', actorType: 'user',
            actorRef: receipt.ownerRefHash, subjectType: 'checkup', subjectRef: receipt.resourceRefHash,
            sourceSurface: 'api',
            redactedMetadata: {
                schemaVersion: 'mediflow.patient.checkup.status.transition.audit.v1',
                commandDigest: (JSON.parse(audit.redactedMetadata as string) as { commandDigest: string }).commandDigest,
                idempotencyKeyHash: (JSON.parse(audit.redactedMetadata as string) as { idempotencyKeyHash: string }).idempotencyKeyHash,
                receipt: JSON.parse(JSON.stringify(receipt)),
            },
        });
        assert.match((JSON.parse(audit.redactedMetadata as string) as { commandDigest: string }).commandDigest,
            /^sha256:[0-9a-f]{64}$/u);
        assert.match((JSON.parse(audit.redactedMetadata as string) as { idempotencyKeyHash: string }).idempotencyKeyHash,
            /^sha256:[0-9a-f]{64}$/u);
        assert.equal(JSON.stringify(audit).includes(ACTOR_ID), false);
        assert.equal(JSON.stringify(audit).includes(PATIENT_ID), false);
        assert.equal(JSON.stringify(audit).includes(AMBULATORY_ID), false);
        assert.equal(JSON.stringify(audit).includes(CHECKUP_ID), false);
    } finally { check.close(); }
});

test('rejects when candidate scope currentness crosses the preview deadline before the CAS fence', () => {
    let expiryClock = 1_800_100_000_000;
    let crossDeadline = false;
    let confirmationReads = 0;
    const expiryScope = availableScope(EXPIRY_CHECKUP_ID);
    const expiryCandidate = createHeadlessCheckupStatusTransitionInternalCandidateV1({
        now: () => expiryClock,
        readHostScopeCandidate: () => {
            if (crossDeadline) {
                confirmationReads += 1;
                if (confirmationReads === 2) {
                    crossDeadline = false;
                    expiryClock += 2;
                }
            }
            return expiryScope;
        },
    });
    const before = new Database(databasePath, { readonly: true });
    const auditCount = (before.prepare("SELECT count(*) AS count FROM audit_events WHERE event_type = 'checkup.updated'")
        .get() as { count: number }).count;
    before.close();

    try {
        const checkupRef = expiryCandidate.candidateController.issueSelectedCheckupRef();
        const preview = expiryCandidate.service.preview(closed({
            schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
            operationId: 'mediflow.patient.checkup.status.transition.v1', checkupRef,
            targetStatus: 'completed' as const, expectedRevision: 1,
        }));
        expiryClock = preview.expiresAt - 1;
        const proof = expiryCandidate.candidateController.issueConfirmationProof(preview.proposalRef);
        crossDeadline = true;
        assert.throws(() => expiryCandidate.service.confirm(preview.proposalRef, proof),
            (error: unknown) => (error as { code?: unknown }).code === 'preview_expired');

        const check = new Database(databasePath, { readonly: true });
        try {
            assert.deepEqual(check.prepare('SELECT status, version FROM checkups WHERE id = ?')
                .get(EXPIRY_CHECKUP_ID), { status: 'pending', version: 1 });
            assert.equal((check.prepare("SELECT count(*) AS count FROM audit_events WHERE event_type = 'checkup.updated'")
                .get() as { count: number }).count, auditCount);
        } finally { check.close(); }
    } finally { expiryCandidate.service.dispose(); }
});

test('invalidates an outer confirmation when candidate scope currentness reenters it before proof consumption', () => {
    const reentryScope = availableScope(REENTRY_CHECKUP_ID);
    let reenter = false;
    let proposalRef = '';
    let proof: object | null = null;
    let nestedOutcome: string | null = null;
    let nestedCode: string | null = null;
    const reentryCandidate: ReturnType<typeof createHeadlessCheckupStatusTransitionInternalCandidateV1> =
        createHeadlessCheckupStatusTransitionInternalCandidateV1({
        now: () => 1_800_200_000_000,
        readHostScopeCandidate: () => {
            if (reenter) {
                reenter = false;
                try { nestedOutcome = reentryCandidate.service.confirm(proposalRef, proof!).outcome; }
                catch (error) { nestedCode = (error as { code?: string }).code ?? null; }
            }
            return reentryScope;
        },
    });
    const before = new Database(databasePath, { readonly: true });
    const auditCount = (before.prepare("SELECT count(*) AS count FROM audit_events WHERE event_type = 'checkup.updated'")
        .get() as { count: number }).count;
    before.close();

    try {
        const checkupRef = reentryCandidate.candidateController.issueSelectedCheckupRef();
        const preview = reentryCandidate.service.preview(closed({
            schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
            operationId: 'mediflow.patient.checkup.status.transition.v1', checkupRef,
            targetStatus: 'completed' as const, expectedRevision: 1,
        }));
        proposalRef = preview.proposalRef;
        proof = reentryCandidate.candidateController.issueConfirmationProof(proposalRef);
        reenter = true;
        assert.throws(() => reentryCandidate.service.confirm(proposalRef, proof),
            (error: unknown) => (error as { code?: unknown }).code === 'operation_unavailable');
        assert.equal(nestedOutcome, null);
        assert.equal(nestedCode, 'operation_unavailable');

        const check = new Database(databasePath, { readonly: true });
        try {
            assert.deepEqual(check.prepare('SELECT status, version FROM checkups WHERE id = ?')
                .get(REENTRY_CHECKUP_ID), { status: 'pending', version: 1 });
            assert.equal((check.prepare("SELECT count(*) AS count FROM audit_events WHERE event_type = 'checkup.updated'")
                .get() as { count: number }).count, auditCount);
        } finally { check.close(); }
    } finally { reentryCandidate.service.dispose(); }
});

test('invalidates confirmation when the host clock callback reenters the same candidate', () => {
    const scope = availableScope(REENTRY_CHECKUP_ID);
    let reenter = false, proposalRef = '', proof: object | null = null, nestedCode: string | null = null;
    const clockCandidate: ReturnType<typeof createHeadlessCheckupStatusTransitionInternalCandidateV1> =
        createHeadlessCheckupStatusTransitionInternalCandidateV1({
        now: () => {
            if (reenter) {
                reenter = false;
                try { clockCandidate.service.confirm(proposalRef, proof!); }
                catch (error) { nestedCode = (error as { code?: string }).code ?? null; }
            }
            return 1_800_200_100_000;
        },
        readHostScopeCandidate: () => scope,
    });
    const before = new Database(databasePath, { readonly: true });
    const auditCount = (before.prepare("SELECT count(*) AS count FROM audit_events WHERE event_type = 'checkup.updated'")
        .get() as { count: number }).count;
    before.close();

    try {
        const checkupRef = clockCandidate.candidateController.issueSelectedCheckupRef();
        const preview = clockCandidate.service.preview(closed({
            schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
            operationId: 'mediflow.patient.checkup.status.transition.v1', checkupRef,
            targetStatus: 'completed' as const, expectedRevision: 1,
        }));
        proposalRef = preview.proposalRef;
        proof = clockCandidate.candidateController.issueConfirmationProof(proposalRef);
        reenter = true;
        assert.throws(() => clockCandidate.service.confirm(proposalRef, proof),
            (error: unknown) => (error as { code?: unknown }).code === 'operation_unavailable');
        assert.equal(nestedCode, 'operation_unavailable');
        const check = new Database(databasePath, { readonly: true });
        try {
            assert.deepEqual(check.prepare('SELECT status, version FROM checkups WHERE id = ?')
                .get(REENTRY_CHECKUP_ID), { status: 'pending', version: 1 });
            assert.equal((check.prepare("SELECT count(*) AS count FROM audit_events WHERE event_type = 'checkup.updated'")
                .get() as { count: number }).count, auditCount);
        } finally { check.close(); }
    } finally { clockCandidate.service.dispose(); }
});

function availableScope(checkupId: string) {
    return closed({
        status: 'available' as const, actorRef: ACTOR_ID, patientId: PATIENT_ID,
        ambulatoryId: AMBULATORY_ID, checkupId, generation: 7,
        revocationGeneration: 2, selectionEpoch: 11,
    });
}

function storageCommand(
    storage: ReturnType<typeof createHeadlessCheckupStatusTransitionStorageV1>,
    checkupRef: string,
    snapshot: Record<string, unknown>,
    targetStatus: 'completed' | 'cancelled',
    expectedRevision: number,
    idempotencyHex: string,
) {
    const commandDigest = storage.digestCommand([
        'mediflow.patient.checkup.status.transition.v1', checkupRef, targetStatus, expectedRevision,
        snapshot.generation, snapshot.revocationGeneration, snapshot.selectionEpoch,
    ].join('\0'));
    return closed({
        operationId: 'mediflow.patient.checkup.status.transition.v1',
        capabilityId: 'mediflow.patient.checkup.status.transition.v1',
        idempotencyKey: `hcsi_${idempotencyHex.repeat(64)}`,
        commandDigest,
        ownerIdentity: snapshot.ownerIdentity as object,
        resourceIdentity: snapshot.resourceIdentity as object,
        fromStatus: 'pending' as const,
        targetStatus,
        expectedRevision,
        generation: snapshot.generation as number,
        revocationGeneration: snapshot.revocationGeneration as number,
        selectionEpoch: snapshot.selectionEpoch as number,
        expiresAt: clock + 120_000,
        proofRefHash: `sha256:${'b'.repeat(64)}`,
        confirmedAt: clock,
    });
}

test('replays the same storage command exactly once and denies a different digest on the same key', () => {
    currentScope = availableScope(REPLAY_CHECKUP_ID);
    const storage = createHeadlessCheckupStatusTransitionStorageV1(closed({
        now: () => clock,
        readHostScopeCandidate: () => currentScope,
    }));
    const checkupRef = storage.issueSelectedCheckupRef();
    const input = closed({ schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
        operationId: 'mediflow.patient.checkup.status.transition.v1', checkupRef,
        targetStatus: 'cancelled' as const, expectedRevision: 2 });
    const snapshot = storage.readSnapshot(input) as Record<string, unknown>;
    assert.equal(snapshot.status, 'available');
    const command = storageCommand(storage, checkupRef, snapshot, 'cancelled', 2, 'a');
    const first = storage.commit(command);
    assert.equal(first.status, 'committed', JSON.stringify(first));
    const replay = storage.commit(command);
    assert.deepEqual(replay, first);

    const conflict = storage.commit(storageCommand(storage, checkupRef, snapshot, 'completed', 2, 'a'));
    assert.deepEqual(conflict, closed({ status: 'denied', code: 'idempotency_conflict' }));
    const check = new Database(databasePath, { readonly: true });
    try {
        assert.deepEqual(check.prepare('SELECT status, version FROM checkups WHERE id = ?')
            .get(REPLAY_CHECKUP_ID), { status: 'cancelled', version: 3 });
        assert.equal((check.prepare(`SELECT count(*) AS count FROM audit_events
            WHERE event_type = 'checkup.updated' AND subject_ref = ?`)
            .get(first.status === 'committed' ? first.receipt.resourceRefHash : '') as { count: number }).count, 1);
    } finally { check.close(); storage.dispose(); }
});

test('rolls back the checkup CAS when the atomic audit and receipt insert is unavailable', () => {
    currentScope = availableScope(ROLLBACK_CHECKUP_ID);
    const rollbackCandidate = createHeadlessCheckupStatusTransitionInternalCandidateV1(closed({
        now: () => clock,
        readHostScopeCandidate: () => currentScope,
    }));
    const checkupRef = rollbackCandidate.candidateController.issueSelectedCheckupRef();
    const preview = rollbackCandidate.service.preview(closed({ schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
        operationId: 'mediflow.patient.checkup.status.transition.v1', checkupRef,
        targetStatus: 'completed' as const, expectedRevision: 6 }));
    const proof = rollbackCandidate.candidateController.issueConfirmationProof(preview.proposalRef);
    const before = new Database(databasePath, { readonly: true });
    const auditCount = (before.prepare("SELECT count(*) AS count FROM audit_events WHERE event_id LIKE 'hcsa_%'")
        .get() as { count: number }).count;
    before.close();
    const sabotage = new Database(databasePath);
    sabotage.exec(`CREATE TRIGGER synthetic_checkup_audit_failure BEFORE INSERT ON audit_events
        WHEN NEW.event_id LIKE 'hcsa_%' BEGIN SELECT RAISE(ABORT, 'synthetic audit unavailable'); END`);
    sabotage.close();
    assert.throws(() => rollbackCandidate.service.confirm(preview.proposalRef, proof),
        (error: unknown) => (error as { code?: unknown }).code === 'audit_unavailable');
    const check = new Database(databasePath);
    try {
        assert.deepEqual(check.prepare('SELECT status, version FROM checkups WHERE id = ?')
            .get(ROLLBACK_CHECKUP_ID), { status: 'pending', version: 6 });
        assert.equal((check.prepare("SELECT count(*) AS count FROM audit_events WHERE event_id LIKE 'hcsa_%'")
            .get() as { count: number }).count, auditCount);
        check.exec('DROP TRIGGER synthetic_checkup_audit_failure');
    } finally { check.close(); rollbackCandidate.service.dispose(); }
});

test('allows at most one CAS winner across two independent internal candidates', () => {
    const sharedScope = availableScope(CONCURRENT_CHECKUP_ID);
    const first = createHeadlessCheckupStatusTransitionInternalCandidateV1({
        now: () => clock, readHostScopeCandidate: () => sharedScope,
    });
    const second = createHeadlessCheckupStatusTransitionInternalCandidateV1({
        now: () => clock, readHostScopeCandidate: () => sharedScope,
    });
    const prepare = (owner: typeof first) => {
        const checkupRef = owner.candidateController.issueSelectedCheckupRef();
        const preview = owner.service.preview(closed({
            schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
            operationId: 'mediflow.patient.checkup.status.transition.v1', checkupRef,
            targetStatus: 'completed' as const, expectedRevision: 1,
        }));
        return { preview, proof: owner.candidateController.issueConfirmationProof(preview.proposalRef) };
    };
    const firstCall = prepare(first), secondCall = prepare(second);
    const before = new Database(databasePath, { readonly: true });
    const auditCount = (before.prepare("SELECT count(*) AS count FROM audit_events WHERE event_id LIKE 'hcsa_%'")
        .get() as { count: number }).count;
    before.close();

    try {
        assert.equal(first.service.confirm(firstCall.preview.proposalRef, firstCall.proof).outcome,
            'status_transitioned');
        assert.throws(() => second.service.confirm(secondCall.preview.proposalRef, secondCall.proof),
            (error: unknown) => (error as { code?: unknown }).code === 'revision_conflict');
        const check = new Database(databasePath, { readonly: true });
        try {
            assert.deepEqual(check.prepare('SELECT status, version FROM checkups WHERE id = ?')
                .get(CONCURRENT_CHECKUP_ID), { status: 'completed', version: 2 });
            assert.equal((check.prepare("SELECT count(*) AS count FROM audit_events WHERE event_id LIKE 'hcsa_%'")
                .get() as { count: number }).count, auditCount + 1);
        } finally { check.close(); }
    } finally { first.service.dispose(); second.service.dispose(); }
});

test('rechecks injected candidate scope under the writer lock and keeps the selected checkup unchanged', () => {
    const selected = availableScope(SCOPE_CHECKUP_ID);
    const changed = closed({ ...selected, selectionEpoch: 12 });
    let reads = 0;
    const scopeCandidate = createHeadlessCheckupStatusTransitionInternalCandidateV1({
        now: () => clock,
        readHostScopeCandidate: () => { reads += 1; return reads < 4 ? selected : changed; },
    });
    const checkupRef = scopeCandidate.candidateController.issueSelectedCheckupRef();
    const preview = scopeCandidate.service.preview(closed({
        schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
        operationId: 'mediflow.patient.checkup.status.transition.v1', checkupRef,
        targetStatus: 'completed' as const, expectedRevision: 3,
    }));
    const proof = scopeCandidate.candidateController.issueConfirmationProof(preview.proposalRef);
    assert.throws(() => scopeCandidate.service.confirm(preview.proposalRef, proof),
        (error: unknown) => (error as { code?: unknown }).code === 'scope_changed');
    const check = new Database(databasePath, { readonly: true });
    try {
        assert.deepEqual(check.prepare('SELECT status, version FROM checkups WHERE id = ?')
            .get(SCOPE_CHECKUP_ID), { status: 'pending', version: 3 });
    } finally { check.close(); scopeCandidate.service.dispose(); }
});

test('keeps SQLite confined to the internal storage candidate with no MCP or route binding', () => {
    const storageSource = fs.readFileSync(new URL('./headless-checkup-status-transition-storage.ts', import.meta.url), 'utf8');
    const candidateSource = fs.readFileSync(new URL('./headless-checkup-status-transition-production.ts', import.meta.url), 'utf8');
    const coreSource = fs.readFileSync(new URL('../../packages/aip/src/checkup-status-transition.ts', import.meta.url), 'utf8');
    assert.match(storageSource, /from ['"]\.\.\/db-server['"]/u);
    assert.doesNotMatch(candidateSource, /dbServer|better-sqlite3|from ['"]\.\.\/schema['"]|\bMCP\b|NextRequest|NextResponse/u);
    assert.doesNotMatch(coreSource, /dbServer|better-sqlite3|from ['"].*schema['"]|\bMCP\b|NextRequest|NextResponse/u);
});
