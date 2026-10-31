import { RESTORE_RECEIPT_PREFIX } from '@/lib/backup-restore-receipt-contract';
import { writeSettingWithFunctionModelGeneration } from '@/lib/ai-providers/fabric/function-model-settings-write';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { NextResponse } from 'next/server';
import { dbServer, runDbServerImmediateTransaction } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';
import { auditContextFromRequest, listChangedFields, requestIdFromRequest, withAuditContextMetadata, writeAuditEvent } from '@/lib/security/audit';
import { isValidInsightSetting, normalizeSettingValue } from '@/lib/settings-value';
import { evaluateSettingsWrite } from '@/lib/security/settings-write-policy';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ key: string }> }
) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const { key } = await params;
        if (key.startsWith(RESTORE_RECEIPT_PREFIX)) return NextResponse.json({ error: 'Dedicated restore receipt service required' }, { status: 403 });
        const result = await dbServer.select().from(settings).where(eq(settings.key, key)).get();

        if (!result) {
            return NextResponse.json({ key, value: null });
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error("GET Setting Error:", error);
        return NextResponse.json({ error: "Failed to fetch setting" }, { status: 500 });
    }
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ key: string }> }
) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const { key } = await params;
        const body = await request.json();
        const { value } = body;

        if (value === undefined) {
            return NextResponse.json({ error: "Value required" }, { status: 400 });
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

        if (!isValidInsightSetting(key, value)) {
            return NextResponse.json({ error: 'Invalid Insight parameter value' }, { status: 400 });
        }
        const persistedValue = normalizeSettingValue(value);

        if (key === 'network.mode' && Object.hasOwn(body, 'expectedValue')) {
            if (!['local-only', 'network-home-base'].includes(persistedValue)
                || !(body.expectedValue === null || typeof body.expectedValue === 'string')) {
                return NextResponse.json({ error: 'Invalid network mode precondition' }, { status: 400 });
            }
            const applied = runDbServerImmediateTransaction(() => {
                const before = dbServer.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
                if (before !== body.expectedValue) return false;
                writeSettingWithFunctionModelGeneration(key, persistedValue);
                return true;
            });
            if (!applied) return NextResponse.json({ error: 'Network mode changed', code: 'NETWORK_MODE_CONFLICT' }, { status: 409 });
        } else {
            writeSettingWithFunctionModelGeneration(key, persistedValue);
        }

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
                    changedFields: listChangedFields(body),
                }),
            });
        } catch (error) {
            console.error('Audit settings write failed:', error);
        }

        return NextResponse.json({ success: true, key, value: persistedValue });
    } catch (error) {
        console.error("PUT Setting Error:", error);
        return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
    }
}
