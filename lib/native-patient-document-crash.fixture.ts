import { createRequire } from 'node:module';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { sealPatientDocumentFile } from './security/attachment-file-envelope';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { ambulatories, settings, users } from './schema';
import { NETWORK_PAIRING_STATE_KEY } from './network-pairing-model';
import type { PatientDocumentCreateReview } from './patient-document-create-command';

const data = process.env.MEDIFLOW_DATA_DIR!;
process.env.MEDIFLOW_DATA_DIR = data;
const nodeRequire = createRequire(import.meta.url), cookies = { cookies: new Map<string, string>() };
const cleanup = installNetworkPatientCookieFixture(data, cookies);
const { dbServer, openDbServer } = nodeRequire('./db-server.ts') as typeof import('./db-server.ts'); openDbServer();
const { createNativePatientDocumentService } = nodeRequire('./native-patient-document.ts') as typeof import('./native-patient-document.ts');
const { POST } = nodeRequire('../app/api/auth/native/patient-document/route.ts') as typeof import('../app/api/auth/native/patient-document/route.ts');
const master = randomBytes(32), pin = ['2', '4', '6', '8'].join('');
function seal(value: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', master, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]);
    return `ENC:${iv.toString('base64')}:${data.toString('base64')}`;
}
async function file(bytes: Buffer) {
    const key = await crypto.subtle.importKey('raw', master, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return sealPatientDocumentFile(new Uint8Array(bytes), key);
}
async function document(text = 'Nome: Mario\nCognome: Rossi\nDocumento inventato per la prova') {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText(text, { font, size: 12, x: 40, y: 700 });
    const bytes = Buffer.from(await pdf.save());
    return { name: seal('sintetico.pdf'), path: seal('sintetico.pdf'), original: bytes.toString('base64'),
        ...await file(bytes) };
}
function fixture(scope: string = randomUUID(), options: Parameters<typeof syntheticNetworkPatientAuthority>[2] = {}) {
    dbServer.insert(ambulatories).values({ id: scope, name: 'Ambulatorio inventato', isDefault: true }).onConflictDoNothing().run();
    const context = syntheticNetworkPatientAuthority(dbServer, scope, options);
    context.pairedClient.grantedCapabilities.push('network.replica.write-documents', 'network.replica.readonly-documents');
    const row = dbServer.select().from(settings).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).get()!;
    const state = JSON.parse(row.value!); state.clients[0].grantedCapabilities = context.pairedClient.grantedCapabilities;
    dbServer.update(settings).set({ value: JSON.stringify(state) }).where(eq(settings.key, row.key)).run();
    cookies.cookies.set('ambulatory_id', scope); cookies.cookies.set('mediflow_session', context.session.id);
    dbServer.update(users).set({ passwordHash: bcrypt.hashSync(pin, 4), failedLoginAttempts: 0, firstFailedLoginAt: null, lockedUntil: null })
        .where(eq(users.id, context.session.userId)).run();
    return context;
}
function review(): PatientDocumentCreateReview {
    return { firstName: { action: 'correct', value: 'Mario' }, lastName: { action: 'correct', value: randomUUID() },
        taxCode: { action: 'correct', value: randomUUID() }, duplicate: 'none' };
}
function effects() {
    return ['patients', 'patients_to_ambulatories', 'attachments'].map(table =>
        (dbServer.$client.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n);
}
const [mode,scope,commandId]=process.argv.slice(2);
const context=fixture(scope), api=createNativePatientDocumentService(dbServer);
if(mode==='receipt') {
 const before=effects(), receipt=await api.receipt(context,commandId), revoked=await api.revoke(context,commandId);
 const again=await api.revoke(context,commandId);
 let executeDenied=false;try { await api.execute(context,commandId,pin); } catch { executeDenied=true; }
 const afterRetirement=effects();
 const next=await api.stage(context,await document());
 await api.preview(context,next.commandId,next.viewId,review());
 const created=await api.execute(context,next.commandId,pin);
 console.log(JSON.stringify({receipt,revoked,again,before,afterRetirement,after:effects(),executeDenied,created}));
} else {
 const view=await api.stage(context,await document());
 await api.preview(context,view.commandId,view.viewId,review());
 console.log(JSON.stringify({commandId:view.commandId,before:effects()}));
 dbServer.$client.function('synthetic_native_crash',()=>process.kill(process.pid,'SIGKILL'));
 dbServer.$client.exec("CREATE TEMP TRIGGER synthetic_native_crash BEFORE INSERT ON audit_events WHEN NEW.event_type = 'patient.create.retired' BEGIN SELECT synthetic_native_crash(); END;");
 await api.execute(context,view.commandId,'0000');
}
cleanup();dbServer.$client.close();
