import { writeSettingWithFunctionModelGeneration } from '@/lib/ai-providers/fabric/function-model-settings-write';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';

import { NextResponse } from 'next/server';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';
import { auditContextFromRequest, listChangedFields, requestIdFromRequest, withAuditContextMetadata, writeAuditEvent } from '@/lib/security/audit';
import { normalizeSettingValue } from '@/lib/settings-value';
import { evaluateSettingsWrite } from '@/lib/security/settings-write-policy';
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

        const decision = evaluateSettingsWrite(key, session);
        if (!decision.allowed) {
            return NextResponse.json({ error: decision.reason }, { status: decision.status });
        }
        const archiveDenial = archiveWriteRequestDenial(request, session);
        if (archiveDenial) return archiveDenial;
        if (decision.unregistered) {
            console.warn(`[MediFlow] settings write TODO: registra la chiave sconosciuta "${key}" in lib/security/settings-write-policy.ts`);
        }

        const persistedValue = normalizeSettingValue(value);

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
            console.error('Audit settings write failed:', error);
        }

        return NextResponse.json({ success: true, key, value: persistedValue });
    } catch (error) {
        /* WUL-547. Qui il `message` grezzo dell'eccezione usciva verso il client
           dentro un template literal, e il guard non lo vedeva perche' il cast
           `(error as any)?` spezzava il match. apiInternalError() logga il
           dettaglio e restituisce un messaggio stabile con un codice. */
        return apiInternalError('POST /api/settings', error);
    }
}
