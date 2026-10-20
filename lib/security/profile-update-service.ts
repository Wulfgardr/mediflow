import 'server-only';

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';

import {
    auditContextFromSession,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
    writeAuditEventInTransaction,
} from '@/lib/security/audit';
import { assertArchiveGeneration, ArchiveReplacedError } from '@/lib/archive-generation';
import { archiveGenerationForSession, currentArchiveGeneration } from '@/lib/security/archive-session-generation';
import { isCurrentServerSession, type PairedNativeBinding } from '@/lib/security/current-session-authority';
import { settings, users } from '@/lib/schema';
import type { dbServer as dbServerType } from '@/lib/db-server';
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

const profileColumns = {
    id: users.id,
    username: users.username,
    displayName: users.displayName,
    ambulatoryName: users.ambulatoryName,
} as const;

export type AccountProfileSnapshot = {
    userId: string;
    username: string;
    displayName: string | null;
    ambulatoryName: string | null;
    profileVersion: string;
    archiveGeneration: string;
};

export type AccountProfileRead = AccountProfileSnapshot & {
    operation: 'account-profile.read.v1';
    contractVersion: 1;
};

export type AccountProfileReadResult = { kind: 'success'; profile: AccountProfileRead } | { kind: 'not-found' };

export type ProfileConditionalUpdateInput = {
    session: ServerSession;
    request: Request;
    expectedVersion: string;
    displayName: string | null;
    ambulatoryName: string | null;
    nativeBinding?: PairedNativeBinding | null;
};

export type ProfileConditionalUpdateResult =
    | { kind: 'success'; changed: boolean; profile: AccountProfileSnapshot }
    | { kind: 'not-found' }
    | { kind: 'version-conflict'; profile: AccountProfileSnapshot }
    | { kind: 'unauthorized' };

type ProfileRow = {
    id: string;
    username: string;
    displayName: string | null;
    ambulatoryName: string | null;
};

async function resolveDatabase(dependencies: ProfileUpdateServiceDependencies): Promise<ProfileDatabase> {
    if (dependencies.db) return dependencies.db;
    const { dbServer } = await import('@/lib/db-server');
    return dbServer;
}

/** ADR 0155. The host derives the opaque version from the canonical profile state. */
export function deriveProfileVersion(
    userId: string,
    displayName: string | null,
    ambulatoryName: string | null,
): string {
    const digest = createHash('sha256')
        .update(JSON.stringify([userId, displayName, ambulatoryName]))
        .digest('hex');
    return `p1:${digest}`;
}

function snapshotFromRow(row: ProfileRow, archiveGeneration: string): AccountProfileSnapshot {
    const displayName = row.displayName ?? null;
    const ambulatoryName = row.ambulatoryName ?? null;
    return {
        userId: row.id,
        username: row.username,
        displayName,
        ambulatoryName,
        profileVersion: deriveProfileVersion(row.id, displayName, ambulatoryName),
        archiveGeneration,
    };
}

function requireSessionGeneration(session: ServerSession): string {
    const generation = archiveGenerationForSession(session);
    if (!generation || generation !== currentArchiveGeneration()) throw new ArchiveReplacedError();
    return generation;
}

/** Reads the session user's profile. No role, hash, salt, key, lock or recovery data leaves. */
export async function readAccountProfile(
    session: ServerSession,
    dependencies: ProfileUpdateServiceDependencies = {},
): Promise<AccountProfileReadResult> {
    const generation = requireSessionGeneration(session);
    const db = await resolveDatabase(dependencies);
    const row = db.select(profileColumns).from(users).where(eq(users.id, session.userId)).get();
    if (!row) return { kind: 'not-found' };
    return {
        kind: 'success',
        profile: { operation: 'account-profile.read.v1', contractVersion: 1, ...snapshotFromRow(row, generation) },
    };
}

/**
 * ADR 0155 conditional update. Everything after admission happens in one
 * IMMEDIATE transaction: archive fence, current session, version compare, the
 * user/settings rows and the required audit. Any failure rolls all of it back.
 */
export async function updateProfileConditionally(
    input: ProfileConditionalUpdateInput,
    dependencies: ProfileUpdateServiceDependencies = {},
): Promise<ProfileConditionalUpdateResult> {
    const db = await resolveDatabase(dependencies);
    return db.transaction((tx) => {
        const generation = archiveGenerationForSession(input.session);
        assertArchiveGeneration(tx, generation);
        if (!generation) throw new ArchiveReplacedError();
        if (!isCurrentServerSession(input.session, input.nativeBinding ?? null)) {
            return { kind: 'unauthorized' } as const;
        }

        const row = tx.select(profileColumns).from(users).where(eq(users.id, input.session.userId)).get();
        if (!row) return { kind: 'not-found' } as const;

        const current = snapshotFromRow(row, generation);
        if (current.profileVersion !== input.expectedVersion) {
            return { kind: 'version-conflict', profile: current } as const;
        }

        if (row.displayName === input.displayName && row.ambulatoryName === input.ambulatoryName) {
            return { kind: 'success', changed: false, profile: current } as const;
        }

        const userUpdate = tx
            .update(users)
            .set({ displayName: input.displayName, ambulatoryName: input.ambulatoryName })
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

        const context = auditContextFromSession(input.session);
        writeAuditEventInTransaction(tx, {
            archiveGeneration: generation,
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
                flags: ['profile-update', 'conditional'],
                reasonCode: 'profile_update',
            }),
        });

        const updated = tx.select(profileColumns).from(users).where(eq(users.id, input.session.userId)).get();
        if (!updated) throw new Error('Profile row is unavailable after update.');

        return { kind: 'success', changed: true, profile: snapshotFromRow(updated, generation) } as const;
    }, { behavior: 'immediate' });
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
