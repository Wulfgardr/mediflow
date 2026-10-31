import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createNativeServerSession, captureNativeLoginSessionFence } from './security/server-session';
import { ambulatories } from './schema.ts';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture.ts';
import type { PatientDocumentCreateHost } from './patient-document-create-command.ts';

const [mode, scope, commandId, foreign='same', phase='in-flight'] = process.argv.slice(2);
const data = process.env.MEDIFLOW_DATA_DIR;
if (!data || !scope) throw new Error('Synthetic process fixture requires an isolated archive');
const load = createRequire(import.meta.url);
const cookies = { cookies: new Map([['ambulatory_id', scope]]) };
const cleanup = installNetworkPatientCookieFixture(data, cookies);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server.ts'); openDbServer();
const { createPatientDocumentCommandService } = load('./patient-document-create-command.ts') as typeof import('./patient-document-create-command.ts');
const { prepareNetworkPatientCommitGuard } = load('./network-patient-commit-authority.ts') as typeof import('./network-patient-commit-authority.ts');
const { currentArchiveGeneration } = load('./security/archive-session-generation.ts') as typeof import('./security/archive-session-generation.ts');
const { serverSessions } = load('./security/web-auth-lifecycle-owner-adapter.ts') as typeof import('./security/web-auth-lifecycle-owner-adapter.ts');
if (!dbServer.select().from(ambulatories).where(eq(ambulatories.id, scope)).get()) dbServer.insert(ambulatories).values({ id: scope, name: 'Synthetic process scope' }).run();
const foreignUsername = ['synthetic', 'foreign', 'operator'].join('-');
if(mode==='revoke' && foreign==='operator') dbServer.$client.prepare("INSERT OR IGNORE INTO users (id,username,role,password_hash,encrypted_master_key,salt) VALUES ('foreign-review-operator',?,'admin','synthetic','synthetic','synthetic')").run(foreignUsername);
const pairingKey=load('./network-pairing-model.ts').NETWORK_PAIRING_STATE_KEY;
const savedPairing = dbServer.$client.prepare('SELECT value FROM settings WHERE key=?').get(pairingKey) as { value: string } | undefined;
const context = syntheticNetworkPatientAuthority(dbServer, scope, {clientId:mode==='revoke' && foreign==='device'?'foreign-review-device':undefined,userId:mode==='revoke' && foreign==='operator'?'foreign-review-operator':undefined});
if(mode==='revoke' && foreign==='operator') {
 context.session=createNativeServerSession({id:'foreign-review-operator',username:foreignUsername,role:'admin'},{clientId:context.pairedClient.clientId,clientPlatform:context.pairedClient.clientPlatform,tokenHash:context.pairedClient.tokenHash},captureNativeLoginSessionFence());
 load('./security/archive-session-generation.ts').bindSessionToArchive(context.session,currentArchiveGeneration());
}
const guard = await prepareNetworkPatientCommitGuard(context, 'network.replica.write-patient-profile');
const host: PatientDocumentCreateHost = { session: context.session, actorRef: context.session.userId,
    archiveGeneration: currentArchiveGeneration(), ambulatoryId: scope, epoch: 0, surface: 'native', pairedClientId:context.pairedClient.clientId,
    assertCurrent: tx => { if (guard(tx)) throw new Error('Owner denied'); },
    confirm: async () => true,
    retain: dispose => {
        const port = serverSessions.mintNativeSessionResourcePort(context.session); if (!port) throw new Error('No session');
        const registration = serverSessions.registerNativeSessionPrivateResource(port, dispose); if (!registration) throw new Error('No registration');
        return () => { serverSessions.unregisterNativeSessionPrivateResource(port, registration); serverSessions.releaseNativeSessionResourcePort(port); };
    },
};

const api=createPatientDocumentCommandService(dbServer);
const counts = () => Object.fromEntries((dbServer.$client.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
    .map(({ name }) => [name, (dbServer.$client.prepare(`SELECT count(*) n FROM "${name.replaceAll('"', '""')}"`).get() as { n: number }).n]));
if(mode==='revoke') {
 const before=counts(); let receipt,revoked,error;
 try { receipt=api.receipt(host,commandId); revoked=api.revoke(host,commandId); } catch(e) {error=(e as Error).message;}
 console.log(JSON.stringify({before,after:counts(),receipt,revoked,error}));
 if(savedPairing) dbServer.$client.prepare('UPDATE settings SET value=? WHERE key=?').run(savedPairing.value,pairingKey);
} else {
 const source={sourceId:randomUUID(),name:'ENC:bmFtZQ==:bmFtZQ==',path:'ENC:cGF0aA==:cGF0aA==',data:'ENC:c291cmNl:c291cmNl',type:'application/pdf' as const,size:512,identity:'ambiguous' as const,quality:'ready' as const,candidates:{}};
 const view=api.open(host,{session:host.session,ambulatoryId:scope,readCurrent:()=>source});
 api.preview(host,view.viewId,{firstName:{action:'correct',value:'Mario'},lastName:{action:'correct',value:randomUUID()},taxCode:{action:'correct',value:randomUUID()},duplicate:'none'});
 let resume!: () => void;
 const running = phase === 'in-flight' ? api.execute({...host, confirm: () => new Promise<boolean>(resolve => {resume=()=>resolve(true)})}, view.commandId, 'synthetic-confirmation') : undefined;
 const childData = foreign === 'archive' ? mkdtempSync(join(tmpdir(), 'mediflow-foreign-archive-')) : data;
 const child=spawnSync(process.execPath,[...process.execArgv,process.argv[1],'revoke',foreign==='scope'?randomUUID():scope,foreign==='invented'?randomUUID():view.commandId,foreign],{
    env:{...process.env, MEDIFLOW_DATA_DIR: childData}, encoding:'utf8', timeout:30_000, killSignal:'SIGKILL',
 });
 if (running) resume();
 const executed = await (running ?? api.execute(host,view.commandId,'synthetic-confirmation'));
 const receipt = api.receipt(host,view.commandId);
 const replay = await api.execute(host,view.commandId,'synthetic-confirmation');
 console.log(JSON.stringify({scenario:foreign, child:{code:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr},executed,receipt,replay}));
}
cleanup();dbServer.$client.close();
