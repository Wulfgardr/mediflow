/* @Codex */
import 'server-only';

import type { SmartImportProjection } from '../smart-import-projection';
import type { PatientSmartImportHostCapabilityResult } from '../domain/documents/patient-smart-import-host-capability';
import type { ServerSession } from './server-session';
import type { ServerSessionProjectionOwner } from './server-session-projection-owner';

type Broker = Readonly<{ consume(input: Readonly<{ handle: string; capability: 'smart_import'; requestId: string }>): SmartImportProjection }>;
type Context = Readonly<{ session: ServerSession; owner: ServerSessionProjectionOwner }>;
type Capability = Readonly<{ preview(input: unknown): Promise<PatientSmartImportHostCapabilityResult> }>;
type Sources = Readonly<{ acquireContext(): Promise<Context | null>; createCapability(broker: Broker): Capability }>;

export type AuthenticatedSmartImportPreviewErrorCode = 'session_unavailable';
export class AuthenticatedSmartImportPreviewError extends Error {
    constructor(readonly code: AuthenticatedSmartImportPreviewErrorCode) {
        super(`Authenticated Smart Import preview rejected: ${code}`);
        this.name = 'AuthenticatedSmartImportPreviewError';
    }
}

const inputInvalid = Object.freeze({ writesPerformed: 0 as const, apply: 'denied' as const, status: 'denied' as const,
    code: 'input_invalid' as const, proposal: null, receipt: null, provenance: null, reviewRef: null });

function fail(code: AuthenticatedSmartImportPreviewErrorCode): never {
    throw new AuthenticatedSmartImportPreviewError(code);
}

export function createAuthenticatedSmartImportPreviewService(sources: Sources) {
    return Object.freeze({
        async preview(input: unknown): Promise<PatientSmartImportHostCapabilityResult> {
            let context: Context | null;
            try { context = await sources.acquireContext(); } catch { return fail('session_unavailable'); }
            if (!context) return fail('session_unavailable');
            const broker: Broker = Object.freeze({
                consume(value) { return context.owner.resolveProjectionService(context.session).consume(value); },
            });
            let capability: Capability;
            try { capability = sources.createCapability(broker); } catch { return inputInvalid; }
            try { return await capability.preview(input); } catch { return inputInvalid; }
        },
    });
}
