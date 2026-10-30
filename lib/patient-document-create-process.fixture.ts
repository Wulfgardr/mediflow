import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { ambulatories } from './schema';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import type { PatientDocumentCreateHost } from './patient-document-create-command';

const [mode, scope, commandId] = process.argv.slice(2);
const data = process.env.MEDIFLOW_DATA_DIR;
if (!data || !scope) throw new Error('Synthetic process fixture requires an isolated archive');
const load = createRequire(import.meta.url);
const cookies = { cookies: new Map([['ambulatory_id', scope]]) };
const cleanup = installNetworkPatientCookieFixture(data, cookies);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server'); openDbServer();
const { createPatientDocumentCommandService } = load('./patient-document-create-command.ts') as typeof import('./patient-document-create-command');
const { prepareNetworkPatientCommitGuard } = load('./network-patient-commit-authority.ts') as typeof import('./network-patient-commit-authority');
const { currentArchiveGeneration } = load('./security/archive-session-generation.ts') as typeof import('./security/archive-session-generation');
const { serverSessions } = load('./security/web-auth-lifecycle-owner-adapter.ts') as typeof import('./security/web-auth-lifecycle-owner-adapter');
if (!dbServer.select().from(ambulatories).where(eq(ambulatories.id, scope)).get()) dbServer.insert(ambulatories).values({ id: scope, name: 'Synthetic process scope' }).run();
const context = syntheticNetworkPatientAuthority(dbServer, scope);
const guard = await prepareNetworkPatientCommitGuard(context, 'network.replica.write-patient-profile');
const host: PatientDocumentCreateHost = { session: context.session, actorRef: context.session.userId,
    archiveGeneration: currentArchiveGeneration(), ambulatoryId: scope, epoch: 0, surface: 'native',
    assertCurrent: tx => { if (guard(tx)) throw new Error('Owner denied'); },
    confirm: async () => true,
    retain: dispose => {
        const port = serverSessions.mintNativeSessionResourcePort(context.session); if (!port) throw new Error('No session');
        const registration = serverSessions.registerNativeSessionPrivateResource(port, dispose); if (!registration) throw new Error('No registration');
        return () => { serverSessions.unregisterNativeSessionPrivateResource(port, registration); serverSessions.releaseNativeSessionResourcePort(port); };
    },
};
const api = createPatientDocumentCommandService(dbServer);
if (mode === 'receipt') {
    const before = dbServer.$client.prepare('SELECT count(*) n FROM patients').get();
    const result = api.receipt(host, commandId);
    if (result.outcome === 'applied') await api.execute(host, commandId, 'synthetic-confirmation');
    else {
        try { await api.execute(host, commandId, 'synthetic-confirmation'); throw new Error('Unexpected replay'); }
        catch (error) { if ((error as Error).message === 'Unexpected replay') throw error; }
    }
    const after = dbServer.$client.prepare('SELECT count(*) n FROM patients').get();
    console.log(JSON.stringify({ result, before, after }));
} else {
    const source = { sourceId: randomUUID(), name: 'ENC:bmFtZQ==:bmFtZQ==', path: 'ENC:cGF0aA==:cGF0aA==',
        data: 'ENC:c291cmNl:c291cmNl', type: 'application/pdf' as const, size: 512, identity: 'ambiguous' as const, quality: 'ready' as const, candidates: {} };
    const view = api.open(host, { session: host.session, ambulatoryId: host.ambulatoryId, readCurrent: () => source });
    api.preview(host, view.viewId, { firstName: { action: 'correct', value: 'Mario' }, lastName: { action: 'correct', value: 'Rossi' },
        taxCode: { action: 'correct', value: randomUUID() }, duplicate: 'none' });
    process.stdout.write(JSON.stringify({ commandId: view.commandId }) + '\n');
    if (mode === 'before-commit') {
        dbServer.$client.function('synthetic_crash', () => process.kill(process.pid, 'SIGKILL'));
        dbServer.$client.exec('CREATE TEMP TRIGGER synthetic_crash BEFORE INSERT ON attachments BEGIN SELECT synthetic_crash(); END;');
    }
    await api.execute(host, view.commandId, 'synthetic-confirmation');
    process.kill(process.pid, 'SIGKILL');
}
cleanup(); dbServer.$client.close();
