// Giro completo 0.9.0 → candidato → ritorno alla 0.9.0, solo dati inventati. Usa il codice
// del candidato (questo repository) e quello del tag v0.9.0 (un checkout con le sue
// dipendenze), per questo non gira nella CI. La cartella dati di partenza la scrive il tag
// al momento, con produce-fixture.mjs: è un medical.db vero della 0.9.0, in modalità WAL.
//
// Uso (Node 24, dalla radice di questo repository):
//   node --import ./scripts/register-strip-types-loader.mjs \
//     scripts/archive-v090/return-to-v090.mjs <checkout-v0.9.0>
// Lavora in una cartella temporanea propria e la cancella alla fine; esce con codice 1
// alla prima verifica che non regge. Ogni passo gira in un processo separato con il
// loader del proprio albero: gli alias @/ del codice del tag devono risolvere nel tag.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const [tagArgument, role, step, work] = process.argv.slice(2);
if (!tagArgument) throw new Error('Uso: return-to-v090.mjs <checkout-v0.9.0>');
const tag = path.resolve(tagArgument);
const self = new URL(import.meta.url).pathname;
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const committedFixture = path.join(repo, 'lib/fixtures/archive-v090');
// Children receive the folder of the fixture.json (and backup) that matches their archive.
const fixtureRoot = process.env.ARCHIVE_V090_FIXTURE ?? committedFixture;
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'fixture.json'), 'utf8'));
const fromTag = (file) => import(pathToFileURL(path.join(tag, file)).href);
const fromCandidate = (file) => import(pathToFileURL(path.join(repo, file)).href);
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function must(condition, message) { if (!condition) throw new Error(`VERIFICA FALLITA: ${message}`); }
const log = (step, detail) => console.log(`${step}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);

must(JSON.parse(fs.readFileSync(path.join(tag, 'package.json'), 'utf8')).version === '0.9.0', 'il checkout indicato non è la 0.9.0');
const code = role === 'tag' ? {
    open: (await fromTag('lib/sqlite-schema-open.ts')).openVersionedSqliteDatabase,
    restore: (await fromTag('lib/recovery-backup-server.ts')).restoreRecoveryBackup,
    unlock: await fromTag('lib/security/unlock-credential.ts'),
    security: await fromTag('lib/security/security.ts'),
} : role === 'candidate' ? {
    open: (await fromCandidate('lib/sqlite-schema-open.ts')).openVersionedSqliteDatabase,
    version: (await fromCandidate('lib/sqlite-schema-open.ts')).CURRENT_SQLITE_SCHEMA_VERSION,
    unlock: await fromCandidate('lib/security/unlock-credential.ts'),
    security: await fromCandidate('lib/security/security.ts'),
} : undefined;

// Unlock as a user would: with the passphrase, through this process's own code.
async function masterKeyByPassphrase(db) {
    const user = db.prepare('SELECT salt, encrypted_master_key, unlock_verifier_hash FROM users WHERE username=?').get(fixture.kit.username);
    const unlock = await code.unlock.deriveUnlockMaterial(fixture.passphrase, new Uint8Array(Buffer.from(user.salt, 'base64')));
    must(await code.unlock.hashAccessVerifier(unlock.verifier) === user.unlock_verifier_hash, 'la passphrase originale non apre più l\'account');
    return code.unlock.openUnlockWrapping(user.encrypted_master_key, unlock.kek);
}
const unseal = (key, value) => { const [, iv, data] = String(value).split(':'); return code.security.decryptData(data, iv, key); };
const seal = async (key, text) => { const v = await code.security.encryptData(text, key); return `ENC:${v.iv}:${v.data}`; };

// What the 0.9.0 must find in an archive it opens again.
async function checkOriginalArchive(label, db) {
    must(db.pragma('user_version', { simple: true }) === 3, `${label}: schema 3`);
    must(db.pragma('integrity_check', { simple: true }) === 'ok', `${label}: integrità`);
    const patients = db.prepare('SELECT id, notes FROM patients ORDER BY id').all();
    must(JSON.stringify(patients.map(row => row.id)) === JSON.stringify(['v090-deleted', 'v090-patient', 'v090-stp']), `${label}: pazienti originali`);
    const key = await masterKeyByPassphrase(db);
    must(await unseal(key, patients.find(row => row.id === 'v090-patient').notes) === fixture.noteText, `${label}: nota decifrata`);
    const attachments = db.prepare('SELECT id, data FROM attachments ORDER BY id').all();
    must(attachments.length === 1 && await unseal(key, attachments[0].data) === fixture.attachmentText, `${label}: allegato decifrato`);
    const audit = db.prepare('SELECT event_id FROM audit_events ORDER BY event_id').pluck().all();
    must(audit.includes('v090-audit'), `${label}: evento di audit originale`);
    let appendOnly = false;
    try { db.prepare('DELETE FROM audit_events').run(); } catch (error) { appendOnly = /append-only/.test(String(error)); }
    must(appendOnly, `${label}: audit ancora append-only`);
    must(db.prepare('SELECT count(*) FROM prosthetics_catalog_receipts').pluck().get() === 1, `${label}: ricevuta del catalogo`);
    must(db.prepare("SELECT count(*) FROM settings WHERE key LIKE 'archive.restore.receipt.%'").pluck().get() === 2, `${label}: ricevute di ripristino`);
    const written = db.prepare("SELECT count(*) FROM entries WHERE id LIKE 'candidate-%'").pluck().get()
        + db.prepare("SELECT count(*) FROM attachments WHERE id LIKE 'candidate-%'").pluck().get();
    return { patients: patients.length, attachments: attachments.length, auditEvents: audit.length, writtenByCandidate: written };
}

const steps = {
    // 1. The candidate upgrades in place, then writes a new note and a new attachment.
    async upgradeAndWrite(data) {
        const db = code.open(path.join(data, 'medical.db'));
        try {
            must(db.pragma('user_version', { simple: true }) === code.version, 'il candidato porta allo schema corrente');
            const key = await masterKeyByPassphrase(db);
            const attachmentText = Buffer.from('%PDF-1.4\nAllegato scritto dal candidato\n%%EOF').toString('base64');
            db.prepare("INSERT INTO attachments(id,patient_id,name,type,size,path,data,document_source_ref,document_revision,document_freshness_epoch) VALUES ('candidate-attachment','v090-patient','nuovo.pdf','application/pdf',?,'',?,?,1,1)")
                .run(Buffer.from(attachmentText, 'base64').length, await seal(key, attachmentText), 'b'.repeat(64));
            db.prepare("INSERT INTO entries(id,patient_id,type,date,content,attachments,version) VALUES ('candidate-entry','v090-patient','note',1790000000,?,?,1)")
                .run(await seal(key, 'Nota scritta dal candidato'), JSON.stringify(['candidate-attachment']));
            must(await unseal(key, db.prepare("SELECT content FROM entries WHERE id='candidate-entry'").pluck().get()) === 'Nota scritta dal candidato', 'nota del candidato');
            return { schema: db.pragma('user_version', { simple: true }), written: ['candidate-entry', 'candidate-attachment'] };
        } finally { db.close(); }
    },
    // 2. The 0.9.0 refuses the schema 11 archive.
    async refuseCurrent(data) {
        try { code.open(path.join(data, 'medical.db')).close(); } catch (error) { return { refused: `${error.name}: ${error.message}` }; }
        throw new Error('VERIFICA FALLITA: la 0.9.0 ha aperto lo schema corrente');
    },
    // 3 and 4. The 0.9.0 opens an archive it wrote (the original copy, or its own restored backup).
    async openOriginal(data) {
        const db = code.open(path.join(data, 'medical.db'));
        try { return await checkOriginalArchive(path.basename(data), db); } finally { db.close(); }
    },
    async journalMode(data) {
        const db = code.open(path.join(data, 'medical.db'));
        try { return { schema: db.pragma('user_version', { simple: true }), journalMode: db.pragma('journal_mode', { simple: true }) }; } finally { db.close(); }
    },
    async restoreOwnBackup(data) {
        const result = await code.restore({ artifact: fs.readFileSync(path.join(fixtureRoot, 'backup-v090.mediflow-recovery')), kit: fixture.kit,
            recoveryKey: fixture.recoveryKey, destination: path.join(data, 'medical.db') });
        return { username: result.username };
    },
};

if (role) {
    // Child: one step with one tree's code.
    const result = await steps[step](work);
    process.stdout.write(JSON.stringify(result));
} else {
    const loader = { tag: path.join(tag, 'scripts/register-strip-types-loader.mjs'), candidate: path.join(repo, 'scripts/register-strip-types-loader.mjs') };
    let produced = '';
    const run = (who, name, data, fixtureFolder = produced) => {
        const child = spawnSync(process.execPath, ['--import', pathToFileURL(loader[who]).href, self, tag, who, name, data],
            { cwd: who === 'tag' ? tag : repo, encoding: 'utf8', timeout: 120_000, env: { ...process.env, ARCHIVE_V090_FIXTURE: fixtureFolder } });
        if (child.status !== 0) throw new Error(`${who}/${name} fallito:\n${child.stderr}`);
        return JSON.parse(child.stdout.trim().split('\n').at(-1));
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-return-to-v090-'));
    try {
        // 0. The tag writes a fresh 0.9.0 data folder and its full encrypted backup.
        produced = path.join(root, 'prodotto-dal-tag');
        const producer = spawnSync(process.execPath, ['--import', pathToFileURL(loader.tag).href, path.join(repo, 'scripts/archive-v090/produce-fixture.mjs'), tag, produced],
            { cwd: tag, encoding: 'utf8', timeout: 120_000 });
        if (producer.status !== 0) throw new Error(`produttore fallito:\n${producer.stderr}`);
        const data = path.join(root, 'dati');
        fs.mkdirSync(data, { mode: 0o700 });
        const live = path.join(data, 'medical.db');
        fs.copyFileSync(path.join(produced, 'medical.db'), live);
        fs.chmodSync(live, 0o600);
        log('0. cartella dati scritta dalla 0.9.0', { sha256: sha256(live), ...run('tag', 'journalMode', data) });

        log('1. il candidato aggiorna e scrive', run('candidate', 'upgradeAndWrite', data));
        const original = fs.readdirSync(data).filter(name => name.startsWith('medical.db.schema-original-v3-'));
        must(original.length === 1, 'una sola copia schema-original-v3');
        log('1. copia lasciata dal candidato', { name: original[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/u, '<uuid>'), sha256: sha256(path.join(data, original[0])) });
        // The copy holds exactly the rows of the live 0.9.0 file (WAL), table by table.
        const compare = path.join(root, 'confronto');
        fs.mkdirSync(compare);
        fs.copyFileSync(path.join(produced, 'medical.db'), path.join(compare, 'partenza.db'));
        fs.copyFileSync(path.join(data, original[0]), path.join(compare, 'copia.db'));
        const { default: Database } = await import('better-sqlite3');
        const content = file => {
            const db = new Database(file, { readonly: true });
            try {
                return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").pluck().all()
                    .map(name => [name, createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all()
                        .map(row => JSON.stringify(row)).sort())).digest('hex')]));
            } finally { db.close(); }
        };
        const start = content(path.join(compare, 'partenza.db')), copy = content(path.join(compare, 'copia.db'));
        must(JSON.stringify(start) === JSON.stringify(copy), 'la copia schema-original-v3 non ha le stesse righe della cartella di partenza');
        log('1. copia confrontata con la cartella di partenza', `${Object.keys(start).length} tabelle, contenuto identico`);

        const before = sha256(live);
        log('2. la 0.9.0 apre l\'archivio aggiornato', run('tag', 'refuseCurrent', data));
        must(sha256(live) === before, 'il rifiuto non modifica l\'archivio');
        log('2. archivio aggiornato dopo il rifiuto', 'invariato byte per byte');

        // Return: set the current archive aside, put a copy of the original in its place.
        const aside = path.join(root, 'archivio-0.9.1-messo-da-parte');
        fs.mkdirSync(aside);
        for (const name of fs.readdirSync(data).filter(name => ['medical.db', 'medical.db-wal', 'medical.db-shm'].includes(name)))
            fs.renameSync(path.join(data, name), path.join(aside, name));
        fs.copyFileSync(path.join(data, original[0]), live);
        fs.chmodSync(live, 0o600);
        log('3. la 0.9.0 riapre la copia schema-original-v3', run('tag', 'openOriginal', data));
        log('3. cartella dopo il ritorno', fs.readdirSync(data).map(name => name.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/u, '<uuid>')).sort());

        // 4. The 0.9.0 restores its own backups into empty folders: the one made before the
        // upgrade in step 0, and the one kept in the repository.
        for (const [label, folder] of [['fatto prima dell\'aggiornamento', produced], ['del repository', committedFixture]]) {
            const restored = fs.mkdtempSync(path.join(root, 'ripristino-'));
            fs.chmodSync(restored, 0o700);
            log(`4. la 0.9.0 ripristina il backup ${label}`, run('tag', 'restoreOwnBackup', restored, folder));
            log(`4. la 0.9.0 apre l'archivio ripristinato (${label})`, run('tag', 'openOriginal', restored, folder));
        }
        log('esito', 'RITORNO ALLA 0.9.0 RIUSCITO; quanto scritto con il candidato resta solo nell\'archivio messo da parte');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
