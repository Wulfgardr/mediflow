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

export type ChatGptEgressAuditRecord = EgressGateAuditRecord & {
    provider: 'chatgpt_subscription';
};

function appendRecord(record: EgressGateAuditRecord): void {
    const auditPath = getEgressGateAuditPath();
    mkdirSync(path.dirname(auditPath), { recursive: true });
    appendFileSync(auditPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
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
    appendRecord(record);
    return record;
}

/** The caller supplies the exact prepared wire bytes, never the original text.
 * This records a gate decision; it does not attest transmission or grant it. */
export function appendChatGptEgressAudit(input: {
    payload: string;
    lane: 'patient_insight' | 'smart_import' | 'document_synthesis' | 'treatment_reasoning';
    status: EgressGateStatus;
    entityCounts: EgressEntityCounts;
    timestamp?: Date;
}): ChatGptEgressAuditRecord {
    const { payload, lane, status } = input;
    const timestamp = input.timestamp === undefined ? new Date().toISOString() : new Date(Date.prototype.getTime.call(input.timestamp)).toISOString();
    const lanes = ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'];
    const entities = ['person', 'date', 'phone', 'address', 'tax_id', 'email', 'organization', 'identifier', 'other'];
    if (typeof payload !== 'string' || !payload || !lanes.includes(lane)
        || !['allowed', 'closed_pending_redaction_lane', 'blocked_residual_entities'].includes(status)) throw new Error('Invalid egress audit');
    const entityCounts: EgressEntityCounts = {};
    for (const [type, count] of Object.entries(input.entityCounts)) {
        if (!entities.includes(type) || !Number.isSafeInteger(count) || count < 0 || count > 4096) throw new Error('Invalid egress audit');
        entityCounts[type] = count;
    }
    const record: ChatGptEgressAuditRecord = {
        timestamp,
        payloadSha256: createHash('sha256').update(payload, 'utf8').digest('hex'),
        provider: 'chatgpt_subscription', lane, status, entityCounts,
    };
    appendRecord(record);
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
