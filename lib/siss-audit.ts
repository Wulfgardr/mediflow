/* @Codex */
import { sanitizeAuditMetadata, type AuditRedactedMetadata } from './security/audit';
/* @Codex */
import type { SissTransportMode } from './siss-adapter';

/* @Codex */
export type SissPrescriptionAuditEntrypoint = 'patient-context' | 'therapy-panel';

/* @Codex */
export function buildSissPrescriptionLaunchAuditMetadata(input: {
    entrypoint: SissPrescriptionAuditEntrypoint;
    mode?: SissTransportMode | null;
    outcome: 'success' | 'failure';
    reasonCode?: string | null;
}): AuditRedactedMetadata | null {
    return sanitizeAuditMetadata({
        counts: 1,
        reasonCode: input.outcome === 'failure' ? input.reasonCode ?? 'SISS_UPSTREAM' : undefined,
        flags: [
            'integration:siss',
            'path:webapp-official',
            'target:modulo-prescrittivo-regionale',
            `entrypoint:${input.entrypoint}`,
            input.mode ? `mode:${input.mode}` : 'mode:unknown',
            input.outcome === 'success' ? 'launch:requested' : 'launch:failed',
        ],
    });
}
