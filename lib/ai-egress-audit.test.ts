/* @Codex */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { appendChatGptEgressAudit, evaluateAndAuditEgress, getEgressGateAuditPath } from './ai-egress-audit';

test('appends a local hash-only egress audit record', () => {
    const previousDataDir = process.env.MEDIFLOW_DATA_DIR;
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-egress-audit-'));
    process.env.MEDIFLOW_DATA_DIR = dataDir;
    const text = 'Mario Rossi mario@example.it';

    try {
        const result = evaluateAndAuditEgress({
            text,
            lane: 'clinical',
            knownIdentifiers: { names: ['Mario Rossi'] },
        });
        const audit = readFileSync(getEgressGateAuditPath(), 'utf8');

        assert.equal(result.status, 'closed_pending_redaction_lane');
        assert.doesNotMatch(audit, /Mario Rossi|mario@example\.it/);
        assert.match(audit, /"payloadSha256":"[a-f0-9]{64}"/);
        assert.match(audit, /"lane":"clinical"/);
    } finally {
        if (previousDataDir === undefined) delete process.env.MEDIFLOW_DATA_DIR;
        else process.env.MEDIFLOW_DATA_DIR = previousDataDir;
        rmSync(dataDir, { recursive: true, force: true });
    }
});

test('named remote audit hashes exact wire bytes and records only closed metadata', () => {
    const previous = process.env.MEDIFLOW_DATA_DIR;
    const root = mkdtempSync(path.join(os.tmpdir(), 'mediflow-chatgpt-audit-'));
    process.env.MEDIFLOW_DATA_DIR = root;
    const payload = JSON.stringify({ input: [{ text: 'Contesto {{MF_PII_synthetic_1}}' }] });
    const input = { payload, lane: 'patient_insight' as const, status: 'allowed' as const, entityCounts: { person: 1 } };
    try {
        const record = appendChatGptEgressAudit(input);
        assert.equal(record.payloadSha256, createHash('sha256').update(payload, 'utf8').digest('hex'));
        assert.equal(record.provider, 'chatgpt_subscription');
        const first = readFileSync(getEgressGateAuditPath(), 'utf8');
        assert.doesNotMatch(first, /Contesto|MF_PII|synthetic|rehydrat/);
        const invalidCounts: Record<string, number>[] = [{ 'Synthetic Person': 1 }, { person: -1 }, { person: 0.5 }, { person: 4097 }];
        for (const entityCounts of invalidCounts) {
            assert.throws(() => appendChatGptEgressAudit({ ...input, entityCounts }), /Invalid egress audit/);
        }
        assert.equal(readFileSync(getEgressGateAuditPath(), 'utf8'), first);
        appendChatGptEgressAudit({ ...input, payload: payload + '\n', status: 'blocked_residual_entities' });
        const records = readFileSync(getEgressGateAuditPath(), 'utf8').trim().split('\n').map(line => JSON.parse(line));
        assert.equal(records.length, 2);
        assert.notEqual(records[0].payloadSha256, records[1].payloadSha256);
        assert.equal(records[1].status, 'blocked_residual_entities');
    } finally {
        if (previous === undefined) delete process.env.MEDIFLOW_DATA_DIR;
        else process.env.MEDIFLOW_DATA_DIR = previous;
        rmSync(root, { recursive: true, force: true });
    }
});
