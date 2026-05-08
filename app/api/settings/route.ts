
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
/* @Codex */
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { auditContextFromRequest, listChangedFields, requestIdFromRequest, withAuditContextMetadata, writeAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        const { key, value } = body;

        if (!key || value === undefined) {
            return NextResponse.json({ error: "Key and value required" }, { status: 400 });
        }

        /* @Codex */
        const persistedValue = typeof value === 'string' ? value : JSON.stringify(value);

        // Upsert (Insert or Update) logic
        // This allows db.settings.put({ key: '...', value: '...' }) to work via POST
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
                    changedFields: listChangedFields(body, ['key']),
                }),
            });
        } catch (error) {
            console.error('Audit settings write failed:', error);
        }

        return NextResponse.json({ success: true, key, value: persistedValue });
    } catch (error) {
        console.error("POST Setting Error:", error);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = (error as any)?.message || String(error);
        return NextResponse.json({ error: `Failed to save setting: ${msg}` }, { status: 500 });
    }
}
