/* @Codex */
import 'server-only';

import { eq } from 'drizzle-orm';

/* @Codex */
import {
    auditContextFromSession,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from '@/lib/security/audit';
/* @Codex */
import { settings, users } from '@/lib/schema';
/* @Codex */
import type { dbServer as dbServerType } from '@/lib/db-server';
/* @Codex */
import type { ServerSession } from '@/lib/security/server-session';

type ProfileDatabase = typeof dbServerType;

export type ProfileUpdateServiceDependencies = {
    db?: ProfileDatabase;
    writeAuditEvent?: typeof writeAuditEvent;
};

export type ProfileUpdateServiceInput = {
    session: ServerSession;
    request: Request;
    displayName: string | null;
    ambulatoryName: string | null;
};

export type ProfileUpdateServiceResult = { kind: 'success' } | { kind: 'not-found' };

async function resolveDatabase(dependencies: ProfileUpdateServiceDependencies): Promise<ProfileDatabase> {
    if (dependencies.db) return dependencies.db;
    const { dbServer } = await import('@/lib/db-server');
    return dbServer;
}

/**
 * Keeps the operator record and network identity settings in one SQLite
 * transaction. Empty settings values deliberately represent a cleared nullable
 * profile field, so stale names can never survive in network discovery.
 */
export async function updateProfile(
    input: ProfileUpdateServiceInput,
    dependencies: ProfileUpdateServiceDependencies = {},
): Promise<ProfileUpdateServiceResult> {
    const db = await resolveDatabase(dependencies);
    const commit = db.transaction((tx) => {
        const userUpdate = tx
            .update(users)
            .set({
                displayName: input.displayName,
                ambulatoryName: input.ambulatoryName,
            })
            .where(eq(users.id, input.session.userId))
            .run();

        if (userUpdate.changes !== 1) return { kind: 'not-found' } as const;

        tx.insert(settings)
            .values({ key: 'doctorName', value: input.displayName ?? '' })
            .onConflictDoUpdate({ target: settings.key, set: { value: input.displayName ?? '' } })
            .run();
        tx.insert(settings)
            .values({ key: 'clinicName', value: input.ambulatoryName ?? '' })
            .onConflictDoUpdate({ target: settings.key, set: { value: input.ambulatoryName ?? '' } })
            .run();

        return { kind: 'success' } as const;
    });

    if (commit.kind === 'not-found') return commit;

    try {
        const context = auditContextFromSession(input.session);
        await (dependencies.writeAuditEvent ?? writeAuditEvent)({
            eventType: 'settings.updated',
            outcome: 'success',
            actorType: context.actorType,
            actorRef: context.actorRef,
            subjectType: 'settings',
            subjectRef: 'profile.identity',
            sourceSurface: context.sourceSurface,
            requestId: requestIdFromRequest(input.request),
            redactedMetadata: withAuditContextMetadata(context, {
                changedFields: ['displayName', 'ambulatoryName', 'doctorName', 'clinicName'],
                flags: ['profile-update'],
                reasonCode: 'profile_update',
            }),
        });
    } catch (error) {
        console.error('Audit profile update write failed:', error);
    }

    return commit;
}
