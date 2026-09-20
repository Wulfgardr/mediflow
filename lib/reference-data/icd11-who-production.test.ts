/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';
import { WHO_LOCAL_BINDING_ID, type WhoLocalReceipt } from './icd11-who-local-contract.ts';

// Bootstrap only this marked synthetic database, before importing db-server:
// an existing empty DB prevents its legacy source-database copy path.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-who-local-audit-test-'));
fs.writeFileSync(path.join(dataDir, 'SYNTHETIC_ONLY'), 'WHO local sidecar: synthetic audit receipts only.\n');
process.env.MEDIFLOW_DATA_DIR = dataDir;
const databasePath = path.join(dataDir, 'medical.db');
const bootstrap = new Database(databasePath);
try {
    for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) {
        bootstrap.exec(fs.readFileSync(path.join('drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
    }
} finally { bootstrap.close(); }
const { writeWhoLocalReceiptAudit, writeWhoCodeCheckAudit } = await import('./icd11-who-production.ts');
const { listAuditEvents } = await import('../security/audit.ts');
const { dbServer } = await import('../db-server.ts');
after(() => { dbServer.$client.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function receipt(source: 'live' | 'cache', resultCount: number): WhoLocalReceipt {
    return {
        schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v2',
        operation: 'mediflow.reference_data.icd11.search.v2',
        releaseId: '2026-01', language: 'en', deployment: 'local', bindingId: WHO_LOCAL_BINDING_ID,
        imageDigest: `sha256:${'0123456789abcdef'.repeat(4)}`,
        datasetSnapshotId: `sha256:${'fedcba9876543210'.repeat(4)}`,
        source, resultCount, latencyMs: 42,
        fetchedAt: '2026-09-06T01:00:00.001Z', expiresAt: '2026-09-07T01:00:00.001Z',
        completedAt: source === 'live' ? '2026-09-06T01:00:00.043Z' : '2026-09-06T02:00:00.123Z',
    };
}

for (const [source, count] of [['live', 25], ['cache', 0]] as const) {
    test(`production audit persists complete redacted ${source} provenance through sanitizer and SQLite reread`, async () => {
        const input = receipt(source, count);
        const eventId = await writeWhoLocalReceiptAudit(input);
        const audit = (await listAuditEvents({ eventType: 'reference_data.icd11.search' })).find(row => row.eventId === eventId);
        assert.ok(audit);
        assert.equal(audit.subjectRef, null);
        assert.equal(audit.actorRef, 'icd11-who-owner');
        assert.equal(audit.outcome, 'success');
        const metadata = audit.redactedMetadata!;
        assert.deepEqual(Object.keys(metadata).sort(), ['counts', 'flags']);
        assert.equal(metadata.counts, count);
        const flags = Object.fromEntries(metadata.flags!.map(flag => {
            assert.ok(flag.length <= 80);
            const separator = flag.indexOf(':');
            return [flag.slice(0, separator), flag.slice(separator + 1)];
        }));
        assert.deepEqual(flags, {
            schema: input.schemaVersion, operation: input.operation, deployment: input.deployment,
            source, release: input.releaseId, language: input.language, binding: input.bindingId,
            image: input.imageDigest, dataset: input.datasetSnapshotId, latencyMs: String(input.latencyMs),
            fetchedAt: input.fetchedAt, expiresAt: input.expiresAt, completedAt: input.completedAt,
        });
        const sqlite = new Database(databasePath, { readonly: true });
        try {
            const stored = sqlite.prepare('SELECT redacted_metadata AS metadata FROM audit_events WHERE event_id = ?')
                .get(eventId) as { metadata: string };
            assert.deepEqual(JSON.parse(stored.metadata), metadata);
        } finally { sqlite.close(); }
    });
}

test('production audit rejects extra data and invalid provenance before writing', async () => {
    const baseline = await listAuditEvents({ eventType: 'reference_data.icd11.search' });
    const valid = receipt('live', 1);
    const invalid = [
        { ...valid, query: 'synthetic forbidden query' },
        { ...valid, code: 'TEST-A' }, { ...valid, description: 'Synthetic forbidden title' },
        { ...valid, canonicalUri: 'synthetic forbidden URI' },
        { ...valid, bindingId: 'synthetic invalid binding' },
        { ...valid, imageDigest: 'synthetic invalid image' },
        { ...valid, datasetSnapshotId: 'synthetic invalid dataset' },
        { ...valid, completedAt: 'synthetic invalid time' },
        { ...valid, latencyMs: -1 }, { ...valid, resultCount: -1 },
        { ...valid, resultCount: 26 }, { ...valid, resultCount: 1.5 },
    ];
    for (const input of invalid) {
        await assert.rejects(writeWhoLocalReceiptAudit(input as WhoLocalReceipt), /^Error: Invalid WHO local audit receipt$/u);
    }
    assert.deepEqual(await listAuditEvents({ eventType: 'reference_data.icd11.search' }), baseline);
});

test('code-check audit persists only provenance and outcome, never code or title', async () => {
    const input = {
        schemaVersion: 'mediflow.reference-data.icd11-code-check-receipt.v1' as const,
        operation: 'mediflow.reference_data.icd11.code_check.v1' as const,
        releaseId: '2026-01' as const, language: 'en' as const, bindingId: WHO_LOCAL_BINDING_ID,
        imageDigest: `sha256:${'a'.repeat(64)}`, datasetSnapshotId: `sha256:${'b'.repeat(64)}`,
        source: 'live' as const, found: true, checkedAt: '2026-09-07T12:00:00.000Z', latencyMs: 24,
    };
    const id = await writeWhoCodeCheckAudit(input);
    const events = await listAuditEvents({ eventType: 'reference_data.icd11.code_check' });
    const saved = events.find(event => event.eventId === id);
    assert.ok(saved);
    assert.equal(saved.redactedMetadata?.counts, 1);
    assert.ok(saved.redactedMetadata?.flags?.includes(`image:${input.imageDigest}`));
    assert.ok(saved.redactedMetadata?.flags?.includes(`dataset:${input.datasetSnapshotId}`));
    assert.equal(saved.subjectRef, null);
    await assert.rejects(writeWhoCodeCheckAudit({ ...input, code: 'AA00' } as typeof input));
    assert.deepEqual(await listAuditEvents({ eventType: 'reference_data.icd11.code_check' }), events);
});
