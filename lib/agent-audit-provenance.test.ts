import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'mediflow-agent-audit-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dir;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
const { composeAll, seedComposition, compositionSnapshot, session, patientId } = await import('./test-fixtures/clinical-writer-composition.ts');
const { createEntryOperation } = await import('./entry-write-operation.ts');
const { bindSyntheticArchiveSessions } = await import('./security/web-auth-lifecycle-owner-test-fixture.ts');
const { listAuditEvents } = await import('./security/audit.ts');
const { readBackupAuditRows, canonicalizeBackupAuditRows } = await import('./backup-audit.ts');
const { createBackupArtifact, parseBackupArtifact, createEmptyDataset } = await import('./backup-artifact.ts');
seedComposition();
const before = compositionSnapshot();
const agentProvenance = { proposerRef: 'synthetic-agent', mandateRef: 'synthetic-mandate', modelProvider: 'openai' as const };

test.after(() => { dbServer.$client.close(); rmSync(dir, { recursive: true, force: true }); });

for (let index = 0; index < 8; index++) {
    test(`agent audit failure at position ${index} leaves zero writes and zero success audits`, () => {
        dbServer.$client.exec(`CREATE TRIGGER synthetic_agent_audit_fault BEFORE INSERT ON audit_events WHEN (SELECT count(*) FROM audit_events) = ${before.counts.audit_events + index} BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_AGENT_AUDIT_FAILURE'); END`);
        try { assert.throws(() => composeAll(`agent-audit-${index}`, { agentProvenance }), /SYNTHETIC_AGENT_AUDIT_FAILURE/); }
        finally { dbServer.$client.exec('DROP TRIGGER synthetic_agent_audit_fault'); }
        assert.deepEqual(compositionSnapshot(), before);
    });
}

test('invalid or incomplete agent provenance cannot produce a clinical write', () => {
    for (const invalid of [{ ...agentProvenance, proposerRef: '' }, { ...agentProvenance, mandateRef: '' }, { ...agentProvenance, modelProvider: 'unknown' }]) {
        assert.throws(() => composeAll('invalid-agent', { agentProvenance: invalid as typeof agentProvenance }), /Invalid agent audit provenance/);
        assert.deepEqual(compositionSnapshot(), before);
    }
});

test('missing and non-string provenance references roll back the clinical writes', () => {
    for (const invalid of [
        { proposerRef: undefined }, { proposerRef: null }, { mandateRef: undefined }, { mandateRef: null }, { mandateRef: 42 },
    ]) {
        const claimed = { ...agentProvenance, ...invalid } as typeof agentProvenance;
        assert.throws(() => composeAll('invalid-agent-reference', { agentProvenance: claimed }), /Invalid agent audit provenance/);
        assert.deepEqual(compositionSnapshot(), before);
    }
});

test('agent success requires user author and complete provenance on the agent surface', () => {
    const generation = bindSyntheticArchiveSessions('synthetic-agent-audit-negative');
    const base = { archiveGeneration: generation, actorType: 'user' as const, actorRef: session.userId,
        sourceSurface: 'agent' as const, agentProvenance, flags: [] };
    for (const audit of [{ ...base, actorType: 'system' as const }, { ...base, agentProvenance: undefined }, { ...base, sourceSurface: 'web' as const }]) {
        assert.throws(() => createEntryOperation({ patientId, id: 'invalid-agent-author',
            values: { id: 'invalid-agent-author', patientId, type: 'visit', title: 'ENC:synthetic:title',
                content: 'ENC:synthetic:note', date: new Date('2026-11-17') },
            mode: 'web', audit, changedFields: ['content'] }), /Invalid agent audit provenance|Agent audit requires agent surface/);
        assert.deepEqual(compositionSnapshot(), before);
    }
});

test('every writer preserves confirming author, agent, mandate and provider in the same transaction', async () => {
    composeAll('agent-positive', { agentProvenance });
    const rows = dbServer.$client.prepare("SELECT * FROM audit_events WHERE outcome='success' AND subject_type!='settings'").all() as Record<string, unknown>[];
    const clinical = rows.filter(row => row.actor_ref === session.userId);
    assert.equal(clinical.length, 8);
    for (const row of clinical) {
        assert.equal(row.actor_type, 'user');
        assert.equal(row.source_surface, 'agent');
        assert.equal(row.proposer_ref, agentProvenance.proposerRef);
        assert.equal(row.mandate_ref, agentProvenance.mandateRef);
        assert.equal(row.model_provider, agentProvenance.modelProvider);
    }
    const listed = (await listAuditEvents({ actorRef: session.userId })).filter(row => row.sourceSurface === 'agent');
    assert.equal(listed.length, 8);
    assert.ok(listed.every(row => row.actorRef === session.userId && row.proposerRef === agentProvenance.proposerRef
        && row.mandateRef === agentProvenance.mandateRef && row.modelProvider === 'openai'));
    assert.deepEqual(dbServer.$client.prepare('SELECT recorded_by FROM entries').all(), [{ recorded_by: 'Medico Sintetico' }, { recorded_by: 'Medico Sintetico' }]);
    const history = readBackupAuditRows(dbServer.$client);
    const artifact = await createBackupArtifact({ ...createEmptyDataset(), auditEvents: history });
    const recovered = await parseBackupArtifact(artifact);
    assert.deepEqual(recovered.payload.auditEvents, history);
    const broken = { ...history.find(row => row.sourceSurface === 'agent')!, mandateRef: null };
    assert.throws(() => canonicalizeBackupAuditRows([broken]), /provenance/);
});
