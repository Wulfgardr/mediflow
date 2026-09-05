/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import Database from 'better-sqlite3';

import { HeadlessSoapEntryCommitOwnerError } from './headless-soap-entry-commit-application-service.ts';
import type { HeadlessSoapBoundCommandV1 } from './headless-soap-command-binding-lifecycle.ts';
import {
    commandBindingFixture,
    syntheticBinding,
    syntheticProof,
    syntheticRecord,
} from './headless-soap-command-binding-test-fixture.ts';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-h7b-owner-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});
const ownerModule = await import('./headless-soap-entry-commit-owner.ts');
const { createHeadlessSoapEntryCommitOwner } = ownerModule;

const PATIENT_ID = 'synthetic-patient-h7b';
const AMBULATORY_ID = 'synthetic-ambulatory-h7b';
const PATIENT_VERSION = 7;

function database(): Database.Database { return new Database(path.join(dataDir, 'medical.db')); }

{
    const db = database();
    try {
        db.pragma('foreign_keys = ON');
        db.prepare('INSERT INTO ambulatories (id, name, type, version) VALUES (?, ?, ?, 1)')
            .run(AMBULATORY_ID, 'Ambulatorio sintetico H7b', 'test');
        db.prepare(`INSERT INTO patients
            (id, first_name, last_name, tax_code, ambulatory_id, is_archived, version)
            VALUES (?, ?, ?, ?, ?, 0, ?)`)
            .run(PATIENT_ID, 'Paziente', 'Sintetico', 'SYNTHETICH7B0001', AMBULATORY_ID, PATIENT_VERSION);
        db.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)')
            .run(PATIENT_ID, AMBULATORY_ID);
    } finally { db.close(); }
}

after(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

async function command(entropyByte: number, source = syntheticBinding(PATIENT_VERSION)):
Promise<HeadlessSoapBoundCommandV1> {
    const fixture = commandBindingFixture(entropyByte);
    fixture.setCurrent(source);
    const proof = syntheticProof(entropyByte);
    const bound = await fixture.owner.service.bind(proof);
    let captured: HeadlessSoapBoundCommandV1 | null = null;
    const accepted = await fixture.owner.approvalController.withSingleUseApproval(syntheticRecord({
        approvalRef: bound.approvalRef,
        idempotencyKey: bound.idempotencyKey,
        authorizationProof: proof,
    }), (candidate) => { captured = candidate; });
    assert.equal(accepted, true);
    assert.ok(captured);
    return captured;
}

function binding(patientVersion = PATIENT_VERSION) {
    return syntheticRecord({ patientId: PATIENT_ID, ambulatoryId: AMBULATORY_ID, patientVersion });
}

function replayKey(value: HeadlessSoapBoundCommandV1) {
    return syntheticRecord({
        approvalRef: value.approvalRef,
        idempotencyKey: value.idempotencyKey,
        authorizationProofDigest: value.authorizationProofDigest,
    });
}

function domainHash(domain: string, value: string): string {
    return createHash('sha256').update(domain, 'utf8').update('\0', 'utf8').update(value, 'utf8').digest('hex');
}

function deterministicIds(value: HeadlessSoapBoundCommandV1) {
    return {
        entryId: `hsei_${domainHash('mediflow.headless.soap-entry-id.v1', value.commandId)}`,
        auditEventId: `hsea_${domainHash('mediflow.headless.soap-entry-audit-id.v1', value.commandId)}`,
        receiptRef: `hser_${domainHash('mediflow.headless.soap-entry-receipt-ref.v1', value.commandId)}`,
    };
}

test('commits entry, PHI-safe audit, ledger and canonical receipt atomically, then replays across owner restart', async () => {
    const bound = await command(0x61);
    const owner = createHeadlessSoapEntryCommitOwner();
    const committed = owner.commit(bound, binding());
    assert.equal(committed.status, 'committed', JSON.stringify(committed));
    if (committed.status !== 'committed') throw new Error('expected committed result');

    const receipt = committed.receipt;
    assert.equal(Object.getPrototypeOf(receipt), null);
    assert.equal(Object.isFrozen(receipt), true);
    assert.deepEqual(Reflect.ownKeys(receipt), [
        'schema', 'receiptRef', 'operationId', 'outcome', 'commandId', 'entryRef', 'auditEventRef',
        'patientVersion', 'entryVersion', 'committedAt', 'bindingDigest', 'entryDigest', 'auditDigest',
    ]);
    assert.equal(receipt.schema, 'mediflow.headless.soap-entry-commit-receipt.v1');
    assert.equal(receipt.commandId, bound.commandId);
    assert.equal(receipt.patientVersion, PATIENT_VERSION);
    assert.equal(receipt.entryVersion, 1);
    assert.match(receipt.receiptRef, /^hser_[0-9a-f]{64}$/);
    assert.match(receipt.entryRef, /^hsei_[0-9a-f]{64}$/);
    assert.match(receipt.auditEventRef, /^hsea_[0-9a-f]{64}$/);
    assert.match(receipt.committedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);

    const db = database();
    try {
        const entry = db.prepare(`SELECT id, patient_id AS patientId, type, title, date, content, setting, metadata,
            attachments, deleted_at AS deletedAt, deletion_reason AS deletionReason, version, created_at AS createdAt,
            updated_at AS updatedAt FROM entries WHERE id = ?`).get(receipt.entryRef) as Record<string, unknown>;
        assert.deepEqual(entry, {
            id: receipt.entryRef,
            patientId: PATIENT_ID,
            type: 'visit',
            title: bound.sealBundle.title,
            date: Date.parse(bound.sealBundle.date) / 1000,
            content: bound.sealBundle.content,
            setting: 'ambulatory',
            metadata: bound.sealBundle.metadata,
            attachments: null,
            deletedAt: null,
            deletionReason: null,
            version: 1,
            createdAt: Date.parse(receipt.committedAt) / 1000,
            updatedAt: Date.parse(receipt.committedAt) / 1000,
        });
        const audit = db.prepare(`SELECT event_type AS eventType, outcome, actor_type AS actorType, actor_ref AS actorRef,
            subject_type AS subjectType, subject_ref AS subjectRef, source_surface AS sourceSurface,
            request_id AS requestId, redacted_metadata AS redactedMetadata FROM audit_events WHERE event_id = ?`)
            .get(receipt.auditEventRef) as Record<string, unknown>;
        assert.deepEqual({ ...audit, actorRef: String(audit.actorRef).replace(/[0-9a-f]{64}$/u, '<digest>') }, {
            eventType: 'entry.created', outcome: 'success', actorType: 'user', actorRef: 'hsa_<digest>',
            subjectType: 'entry', subjectRef: receipt.entryRef, sourceSurface: 'web', requestId: null,
            redactedMetadata: JSON.stringify({
                schema: 'mediflow.headless.soap-entry-commit-audit-metadata.v1',
                operationId: 'mediflow.clinical_diary.append_soap.v1',
                commandRef: bound.commandId,
                bindingDigest: receipt.bindingDigest,
                entryDigest: receipt.entryDigest,
            }),
        });
        const ledger = db.prepare('SELECT * FROM headless_soap_entry_commits WHERE idempotency_key = ?')
            .get(bound.idempotencyKey) as Record<string, unknown>;
        assert.equal(ledger.receipt_snapshot, JSON.stringify(receipt));
        const durableText = JSON.stringify(ledger);
        assert.doesNotMatch(durableText, /hsap_/);
        assert.equal(durableText.includes(PATIENT_ID), false);
        assert.equal(durableText.includes(AMBULATORY_ID), false);
        assert.equal(durableText.includes(bound.sealBundle.content), false);
    } finally { db.close(); }

    assert.deepEqual(owner.lookup(replayKey(bound)), syntheticRecord({ status: 'exact', receipt }));
    assert.deepEqual(createHeadlessSoapEntryCommitOwner().lookup(replayKey(bound)),
        syntheticRecord({ status: 'exact', receipt }));
    assert.deepEqual(owner.commit(bound, binding()), syntheticRecord({ status: 'committed', receipt }));
});

test('denies stale patient CAS without partial entry, audit or ledger', async () => {
    const bound = await command(0x62);
    const owner = createHeadlessSoapEntryCommitOwner();
    const before = database();
    const countsBefore = {
        entries: (before.prepare('SELECT count(*) AS count FROM entries').get() as { count: number }).count,
        audits: (before.prepare('SELECT count(*) AS count FROM audit_events').get() as { count: number }).count,
        ledger: (before.prepare('SELECT count(*) AS count FROM headless_soap_entry_commits').get() as { count: number }).count,
    };
    before.close();
    assert.deepEqual(owner.commit(bound, binding(PATIENT_VERSION - 1)),
        syntheticRecord({ status: 'denied', code: 'binding_unavailable' }));
    const db = database();
    try {
        assert.deepEqual({
            entries: (db.prepare('SELECT count(*) AS count FROM entries').get() as { count: number }).count,
            audits: (db.prepare('SELECT count(*) AS count FROM audit_events').get() as { count: number }).count,
            ledger: (db.prepare('SELECT count(*) AS count FROM headless_soap_entry_commits').get() as { count: number }).count,
        }, countsBefore);
    } finally { db.close(); }
});

test('rejects a selection expiry not inherited from Web without partial durable state', async () => {
    const bound = await command(0x6b, syntheticBinding(PATIENT_VERSION, 99_999));
    const ids = deterministicIds(bound);
    assert.deepEqual(createHeadlessSoapEntryCommitOwner().commit(bound, binding()),
        syntheticRecord({ status: 'denied', code: 'receipt_unavailable' }));
    const db = database();
    try {
        assert.deepEqual({
            entry: (db.prepare('SELECT count(*) AS count FROM entries WHERE id = ?').get(ids.entryId) as { count: number }).count,
            audit: (db.prepare('SELECT count(*) AS count FROM audit_events WHERE event_id = ?').get(ids.auditEventId) as { count: number }).count,
            ledger: (db.prepare('SELECT count(*) AS count FROM headless_soap_entry_commits WHERE idempotency_key = ?')
                .get(bound.idempotencyKey) as { count: number }).count,
        }, { entry: 0, audit: 0, ledger: 0 });
    } finally { db.close(); }
});

/* @Codex Orphan identifiers conflict pre-ledger; a colliding durable row is receipt corruption. */
test('classifies orphan and durable deterministic identifier collisions before the first write', async () => {
    const owner = createHeadlessSoapEntryCommitOwner();

    const entryCommand = await command(0x65);
    const entrySeed = owner.commit(entryCommand, binding());
    assert.equal(entrySeed.status, 'committed', JSON.stringify(entrySeed));
    if (entrySeed.status !== 'committed') throw new Error('expected committed entry seed');
    let db = database();
    try {
        db.prepare('DELETE FROM headless_soap_entry_commits WHERE idempotency_key = ?')
            .run(entryCommand.idempotencyKey);
    } finally { db.close(); }
    assert.deepEqual(owner.commit(entryCommand, binding()),
        syntheticRecord({ status: 'denied', code: 'idempotency_conflict' }));

    const auditCommand = await command(0x66);
    const auditIds = deterministicIds(auditCommand);
    db = database();
    try {
        db.prepare(`INSERT INTO audit_events (event_id, schema_version, event_type, occurred_at, outcome,
            actor_type, actor_ref, subject_type, subject_ref, source_surface, request_id, redacted_metadata, created_at)
            VALUES (?, 1, 'synthetic.collision', 1, 'success', 'system', 'synthetic', 'entry', 'synthetic',
                'web', NULL, '{}', 1)`).run(auditIds.auditEventId);
    } finally { db.close(); }
    assert.deepEqual(owner.commit(auditCommand, binding()),
        syntheticRecord({ status: 'denied', code: 'idempotency_conflict' }));

    const seedCommand = await command(0x67);
    const seed = owner.commit(seedCommand, binding());
    assert.equal(seed.status, 'committed', JSON.stringify(seed));
    if (seed.status !== 'committed') throw new Error('expected committed seed');
    const receiptCommand = await command(0x68);
    const receiptIds = deterministicIds(receiptCommand);
    db = database();
    try {
        db.prepare('UPDATE headless_soap_entry_commits SET receipt_ref = ? WHERE idempotency_key = ?')
            .run(receiptIds.receiptRef, seedCommand.idempotencyKey);
    } finally { db.close(); }
    try {
        assert.deepEqual(owner.commit(receiptCommand, binding()),
            syntheticRecord({ status: 'denied', code: 'receipt_unavailable' }));
    } finally {
        db = database();
        try {
            db.prepare('UPDATE headless_soap_entry_commits SET receipt_ref = ? WHERE idempotency_key = ?')
                .run(seed.receipt.receiptRef, seedCommand.idempotencyKey);
        } finally { db.close(); }
    }

    const commandIdCommand = await command(0x69);
    db = database();
    try {
        db.prepare('UPDATE headless_soap_entry_commits SET command_id = ? WHERE idempotency_key = ?')
            .run(commandIdCommand.commandId, seedCommand.idempotencyKey);
    } finally { db.close(); }
    try {
        assert.deepEqual(owner.commit(commandIdCommand, binding()),
            syntheticRecord({ status: 'denied', code: 'receipt_unavailable' }));
    } finally {
        db = database();
        try {
            db.prepare('UPDATE headless_soap_entry_commits SET command_id = ? WHERE idempotency_key = ?')
                .run(seedCommand.commandId, seedCommand.idempotencyKey);
        } finally { db.close(); }
    }

    const corruptKeyCommand = await command(0x6a);
    db = database();
    try {
        db.prepare(`UPDATE headless_soap_entry_commits SET idempotency_key = 'corrupt', command_id = ?
            WHERE idempotency_key = ?`).run(corruptKeyCommand.commandId, seedCommand.idempotencyKey);
    } finally { db.close(); }
    try {
        assert.deepEqual(owner.commit(corruptKeyCommand, binding()),
            syntheticRecord({ status: 'denied', code: 'receipt_unavailable' }));
    } finally {
        db = database();
        try {
            db.prepare(`UPDATE headless_soap_entry_commits SET idempotency_key = ?, command_id = ?
                WHERE idempotency_key = 'corrupt'`).run(seedCommand.idempotencyKey, seedCommand.commandId);
        } finally { db.close(); }
    }
});

test('classifies replay conflict before authority and rejects a tampered durable chain', async () => {
    const bound = await command(0x63);
    const owner = createHeadlessSoapEntryCommitOwner();
    const committed = owner.commit(bound, binding());
    assert.equal(committed.status, 'committed', JSON.stringify(committed));
    if (committed.status !== 'committed') throw new Error('expected committed result');
    assert.deepEqual(owner.lookup(syntheticRecord({ ...replayKey(bound), approvalRef: `hsaa_${'f'.repeat(64)}` })),
        syntheticRecord({ status: 'conflict' }));

    const db = database();
    try { db.prepare('UPDATE entries SET title = ? WHERE id = ?').run('ENC:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==', committed.receipt.entryRef); }
    finally { db.close(); }
    assert.throws(() => owner.lookup(replayKey(bound)),
        (error) => error instanceof HeadlessSoapEntryCommitOwnerError && error.code === 'receipt_unavailable');
});

/* @Codex A field-exact digest chain is not a valid replay unless its H6/H4 semantics remain intact. */
test('rejects a digest-consistent replay forged across binding, entry and audit semantics', async () => {
    const bound = await command(0x64);
    const owner = createHeadlessSoapEntryCommitOwner();
    const hash = (domain: string, value: string) => createHash('sha256')
        .update(domain, 'utf8').update('\0', 'utf8').update(value, 'utf8').digest('hex');
    const entryId = `hsei_${hash('mediflow.headless.soap-entry-id.v1', bound.commandId)}`;
    const auditEventId = `hsea_${hash('mediflow.headless.soap-entry-audit-id.v1', bound.commandId)}`;
    const receiptRef = `hser_${hash('mediflow.headless.soap-entry-receipt-ref.v1', bound.commandId)}`;
    const committedAt = Date.parse(bound.sealBundle.date) / 1000;
    const lineage = bound.lineage;
    const patientIdDigest = hash('mediflow.headless.soap-entry-commit-patient-id-digest.v1', PATIENT_ID);
    const db = database();
    try {
        const forgedBinding = JSON.stringify({
            schema: 'mediflow.headless.soap-entry-commit-binding.forged',
            operationId: 'mediflow.clinical_diary.forged.v1',
            commandId: bound.commandId,
            approvalRef: bound.approvalRef,
            idempotencyKey: bound.idempotencyKey,
            authorizationProofDigest: bound.authorizationProofDigest,
            webSessionId: lineage.webSession.id,
            webSessionCreatedAt: lineage.webSession.createdAt,
            webSessionExpiresAt: lineage.webSession.expiresAt,
            principalRef: lineage.activeRole.principalRef,
            actorRef: lineage.activeRole.actorRef,
            attestationRef: lineage.activeRole.attestationRef,
            attestationVersion: lineage.activeRole.attestationVersion,
            activeRoleRevocationGeneration: lineage.activeRole.revocationGeneration,
            activeRolePolicyVersion: lineage.activeRole.policyVersion,
            parentContractVersion: lineage.childLease.parent.contractVersion,
            parentGeneration: lineage.childLease.parent.generation,
            parentRevocationGeneration: lineage.childLease.parent.revocationGeneration,
            childContractVersion: lineage.childLease.child.contractVersion,
            childGeneration: lineage.childLease.child.generation,
            childRevocationGeneration: lineage.childLease.child.revocationGeneration,
            childExpiresAt: lineage.childLease.child.expiresAt,
            leaseContractVersion: lineage.childLease.lease.contractVersion,
            leaseGeneration: lineage.childLease.lease.generation,
            leaseRevocationGeneration: lineage.childLease.lease.revocationGeneration,
            sessionRef: lineage.selection.sessionRef,
            patientRef: lineage.selection.patientRef,
            ambulatoryRef: lineage.selection.ambulatoryRef,
            leaseRef: lineage.selection.leaseRef,
            selectionEpoch: lineage.selection.selectionEpoch,
            selectionExpiresAt: lineage.selection.expiresAt,
            patientVersion: lineage.patientVersion,
            action: 'overwrite',
            purpose: 'caller_supplied',
            proposalRevision: lineage.proposal.revision,
            proposalExpiresAt: lineage.proposal.expiresAt,
            payloadDigest: 'b'.repeat(64),
            sealDigest: 'c'.repeat(64),
            policyDigest: lineage.policyDigest.sha256.hex,
            patientIdDigest,
            ambulatoryIdDigest: hash(
                'mediflow.headless.soap-entry-commit-ambulatory-id-digest.v1',
                AMBULATORY_ID,
            ),
        });
        const bindingDigest = hash('mediflow.headless.soap-entry-commit-binding-digest.v1', forgedBinding);
        db.prepare(`INSERT INTO entries (id, patient_id, type, title, date, content, setting, metadata, attachments,
            deleted_at, deletion_reason, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
            .run(entryId, PATIENT_ID, 'forged', 'SOAP plaintext forged', committedAt,
                `<p>S: ${PATIENT_ID}</p>`, 'caller', JSON.stringify({ patientId: PATIENT_ID }),
                '[]', committedAt, 'forged', committedAt, committedAt);
        const forgedEntrySnapshot = JSON.stringify({
            schema: 'mediflow.headless.soap-entry-record.v1',
            entryId,
            patientIdDigest,
            type: 'forged',
            title: 'SOAP plaintext forged',
            date: committedAt,
            content: `<p>S: ${PATIENT_ID}</p>`,
            setting: 'caller',
            metadata: JSON.stringify({ patientId: PATIENT_ID }),
            attachments: '[]',
            deletedAt: committedAt,
            deletionReason: 'forged',
            version: 1,
            createdAt: committedAt,
            updatedAt: committedAt,
        });
        const entryDigest = hash('mediflow.headless.soap-entry-commit-entry-digest.v1', forgedEntrySnapshot);
        const audit = {
            eventId: auditEventId,
            schemaVersion: 1,
            eventType: 'entry.created',
            occurredAt: committedAt,
            outcome: 'success',
            actorType: 'user',
            actorRef: 'raw.actor@example.invalid',
            subjectType: 'entry',
            subjectRef: entryId,
            sourceSurface: 'web',
            requestId: null,
            redactedMetadata: JSON.stringify({
                schema: 'mediflow.headless.soap-entry-commit-audit-metadata.v1',
                operationId: 'mediflow.clinical_diary.append_soap.v1',
                commandRef: bound.commandId,
                bindingDigest,
                entryDigest,
                soap: '<p>S: plaintext forged</p>',
                patientId: PATIENT_ID,
            }),
            createdAt: committedAt,
        };
        const auditSnapshot = JSON.stringify(audit);
        const auditDigest = hash('mediflow.headless.soap-entry-commit-audit-digest.v1', auditSnapshot);
        const receiptSnapshot = JSON.stringify({
            schema: 'mediflow.headless.soap-entry-commit-receipt.v1',
            receiptRef,
            operationId: 'mediflow.clinical_diary.append_soap.v1',
            outcome: 'entry_committed',
            commandId: bound.commandId,
            entryRef: entryId,
            auditEventRef: auditEventId,
            patientVersion: PATIENT_VERSION,
            entryVersion: 1,
            committedAt: new Date(committedAt * 1000).toISOString(),
            bindingDigest,
            entryDigest,
            auditDigest,
        });
        const receiptDigest = hash('mediflow.headless.soap-entry-commit-receipt-digest.v1', receiptSnapshot);
        db.prepare(`INSERT INTO audit_events (event_id, schema_version, event_type, occurred_at, outcome, actor_type,
            actor_ref, subject_type, subject_ref, source_surface, request_id, redacted_metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(...Object.values(audit));
        db.prepare(`INSERT INTO headless_soap_entry_commits (idempotency_key, approval_ref,
            authorization_proof_digest, command_id, entry_id, audit_event_id, receipt_ref, binding_snapshot,
            binding_digest, entry_digest, audit_snapshot, audit_digest, receipt_snapshot, receipt_digest, committed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(bound.idempotencyKey, bound.approvalRef, bound.authorizationProofDigest, bound.commandId,
                entryId, auditEventId, receiptRef, forgedBinding, bindingDigest, entryDigest,
                auditSnapshot, auditDigest, receiptSnapshot, receiptDigest, committedAt);
    } finally { db.close(); }

    assert.throws(() => owner.lookup(replayKey(bound)),
        (error) => error instanceof HeadlessSoapEntryCommitOwnerError && error.code === 'receipt_unavailable');
});
