/* @Codex */
import { appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { DocumentRouterControlFlowMode } from './domain/documents/document-router-control-flow';
import type { DocumentDecisionClassification, DocumentDecisionConfidence } from './domain/documents/document-decision';

export interface DocumentRouterControlFlowAuditRecord {
    timestamp: string;
    classification: DocumentDecisionClassification;
    confidence: DocumentDecisionConfidence;
    wouldSkip: boolean;
    mode: DocumentRouterControlFlowMode;
}

export function getDocumentRouterControlFlowAuditPath(): string {
    const dataDir = process.env.MEDIFLOW_DATA_DIR
        || (process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
            : path.join(os.homedir(), '.mediflow'));
    return path.join(dataDir, 'ai', 'document-router', 'audit.ndjson');
}

export function appendDocumentRouterControlFlowAudit(input: Omit<DocumentRouterControlFlowAuditRecord, 'timestamp'> & {
    timestamp?: Date;
}): DocumentRouterControlFlowAuditRecord {
    const record: DocumentRouterControlFlowAuditRecord = {
        timestamp: (input.timestamp ?? new Date()).toISOString(),
        classification: input.classification,
        confidence: input.confidence,
        wouldSkip: input.wouldSkip,
        mode: input.mode,
    };
    const auditPath = getDocumentRouterControlFlowAuditPath();
    mkdirSync(path.dirname(auditPath), { recursive: true });
    appendFileSync(auditPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    return record;
}
