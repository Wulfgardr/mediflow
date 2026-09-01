/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-checkup-status-production-'));
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
bootstrap.close();

const { createHeadlessCheckupStatusTransitionProductionV1 } =
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

const production = createHeadlessCheckupStatusTransitionProductionV1({
    now: () => clock,
    readBrokerScope: () => currentScope,
});

after(() => {
    production.service.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('couples current scope, status CAS, audit and PHI-safe receipt in one synthetic SQLite commit', () => {
    const checkupRef = production.trustedController.issueSelectedCheckupRef();
    assert.match(checkupRef, /^hcsr_[0-9a-f]{64}$/u);
    const input = closed({
        schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
        operationId: 'mediflow.patient.checkup.status.transition.v1',
        checkupRef,
        targetStatus: 'completed' as const,
        expectedRevision: INITIAL_REVISION,
    });
    const preview = production.service.preview(input);
    assert.deepEqual(Reflect.ownKeys(preview), [
        'schemaVersion', 'operationId', 'outcome', 'proposalRef', 'expiresAt',
    ]);
    clock += 1_000;
    const proof = production.trustedController.issueConfirmationProof(preview.proposalRef);
    const confirmedAt = clock;
    clock += 250;
    const receipt = production.service.confirm(preview.proposalRef, proof);

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
        proofRefHash: `sha256:${'b'.repeat(64)}`,
        confirmedAt: clock,
    });
}

test('replays the same storage command exactly once and denies a different digest on the same key', () => {
    currentScope = availableScope(REPLAY_CHECKUP_ID);
    const storage = createHeadlessCheckupStatusTransitionStorageV1(closed({
        readBrokerScope: () => currentScope,
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
    const storage = createHeadlessCheckupStatusTransitionStorageV1(closed({
        readBrokerScope: () => currentScope,
    }));
    const checkupRef = storage.issueSelectedCheckupRef();
    const input = closed({ schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
        operationId: 'mediflow.patient.checkup.status.transition.v1', checkupRef,
        targetStatus: 'completed' as const, expectedRevision: 6 });
    const snapshot = storage.readSnapshot(input) as Record<string, unknown>;
    const command = storageCommand(storage, checkupRef, snapshot, 'completed', 6, 'c');
    const sabotage = new Database(databasePath);
    sabotage.exec(`CREATE TRIGGER synthetic_checkup_audit_failure BEFORE INSERT ON audit_events
        WHEN NEW.event_id LIKE 'hcsa_%' BEGIN SELECT RAISE(ABORT, 'synthetic audit unavailable'); END`);
    sabotage.close();
    assert.deepEqual(storage.commit(command), closed({ status: 'denied', code: 'audit_unavailable' }));
    const check = new Database(databasePath);
    try {
        assert.deepEqual(check.prepare('SELECT status, version FROM checkups WHERE id = ?')
            .get(ROLLBACK_CHECKUP_ID), { status: 'pending', version: 6 });
        assert.equal((check.prepare("SELECT count(*) AS count FROM audit_events WHERE event_id LIKE 'hcsa_%'")
            .get() as { count: number }).count, 2);
        check.exec('DROP TRIGGER synthetic_checkup_audit_failure');
    } finally { check.close(); storage.dispose(); }
});

test('rechecks broker currentness under the writer lock and keeps the selected checkup unchanged', () => {
    const selected = availableScope(SCOPE_CHECKUP_ID);
    const changed = closed({ ...selected, selectionEpoch: 12 });
    let reads = 0;
    const scopedProduction = createHeadlessCheckupStatusTransitionProductionV1({
        now: () => clock,
        readBrokerScope: () => { reads += 1; return reads < 4 ? selected : changed; },
    });
    const checkupRef = scopedProduction.trustedController.issueSelectedCheckupRef();
    const preview = scopedProduction.service.preview(closed({
        schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1',
        operationId: 'mediflow.patient.checkup.status.transition.v1', checkupRef,
        targetStatus: 'completed' as const, expectedRevision: 3,
    }));
    const proof = scopedProduction.trustedController.issueConfirmationProof(preview.proposalRef);
    assert.throws(() => scopedProduction.service.confirm(preview.proposalRef, proof),
        (error: unknown) => (error as { code?: unknown }).code === 'scope_changed');
    const check = new Database(databasePath, { readonly: true });
    try {
        assert.deepEqual(check.prepare('SELECT status, version FROM checkups WHERE id = ?')
            .get(SCOPE_CHECKUP_ID), { status: 'pending', version: 3 });
    } finally { check.close(); scopedProduction.service.dispose(); }
});

test('keeps SQLite confined to the host storage owner with no MCP or route binding in AG-W2', () => {
    const storageSource = fs.readFileSync(new URL('./headless-checkup-status-transition-storage.ts', import.meta.url), 'utf8');
    const productionSource = fs.readFileSync(new URL('./headless-checkup-status-transition-production.ts', import.meta.url), 'utf8');
    const coreSource = fs.readFileSync(new URL('../../packages/aip/src/checkup-status-transition.ts', import.meta.url), 'utf8');
    assert.match(storageSource, /from ['"]\.\.\/db-server['"]/u);
    assert.doesNotMatch(productionSource, /dbServer|better-sqlite3|from ['"]\.\.\/schema['"]|\bMCP\b|NextRequest|NextResponse/u);
    assert.doesNotMatch(coreSource, /dbServer|better-sqlite3|from ['"].*schema['"]|\bMCP\b|NextRequest|NextResponse/u);
});
