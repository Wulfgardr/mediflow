import { logServerError, logServerWarning } from '@/lib/server-error-log';
import { writeSettingWithFunctionModelGeneration } from '@/lib/ai-providers/fabric/function-model-settings-write';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { networkModeWriteDenial } from '@/lib/security/network-mode-write';

import { NextResponse } from 'next/server';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';
import { auditContextFromRequest, listChangedFields, requestIdFromRequest, withAuditContextMetadata, writeAuditEvent } from '@/lib/security/audit';
import { normalizeSettingValue } from '@/lib/settings-value';
import { evaluateSettingsWrite } from '@/lib/security/settings-write-policy';
import { PERSONAL_CANDIDATE_REVIEW_SETTING_KEY } from '@/lib/service-package-candidates';
import { apiInternalError } from '@/lib/api-error-response';

export async function POST(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        const { key, value } = body;

        if (!key || value === undefined) {
            return NextResponse.json({ error: "Key and value required" }, { status: 400 });
        }
        if (key === PERSONAL_CANDIDATE_REVIEW_SETTING_KEY) {
            return NextResponse.json({ error: 'Candidate review requires conditional single-key update' }, { status: 400 });
        }

        const decision = evaluateSettingsWrite(key, session);
        if (!decision.allowed) {
            return NextResponse.json({ error: decision.reason }, { status: decision.status });
        }
        const archiveDenial = archiveWriteRequestDenial(request, session);
        if (archiveDenial) return archiveDenial;
        if (decision.unregistered) {
            logServerWarning('Settings: unregistered key in batch write');
        }

        const persistedValue = normalizeSettingValue(value);
        const networkModeDenial = networkModeWriteDenial(request, session, key, persistedValue);
        if (networkModeDenial) return networkModeDenial;

        // Upsert (Insert or Update) logic
        // This allows db.settings.put({ key: '...', value: '...' }) to work via POST
        writeSettingWithFunctionModelGeneration(key, persistedValue);

        try {
            const context = auditContextFromRequest(request, session);
            await writeAuditEvent({
                eventType: 'settings.updated',
                outcome: 'success',
                actorType: context.actorType,
                actorRef: context.actorRef,
                subjectType: 'settings',
                subjectRef: key,
                sourceSurface: context.sourceSurface,
                requestId: requestIdFromRequest(request),
                redactedMetadata: withAuditContextMetadata(context, {
                    changedFields: listChangedFields(body, ['key']),
                }),
            });
        } catch (error) {
            logServerError('Audit settings write failed', error);
        }

        return NextResponse.json({ success: true, key, value: persistedValue });
    } catch (error) {
        return apiInternalError('POST /api/settings', error);
    }
}
