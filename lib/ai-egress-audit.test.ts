/* @Codex */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evaluateAndAuditEgress, getEgressGateAuditPath } from './ai-egress-audit';

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
