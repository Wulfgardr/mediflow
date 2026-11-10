// Produce, con il codice della 0.9.0 pubblicata, una cartella dati (medical.db) e il suo
// backup cifrato completo. Solo dati inventati. Nel repository vanno soltanto il backup e
// fixture.json (lib/fixtures/archive-v090): nessun database in chiaro entra nel sorgente.
//
// Uso (Node 24, dalla radice di questo repository):
//   node --import <tag>/scripts/register-strip-types-loader.mjs \
//     scripts/archive-v090/produce-fixture.mjs <tag> <cartella-di-uscita>
// dove <tag> è un checkout di v0.9.0 (9c7b3adf2) con le sue dipendenze installate.
// Le chiavi sono casuali: ogni esecuzione produce byte diversi con lo stesso contenuto.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [tagArgument, outArgument] = process.argv.slice(2);
if (!tagArgument || !outArgument) throw new Error('Uso: produce-fixture.mjs <checkout-v0.9.0> <cartella-di-uscita>');
const tag = path.resolve(tagArgument);
const out = path.resolve(outArgument);
const load = (file) => import(pathToFileURL(path.join(tag, file)).href);
function must(condition, message) { if (!condition) throw new Error(message); }

const { openVersionedSqliteDatabase } = await load('lib/sqlite-schema-open.ts');
const { createRecoverySnapshot } = await load('lib/recovery-backup-server.ts');
const { encryptRecoveryBackup } = await load('lib/recovery-backup.ts');
const { generateMasterKey, encryptData } = await load('lib/security/security.ts');
const { createUnlockWrapping, createRecoveryWrapping, hashAccessVerifier } = await load('lib/security/unlock-credential.ts');
const { createProstheticsCatalog } = await load('lib/reference-data/prosthetics-catalog-service.ts');

const packageVersion = JSON.parse(fs.readFileSync(path.join(tag, 'package.json'), 'utf8')).version;
must(packageVersion === '0.9.0', `il checkout non è la 0.9.0: ${packageVersion}`);
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
must(fs.readdirSync(out).length === 0, 'la cartella di uscita deve essere vuota');

const passphrase = 'passphrase solo sintetica 090';
const noteText = 'Nota clinica soltanto sintetica 090';
const actor = '11111111-1111-4111-8111-111111111111';
const db = openVersionedSqliteDatabase(path.join(out, 'medical.db'));
try {
    must(db.pragma('user_version', { simple: true }) === 3, 'la 0.9.0 deve creare lo schema 3');
    const key = await generateMasterKey();
    const unlock = await createUnlockWrapping(key, passphrase);
    const recovery = await createRecoveryWrapping(key);
    const kit = { schemaVersion: 'mediflow.recovery-kit.v1', username: 'synthetic-090-admin', wrappedMasterKey: recovery.wrappedMasterKey, salt: recovery.salt };
    db.prepare(`INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt,unlock_verifier_hash,recovery_wrapped_master_key,recovery_salt,recovery_verifier_hash)
        VALUES (?,?,'admin','synthetic-hash',?,?,?,?,?,?)`).run(actor, kit.username, unlock.encryptedMasterKey, unlock.salt, await hashAccessVerifier(unlock.verifier), recovery.wrappedMasterKey, recovery.salt, await hashAccessVerifier(recovery.verifier));
    const seal = async (text) => { const v = await encryptData(text, key); return `ENC:${v.iv}:${v.data}`; };
    const note = await seal(noteText);
    const attachmentText = Buffer.from('%PDF-1.4\nAllegato sintetico 090\n%%EOF').toString('base64');
    const attachment = await seal(attachmentText);
    db.exec("INSERT INTO ambulatories(id,name) VALUES ('v090-amb','Ambulatorio sintetico')");
    const patient = db.prepare('INSERT INTO patients(id,first_name,last_name,tax_code,birth_date,notes,ambulatory_id,deleted_at,version) VALUES (?,?,?,?,?,?,?,?,?)');
    patient.run('v090-patient', 'Persona', 'Sintetica', 'V090-SYNTHETIC', 631152000, note, 'v090-amb', null, 7);
    patient.run('v090-deleted', 'Persona', 'Eliminata', '', null, note, 'v090-amb', 1783000000, 4);
    patient.run('v090-stp', 'Persona', 'Temporanea', 'STP1234567890123', null, note, 'v090-amb', null, 1);
    db.exec("INSERT INTO patients_to_ambulatories(patient_id,ambulatory_id) VALUES ('v090-patient','v090-amb')");
    db.prepare("INSERT INTO attachments(id,patient_id,name,type,size,path,data,document_source_ref,document_revision,document_freshness_epoch) VALUES ('v090-attachment','v090-patient','sintetico.pdf','application/pdf',?,'',?,?,1,1)")
        .run(Buffer.from(attachmentText, 'base64').length, attachment, 'a'.repeat(64));
    db.prepare("INSERT INTO entries(id,patient_id,type,date,content,attachments,version) VALUES ('v090-entry','v090-patient','note',1783000000,?,?,8)").run(note, JSON.stringify(['v090-attachment']));
    db.prepare("INSERT INTO checkups(id,patient_id,date,title,notes,version) VALUES ('v090-checkup','v090-patient',1783000000,'Controllo sintetico',?,3)").run(note);
    db.prepare("INSERT INTO therapies(id,patient_id,drug_name,dosage,status,start_date,version) VALUES ('v090-therapy','v090-patient',?,?,'active',1783000000,6)").run('Farmaco sintetico', note);
    db.exec("INSERT INTO conversations(id,title) VALUES ('v090-conversation','Conversazione sintetica')");
    db.prepare("INSERT INTO messages(id,conversation_id,role,content,attachment_base64) VALUES ('v090-message','v090-conversation','user',?,?)").run(note, attachment);
    db.exec("INSERT INTO prosthetic_prescriptions(id,patient_id,prescribed_at,description,version) VALUES ('v090-prescription','v090-patient',1783000000,'Dispositivo sintetico',4)");
    db.exec("INSERT INTO service_prescriptions(id,patient_id,prescribed_at,service_name) VALUES ('v090-service','v090-patient',1783000000,'Prestazione sintetica')");
    db.exec("INSERT INTO service_prescription_items(id,patient_id,prescription_id,service_name) VALUES ('v090-service-item','v090-patient','v090-service','Prestazione sintetica')");
    db.exec("INSERT INTO observations(id,patient_id,code_system,code,display,unit_system,unit_code,value,observed_at) VALUES ('v090-observation','v090-patient','synthetic','v090','Misura sintetica','synthetic','unit','123',1783000000)");
    db.exec("INSERT INTO patient_retired_ids(id) VALUES ('v090-retired'); INSERT INTO patient_duplicate_intents(id) VALUES ('v090-intent')");
    const receipt = JSON.stringify({ synthetic: true, version: 1, purpose: 'archive-v090-preservation' });
    db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('archive.restore.receipt.v090-synthetic', receipt);
    db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('archive.restore.receipt.account-reset.v090-synthetic', receipt);
    db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('retention.holds', JSON.stringify([{ patientId: 'v090-patient', reason: 'synthetic hold' }]));
    const csv = Buffer.from('codice_sistema,codice,descrizione,versione,fonte,ambito,data_inizio,data_fine\r\nSistema sintetico,V090-001,Ausilio sintetico,v1,Fonte sintetica,Dimostrazione,,\r\n');
    const catalog = createProstheticsCatalog(db);
    const preview = catalog.preview(csv, 'v090-synthetic.csv', actor);
    must(preview.valid === true, 'anteprima del catalogo non valida');
    const applied = catalog.commit({ bytes: csv, sourceName: 'v090-synthetic.csv', proof: preview.proof, acceptSubset: true }, actor, () => {});
    must(applied.receipt.applied === 1, 'ricevuta del catalogo inattesa');
    db.prepare(`INSERT INTO audit_events(event_id,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface,request_id,redacted_metadata)
        VALUES ('v090-audit','patient.updated',1783000000,'success','user',?,'patient','v090-patient','web','v090-request',?)`).run(actor, JSON.stringify({ changedFields: ['notes'], resourceVersion: 7 }));
    const snapshot = createRecoverySnapshot(db, actor);
    const artifact = await encryptRecoveryBackup(snapshot, key);
    fs.writeFileSync(path.join(out, 'backup-v090.mediflow-recovery'), artifact, { mode: 0o600 });
    fs.writeFileSync(path.join(out, 'fixture.json'), JSON.stringify({ kit, recoveryKey: recovery.recoveryKey, passphrase, noteText, attachmentText }, null, 2) + '\n', { mode: 0o600 });
    const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    console.log(JSON.stringify({ schemaVersion: 3, snapshotSha256: digest(snapshot), artifactSha256: digest(artifact) }));
} finally { db.close(); }
for (const name of fs.readdirSync(out)) must(['medical.db', 'backup-v090.mediflow-recovery', 'fixture.json'].includes(name), `file inatteso: ${name}`);
