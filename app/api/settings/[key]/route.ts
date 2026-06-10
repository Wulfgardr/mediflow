import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import { eq } from 'drizzle-orm';
/* @Codex */
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { auditContextFromRequest, listChangedFields, requestIdFromRequest, withAuditContextMetadata, writeAuditEvent } from '@/lib/audit';
/* @Codex */
import { normalizeSettingValue } from '@/lib/settings-value';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ key: string }> }
) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const { key } = await params;
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
    /* @Codex */
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const { key } = await params;
        const body = await request.json();
        const { value } = body;

        if (value === undefined) {
            return NextResponse.json({ error: "Value required" }, { status: 400 });
        }

        /* @Codex */
        const persistedValue = normalizeSettingValue(value);

        await dbServer
            .insert(settings)
            .values({ key, value: persistedValue })
            .onConflictDoUpdate({ target: settings.key, set: { value: persistedValue } });

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
