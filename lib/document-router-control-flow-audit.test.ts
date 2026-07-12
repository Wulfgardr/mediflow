/* @Codex */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    appendDocumentRouterControlFlowAudit,
    getDocumentRouterControlFlowAuditPath,
} from './document-router-control-flow-audit';

test('appends only PHI-safe document router shadow fields', () => {
    const previousDataDir = process.env.MEDIFLOW_DATA_DIR;
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-document-router-audit-'));
    process.env.MEDIFLOW_DATA_DIR = dataDir;

    try {
        const record = appendDocumentRouterControlFlowAudit({
            classification: 'lab_report',
            confidence: 'high',
            wouldSkip: true,
            mode: 'shadow',
        });
        const audit = readFileSync(getDocumentRouterControlFlowAuditPath(), 'utf8');

        assert.equal(record.mode, 'shadow');
        assert.match(audit, /"classification":"lab_report"/);
        assert.match(audit, /"confidence":"high"/);
        assert.match(audit, /"wouldSkip":true/);
        assert.doesNotMatch(audit, /rawMarkdown|fileName|summary|Mario Rossi/i);
    } finally {
        if (previousDataDir === undefined) delete process.env.MEDIFLOW_DATA_DIR;
        else process.env.MEDIFLOW_DATA_DIR = previousDataDir;
        rmSync(dataDir, { recursive: true, force: true });
    }
});
