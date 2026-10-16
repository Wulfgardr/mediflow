import { eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { ambulatories, users } from './schema';
import type { NetworkIdentitySummary } from './api/v1/types';
import type { ServerSession } from './security/server-session';
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
