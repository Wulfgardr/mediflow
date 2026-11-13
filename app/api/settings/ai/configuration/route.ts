import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { AI_CONFIGURATION_KEYS } from '@/lib/ai-settings-configuration';
import { writeSettingWithFunctionModelGeneration } from '@/lib/ai-providers/fabric/function-model-settings-write';
import { apiInternalError } from '@/lib/api-error-response';
import { readBoundedJsonBody } from '@/lib/bounded-request-body';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import { isValidInsightSetting } from '@/lib/settings-value';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { auditContextFromRequest, requestIdFromRequest, withAuditContextMetadata, writeAuditEventInTransaction } from '@/lib/security/audit';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { evaluateSettingsWrite } from '@/lib/security/settings-write-policy';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactSettings = (value: unknown): value is Record<string, unknown> => record(value)
    && Object.keys(value).length === AI_CONFIGURATION_KEYS.length && AI_CONFIGURATION_KEYS.every(key => Object.hasOwn(value, key));

export async function PUT(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const denial = archiveWriteRequestDenial(request, session);
    if (denial) return denial;
    for (const key of AI_CONFIGURATION_KEYS) {
        const decision = evaluateSettingsWrite(key, session);
        if (!decision.allowed) return NextResponse.json({ error: decision.reason }, { status: decision.status, headers: NO_STORE });
    }
    try {
        const parsed = await readBoundedJsonBody(request, 65_536, 'request-json', { signal: request.signal, deadline: Infinity });
        if (!parsed.ok) return NextResponse.json({ code: 'input_invalid' }, { status: parsed.status, headers: NO_STORE });
        const body = parsed.value;
        if (!record(body) || Object.keys(body).length !== 2 || !exactSettings(body.expectedValues) || !exactSettings(body.values)) {
            return NextResponse.json({ code: 'input_invalid' }, { status: 400, headers: NO_STORE });
        }
        const { expectedValues, values } = body;
        if (!AI_CONFIGURATION_KEYS.every(key => (expectedValues[key] === null || typeof expectedValues[key] === 'string')
            && typeof values[key] === 'string' && isValidInsightSetting(key, values[key]))) {
            return NextResponse.json({ code: 'input_invalid' }, { status: 400, headers: NO_STORE });
        }
        const context = auditContextFromRequest(request, session);
        // The read-set CAS, existing generation-aware writer and required audit share one writer lock.
        const applied = dbServer.transaction(tx => {
            for (const key of AI_CONFIGURATION_KEYS) {
                const before = tx.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
                if (before !== expectedValues[key]) return false;
            }
            for (const key of AI_CONFIGURATION_KEYS) {
                writeSettingWithFunctionModelGeneration(key, values[key] as string);
                writeAuditEventInTransaction(tx, {
                    eventType: 'settings.updated', outcome: 'success',
                    archiveGeneration: context.archiveGeneration, actorType: context.actorType, actorRef: context.actorRef,
                    subjectType: 'settings', subjectRef: key, sourceSurface: context.sourceSurface,
                    requestId: requestIdFromRequest(request),
                    redactedMetadata: withAuditContextMetadata(context, { changedFields: ['value'] }),
                });
            }
            return true;
        }, { behavior: 'immediate' });
        if (!applied) return NextResponse.json({ code: 'AI_CONFIGURATION_CONFLICT' }, { status: 409, headers: NO_STORE });
        return NextResponse.json({ success: true, values }, { headers: NO_STORE });
    } catch (error) { return apiInternalError('PUT /api/settings/ai/configuration', error); }
}
