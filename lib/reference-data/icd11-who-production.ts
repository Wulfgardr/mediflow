/* @Codex */
import 'server-only';

import { writeAuditEvent } from '@/lib/security/audit';
import type { Icd11WhoSearchReceipt } from './icd11-who-service';
import { icd11WhoServerOwner } from './icd11-who-server-owner';
import {
    createIcd11WhoProductionRuntime,
    type Icd11WhoProductionRuntime,
} from './icd11-who-production-runtime';

let runtime: Icd11WhoProductionRuntime | null = null;

export function getIcd11WhoProductionRuntime(): Icd11WhoProductionRuntime {
    if (runtime) return runtime;
    runtime = createIcd11WhoProductionRuntime(Object.freeze({
        owner: icd11WhoServerOwner,
        now: () => Date.now(),
        readEnvironment: (name: string) => process.env[name],
        audit: async (receipt: Icd11WhoSearchReceipt) => {
            await writeAuditEvent({
                eventType: 'reference_data.icd11.search',
                outcome: 'success',
                actorType: 'system',
                actorRef: 'icd11-who-owner',
                subjectType: 'reference_data',
                sourceSurface: 'api',
                redactedMetadata: {
                    counts: receipt.resultCount,
                    flags: [`source:${receipt.source}`, `release:${receipt.releaseId}`, `language:${receipt.language}`],
                },
            });
        },
    }));
    return runtime;
}
