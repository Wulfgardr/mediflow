import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { eq } from 'drizzle-orm';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from '../../lib/network-patient-authority-test-fixture';
import { bindSyntheticArchiveSessions } from '../../lib/security/web-auth-lifecycle-owner-test-fixture';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from '../../lib/network-pairing-model';
import { currentArchiveGeneration } from '../../lib/security/archive-session-generation';
import { clearAllSessions } from '../../lib/security/server-session';
import { prepareNetworkPatientCommitGuard } from '../../lib/network-patient-commit-authority';
import type { ServerSession } from '../../lib/security/server-session';

const [surface, operation, gate] = process.argv.slice(2);
if (!['host', 'paired'].includes(surface) || !['create', 'delete'].includes(operation) || !process.env.MEDIFLOW_DATA_DIR) {
    throw new Error('Synthetic surface, operation and data directory required');
}
const load = createRequire(import.meta.url);
const cookieState = { cookies: new Map<string, string>() };
const cleanup = installNetworkPatientCookieFixture(process.env.MEDIFLOW_DATA_DIR, cookieState);
const { dbServer, openDbServer } = load('../../lib/db-server.ts') as typeof import('../../lib/db-server');
const { settings } = load('../../lib/schema.ts') as typeof import('../../lib/schema');
const host = load('../../lib/ambulatory-write.ts') as typeof import('../../lib/ambulatory-write');
const paired = load('../../lib/network-ambulatory-write.ts') as typeof import('../../lib/network-ambulatory-write');
openDbServer();
const authority = syntheticNetworkPatientAuthority(dbServer, 'scope');
authority.pairedClient.grantedCapabilities.push(paired.NETWORK_AMBULATORY_WRITE_CAPABILITY);
dbServer.update(settings).set({ value: JSON.stringify({
    ...JSON.parse(serializeNetworkPairingState({ clients: [authority.pairedClient], intents: [] })),
    archiveGeneration: currentArchiveGeneration(),
}) }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
cookieState.cookies.set('mediflow_session', authority.session.id);
cookieState.cookies.set('ambulatory_id', 'scope');
const authorizeCommit = await prepareNetworkPatientCommitGuard(authority, paired.NETWORK_AMBULATORY_WRITE_CAPABILITY);
const networkContext = { ...authority, authorizeCommit };
const session: ServerSession = { id: `synthetic-race-web-${surface}-${operation}-${process.pid}`, userId: 'synthetic-race-operator', username: 'synthetic-race-operator',
    role: 'admin', authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
bindSyntheticArchiveSessions(session.id);
const context = { request: new Request('http://127.0.0.1/api/ambulatories'), session };
let writerHeld = false;
if (gate) {
    if (dirname(gate) !== resolve(process.env.MEDIFLOW_DATA_DIR)) throw new Error('Synthetic gate must stay in the owned archive');
    dbServer.$client.function('synthetic_hold_writer', () => {
        writerHeld = true;
        process.stdout.write('HELD\n');
        const deadline = Date.now() + 10_000;
        const signal = new Int32Array(new SharedArrayBuffer(4));
        while (!existsSync(gate)) {
            if (Date.now() >= deadline) throw new Error('Synthetic writer barrier timed out');
            Atomics.wait(signal, 0, 0, 5);
        }
        return 1;
    });
    const event = operation === 'create' ? 'INSERT' : 'DELETE';
    const predicate = operation === 'create' ? "NEW.id='race-child'" : "OLD.id='a'";
    dbServer.$client.exec(`CREATE TEMP TRIGGER synthetic_writer_barrier BEFORE ${event} ON ambulatories WHEN ${predicate} BEGIN SELECT synthetic_hold_writer(); END`);
}
process.stdout.write('READY\n');
process.stdin.setEncoding('utf8');
const [input] = await once(process.stdin, 'data');
if (String(input).trim() !== 'GO') throw new Error('Synthetic barrier denied');
process.stdout.write('ATTEMPT\n');
const body = { id: 'race-child', name: 'Synthetic child', parentId: 'a' };
try {
    const result = surface === 'paired'
        ? operation === 'create' ? host.createAmbulatory(networkContext, body, 'network')
            : host.deleteAmbulatory(networkContext, 'a', 1, 'network')
        : operation === 'create' ? host.createAmbulatory(context, body) : host.deleteAmbulatory(context, 'a', 1);
    clearAllSessions(); cleanup(); dbServer.$client.close();
    process.stdout.write(`RESULT ${JSON.stringify({ ...result, pid: process.pid, writerHeld })}\n`);
} catch (error) {
    clearAllSessions(); cleanup(); dbServer.$client.close();
    throw error;
}
