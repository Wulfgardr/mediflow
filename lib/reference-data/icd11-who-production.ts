/* @Codex */
import 'server-only';

import { writeAuditEvent } from '@/lib/security/audit';
import { createIcd11WhoLocalRuntime, type Icd11WhoLocalRuntime } from './icd11-who-local-runtime';
import { createIcd11WhoLocalNodeTransport } from './icd11-who-local-node-transport';
import { parseWhoLocalReceipt, type WhoLocalReceipt } from './icd11-who-local-contract';

let runtime: Icd11WhoLocalRuntime | null = null;

/** Persist only the validated receipt fields, within the existing audit whitelist. */
export async function writeWhoLocalReceiptAudit(receipt: WhoLocalReceipt): Promise<string> {
    const r = parseWhoLocalReceipt(receipt, receipt?.resultCount);
    if (!r || !Number.isSafeInteger(r.resultCount) || r.resultCount < 0 || r.resultCount > 25) {
        throw new Error('Invalid WHO local audit receipt');
    }
    // Short digest keys keep every SHA-256 character within the 80-character token limit.
    const flags = [
        `schema:${r.schemaVersion}`, `operation:${r.operation}`, `deployment:${r.deployment}`,
        `source:${r.source}`, `release:${r.releaseId}`, `language:${r.language}`, `binding:${r.bindingId}`,
        `image:${r.imageDigest}`, `dataset:${r.datasetSnapshotId}`, `latencyMs:${r.latencyMs}`,
        `fetchedAt:${r.fetchedAt}`, `expiresAt:${r.expiresAt}`, `completedAt:${r.completedAt}`,
    ];
    if (flags.some(flag => flag.length > 80 || !/^[a-zA-Z0-9._:-]+$/u.test(flag))) {
        throw new Error('Invalid WHO local audit receipt');
    }
    return writeAuditEvent({
        eventType: 'reference_data.icd11.search', outcome: 'success', actorType: 'system',
        actorRef: 'icd11-who-owner', subjectType: 'reference_data', sourceSurface: 'api',
        redactedMetadata: { counts: r.resultCount, flags },
    });
}

export function getIcd11WhoProductionRuntime(): Icd11WhoLocalRuntime {
    if (runtime) return runtime;
    runtime = createIcd11WhoLocalRuntime(Object.freeze({
        transport: createIcd11WhoLocalNodeTransport(),
        now: () => Date.now(),
        readEnvironment: (name: string) => process.env[name],
        audit: async (receipt: WhoLocalReceipt) => {
            await writeWhoLocalReceiptAudit(receipt);
        },
    }));
    return runtime;
}
