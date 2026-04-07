/* @Codex */
import { eq } from 'drizzle-orm';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import { ambulatories, users } from './schema';
/* @Codex */
import type { NetworkIdentitySummary } from './api/v1/types';
/* @Codex */
import type { ServerSession } from './server-session';
/* @Codex */
import { deriveNetworkIdentitySummary } from './network-identity-model';

export async function getNetworkIdentitySummary(
    session: ServerSession | null,
    activeAmbulatoryId: string | null
): Promise<NetworkIdentitySummary> {
    const [userHints, defaultAmbulatory, activeAmbulatory, operator] = await Promise.all([
        dbServer
            .select({
                username: users.username,
                displayName: users.displayName,
            })
            .from(users)
            .limit(2),
        dbServer
            .select({
                id: ambulatories.id,
                name: ambulatories.name,
            })
            .from(ambulatories)
            .where(eq(ambulatories.isDefault, true))
            .get(),
        activeAmbulatoryId
            ? dbServer
                .select({
                    id: ambulatories.id,
                    name: ambulatories.name,
                })
                .from(ambulatories)
                .where(eq(ambulatories.id, activeAmbulatoryId))
                .get()
            : Promise.resolve(undefined),
        session
            ? dbServer
                .select({
                    id: users.id,
                    username: users.username,
                    displayName: users.displayName,
                    role: users.role,
                })
                .from(users)
                .where(eq(users.id, session.userId))
                .get()
            : Promise.resolve(undefined),
    ]);

    return deriveNetworkIdentitySummary({
        session,
        operator: operator ?? null,
        activeAmbulatory: activeAmbulatory ?? null,
        defaultAmbulatory: defaultAmbulatory ?? null,
        userCount: userHints.length,
        loginHint: userHints.length === 1 ? userHints[0] : null,
    });
}
