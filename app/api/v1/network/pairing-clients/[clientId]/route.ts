import { revokeNetworkPairedClient } from '@/lib/network-home-base-server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireDevicePairingAdminSession } from '@/lib/security/device-pairing-web-auth';

const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> },
) {
    try {
        const { clientId } = await params;
        const access = await requireDevicePairingAdminSession(request, true);
        if (!access) {
            const authError = requireLocalApiToken(request);
            if (authError) return authError;
        }
        const persisted = await revokeNetworkPairedClient(clientId, access
            ? { actorRef: access.session.userId, sourceSurface: 'web', expectedGeneration: access.generation }
            : { actorRef: 'local-api', sourceSurface: 'api' });
        if (persisted.conflict) {
            return reply({ error: 'Conflict', code: 'PAIRING_STATE_CONFLICT', message: 'Pairing state changed, retry.' }, 409);
        }
        return reply(persisted.result.value, persisted.result.status);
    } catch {
        return reply({ error: 'Failed to revoke paired client' }, 500);
    }
}
