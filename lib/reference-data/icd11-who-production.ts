/* @Codex */
import 'server-only';

import { writeAuditEvent } from '@/lib/security/audit';
import { createIcd11WhoLocalRuntime, type Icd11WhoLocalRuntime } from './icd11-who-local-runtime';
import { createIcd11WhoLocalNodeTransport } from './icd11-who-local-node-transport';
import type { WhoLocalReceipt } from './icd11-who-local-contract';

let runtime: Icd11WhoLocalRuntime | null = null;

export function getIcd11WhoProductionRuntime(): Icd11WhoLocalRuntime {
    if (runtime) return runtime;
    runtime = createIcd11WhoLocalRuntime(Object.freeze({
        transport: createIcd11WhoLocalNodeTransport(),
        now: () => Date.now(),
        readEnvironment: (name: string) => process.env[name],
        audit: async (receipt: WhoLocalReceipt) => {
            await writeAuditEvent({
                eventType: 'reference_data.icd11.search',
                outcome: 'success',
                actorType: 'system',
                actorRef: 'icd11-who-owner',
                subjectType: 'reference_data',
                sourceSurface: 'api',
                redactedMetadata: {
                    counts: receipt.resultCount,
                    flags: [`deployment:${receipt.deployment}`, `source:${receipt.source}`, `release:${receipt.releaseId}`, `language:${receipt.language}`],
                },
            });
        },
    }));
    return runtime;
}
