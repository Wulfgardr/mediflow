/* @Codex */
import 'server-only';
import { eq } from 'drizzle-orm';
import { dbServer, runDbServerImmediateTransaction } from './db-server';
import { settings, users } from './schema';
import { requirePairedNativeSession } from './security/paired-native-session';
import { peekSession, isPairedNativeServerSession, registerServerSessionResource } from './security/server-session';
import { NETWORK_MODE_KEY, normalizeNetworkOperatingMode } from './network-contract';
import { NETWORK_PAIRING_STATE_KEY, parseNetworkPairingState } from './network-pairing-model';
import { authenticatePairedClientRequest } from './network-paired-client-auth';
import { readNativeConfigurationGrant, NativeConfigurationGrantError } from './native-ai-configuration-grants';
import { createNativeConfigurationHttp } from './native-ai-configuration-http';
import { FunctionModelError, functionModelDigest } from './ai-providers/fabric/function-model-preferences';
import { functionModelPreferencesService } from './ai-providers/fabric/function-model-preferences-production';

const setting = (key: string) => dbServer.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value ?? null;
export const nativeConfigurationHttp = createNativeConfigurationHttp({
    service: functionModelPreferencesService,
    async authenticate(request) {
        const session = await requirePairedNativeSession(request);
        if (!session) return null;
        const verifySession = () => {
            const client = authenticatePairedClientRequest(request, parseNetworkPairingState(setting(NETWORK_PAIRING_STATE_KEY)).clients);
            const user = dbServer.select({ username: users.username, role: users.role }).from(users).where(eq(users.id, session.userId)).get();
            if (!client || normalizeNetworkOperatingMode(setting(NETWORK_MODE_KEY)) !== 'network-home-base'
                || peekSession(session.id) !== session || session.authChannel !== 'native'
                || !isPairedNativeServerSession(session, { clientId: client.clientId, clientPlatform: client.clientPlatform, tokenHash: client.tokenHash })
                || !user || user.username !== session.username || user.role !== session.role) throw new FunctionModelError('session_stale');
            return { userId: session.userId, clientId: client.clientId, role: session.role };
        };
        const principal = verifySession();
        const grant = readNativeConfigurationGrant(process.env.MEDIFLOW_NATIVE_AI_CONFIG_GRANTS_FILE, principal);
        const verify = () => {
            const current = verifySession();
            if (readNativeConfigurationGrant(process.env.MEDIFLOW_NATIVE_AI_CONFIG_GRANTS_FILE, current) !== grant) throw new NativeConfigurationGrantError();
        };
        return Object.freeze({ identity: functionModelDigest([session.id, principal, grant]),
            register: (dispose: () => void) => registerServerSessionResource(session.id, dispose),
            runCurrent<T>(operation: () => T): T {
                return runDbServerImmediateTransaction(() => { verify(); const result = operation(); verify(); return result; });
            },
        });
    },
});
