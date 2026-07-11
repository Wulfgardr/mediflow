/* @Codex */
import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
    evaluateEgress,
    type EgressEntityCounts,
    type EvaluateEgressInput,
    type EgressGateResult,
    type EgressGateStatus,
} from './ai-egress-gate';

export interface EgressGateAuditRecord {
    timestamp: string;
    payloadSha256: string;
    lane: string;
    status: EgressGateStatus;
    entityCounts: EgressEntityCounts;
}

export function getEgressGateAuditPath(): string {
    const dataDir = process.env.MEDIFLOW_DATA_DIR
        || (process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
            : path.join(os.homedir(), '.mediflow'));
    return path.join(dataDir, 'ai', 'egress-gate', 'audit.ndjson');
}

export function appendEgressGateAudit(input: {
    text: string;
    lane: string;
    status: EgressGateStatus;
    entityCounts: EgressEntityCounts;
    timestamp?: Date;
}): EgressGateAuditRecord {
    const record: EgressGateAuditRecord = {
        timestamp: (input.timestamp ?? new Date()).toISOString(),
        payloadSha256: createHash('sha256').update(input.text, 'utf8').digest('hex'),
        lane: input.lane,
        status: input.status,
        entityCounts: { ...input.entityCounts },
    };
    const auditPath = getEgressGateAuditPath();
    mkdirSync(path.dirname(auditPath), { recursive: true });
    appendFileSync(auditPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    return record;
}

// This server-side composition point is the future egress chokepoint. Keeping
// filesystem I/O here preserves evaluateEgress as a pure, browser-safe Layer 1.
export function evaluateAndAuditEgress(input: EvaluateEgressInput): EgressGateResult {
    const result = evaluateEgress(input);
    appendEgressGateAudit({
        text: input.text,
        lane: input.lane,
        status: result.status,
        entityCounts: result.entityCounts,
    });
    return result;
}
