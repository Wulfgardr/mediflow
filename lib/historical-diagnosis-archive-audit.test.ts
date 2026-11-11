import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { encryptData, generateMasterKey, wrapMasterKeyVersioned } from './security/security';
import { createUnlockWrapping } from './security/unlock-credential';
import { runHistoricalDiagnosisArchiveAudit } from './historical-diagnosis-archive-audit';

const PIN = '2468';
const WRONG_PIN = '0000';
const PASSPHRASE = 'cavallo batteria graffetta sintetica';

type Wrapping = 'v1' | 'v2' | 'v3';
const SECRET: Record<Wrapping, string> = { v1: PIN, v2: PIN, v3: PASSPHRASE };

function digest(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshot(dir: string): Record<string, string> {
    return Object.fromEntries(fs.readdirSync(dir).sort().map((name) => [name, digest(path.join(dir, name))]));
}

function insights(rawMarkdown: string, diagnoses: { code: string; description: string }[]) {
    return [{ id: crypto.randomUUID(), date: '2026-01-10T09:00:00.000Z', fileName: 'lettera-sintetica.pdf', rawMarkdown, summary: '',
        extractedData: { diagnoses: diagnoses.map((item) => ({ system: 'ICD-10', ...item })) } }];
}

/** Archivio sintetico cifrato come quello reale; l'ultima riga resta nel WAL, con la connessione aperta. */
async function syntheticArchive(wrapping: Wrapping = 'v1') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wul831-archivio-'));
    const archiveDir = path.join(root, 'MediFlow');
    const workParent = path.join(root, 'lavoro');
    fs.mkdirSync(archiveDir);
    fs.mkdirSync(workParent);
    const dbPath = path.join(archiveDir, 'medical.db');
    const key = await generateMasterKey();
    const salt = crypto.randomBytes(16);
    const seal = async (value: unknown) => { const sealed = await encryptData(value, key); return `ENC:${sealed.iv}:${sealed.data}`; };

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('wal_autocheckpoint = 0');
    db.exec(`create table users (id text primary key, encrypted_master_key text, salt text, created_at integer);
        create table patients (id text primary key, first_name text, last_name text, document_insights text);`);
    // v1 e v2 avvolgono la chiave con il PIN, v3 con la passphrase (ADR 0143), con il salt in users.salt.
    const user = wrapping === 'v3'
        ? await createUnlockWrapping(key, PASSPHRASE)
        : { encryptedMasterKey: await wrapMasterKeyVersioned(key, PIN, salt, wrapping === 'v1' ? 1 : 2), salt: salt.toString('base64') };
    assert.ok(user.encryptedMasterKey.startsWith(`${wrapping}:`) || wrapping === 'v1');
    db.prepare('insert into users values (?, ?, ?, ?)').run('u1', user.encryptedMasterKey, user.salt, 1);
    const insert = db.prepare('insert into patients values (?, ?, ?, ?)');
    insert.run('p-a', 'Prova', 'Sintetica', await seal(insights(
        'Diagnosi: riacutizzazione di BPCO in paziente con ipertensione arteriosa. Ecocardiogramma nei limiti.',
        [{ code: 'J44.1', description: 'Broncopneumopatia cronica ostruttiva con riacutizzazione' }, { code: 'I50.1', description: 'Insufficienza ventricolare sinistra' }],
    )));
    insert.run('p-b', 'Seconda', 'Finta', await seal(insights('   ', [{ code: 'E11.9', description: 'Diabete mellito tipo 2' }])));
    insert.run('p-c', 'Terza', 'Finta', 'ENC:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==');
    insert.run('p-vuoto', 'Quarta', 'Finta', '[]');
    db.prepare('insert into patients values (?, ?, ?, ?)').run('p-wal', 'Solo', 'NelWal', JSON.stringify(insights(
        'Ipertensione arteriosa essenziale in terapia.', [{ code: 'I10', description: 'Ipertensione essenziale' }],
    )));
    assert.ok(fs.existsSync(`${dbPath}-wal`), 'il WAL sintetico deve esistere');
    return { root, archiveDir, workParent, dbPath, close: () => db.close() };
}

for (const wrapping of ['v2', 'v3'] as const) test(`controlla le diagnosi di un archivio cifrato (chiave ${wrapping}) senza toccarlo e tiene i nomi fuori dal risultato`, async () => {
    const archive = await syntheticArchive(wrapping);
    try {
        const before = snapshot(archive.archiveDir);
        const privateOut = path.join(archive.root, 'elenco-privato.md');
        const result = await runHistoricalDiagnosisArchiveAudit({ dbPath: archive.dbPath, secret: SECRET[wrapping], privateOut, workParent: archive.workParent, driver: Database });

        assert.deepEqual(snapshot(archive.archiveDir), before, 'archivio, WAL e SHM identici byte per byte');
        assert.equal(result.fingerprintsUnchanged, true);
        assert.deepEqual(result.fingerprintsBefore.map((item) => path.basename(item.file)), ['medical.db', 'medical.db-wal', 'medical.db-shm']);
        assert.equal(result.copyRemoved, true);
        assert.deepEqual(fs.readdirSync(archive.workParent), [], 'la copia è cancellata');

        assert.equal(result.patientsWithInsights, 4);
        assert.equal(result.undecryptable, 1);
        assert.equal(result.totals.diagnoses, 4);
        assert.equal(result.totals.explicit, 2, 'J44.1 dalla descrizione, I10 dal WAL');
        assert.equal(result.totals.none, 1);
        assert.equal(result.totals.noText, 1);
        assert.equal(result.totals.patientsWithNone, 1);

        const printed = JSON.stringify(result);
        for (const secret of ['Sintetica', 'Prova', 'I50.1', 'Insufficienza', 'lettera-sintetica']) {
            assert.equal(printed.includes(secret), false, `il risultato non contiene «${secret}»`);
        }

        assert.equal(fs.statSync(privateOut).mode & 0o777, 0o600);
        const list = fs.readFileSync(privateOut, 'utf8');
        const missing = list.split('## Riscontro parziale')[0];
        assert.match(missing, /\| Sintetica Prova \| p-a \| lettera-sintetica\.pdf \| ICD-10 \| I50\.1 \| Insufficienza ventricolare sinistra \|/u);
        assert.equal(missing.includes('J44.1'), false);
        assert.match(list.split('## Documento senza testo')[1], /E11\.9/u);
    } finally {
        archive.close();
        fs.rmSync(archive.root, { recursive: true, force: true });
    }
});

test('con il PIN sbagliato si ferma, non scrive l\'elenco e cancella la copia', async () => {
    const archive = await syntheticArchive();
    try {
        const before = snapshot(archive.archiveDir);
        const privateOut = path.join(archive.root, 'elenco-privato.md');
        await assert.rejects(
            runHistoricalDiagnosisArchiveAudit({ dbPath: archive.dbPath, secret: WRONG_PIN, privateOut, workParent: archive.workParent, driver: Database }),
            /PIN non valido/u,
        );
        assert.equal(fs.existsSync(privateOut), false);
        assert.deepEqual(fs.readdirSync(archive.workParent), []);
        assert.deepEqual(snapshot(archive.archiveDir), before);
    } finally {
        archive.close();
        fs.rmSync(archive.root, { recursive: true, force: true });
    }
});

test('con la passphrase sbagliata su una chiave v3 dice passphrase, non PIN', async () => {
    const archive = await syntheticArchive('v3');
    try {
        const privateOut = path.join(archive.root, 'elenco-privato.md');
        await assert.rejects(
            runHistoricalDiagnosisArchiveAudit({ dbPath: archive.dbPath, secret: `${PASSPHRASE} errata`, privateOut, workParent: archive.workParent, driver: Database }),
            /^Error: Passphrase non valida per questo archivio \(chiave in versione 3: serve la passphrase\)\.$/u,
        );
        // Il PIN su una chiave a passphrase non apre nulla e non si scambia per un PIN sbagliato.
        await assert.rejects(
            runHistoricalDiagnosisArchiveAudit({ dbPath: archive.dbPath, secret: PIN, privateOut, workParent: archive.workParent, driver: Database }),
            /serve la passphrase/u,
        );
        assert.equal(fs.existsSync(privateOut), false);
        assert.deepEqual(fs.readdirSync(archive.workParent), []);
    } finally {
        archive.close();
        fs.rmSync(archive.root, { recursive: true, force: true });
    }
});

test('una versione di avvolgimento sconosciuta si dichiara tale, non come segreto sbagliato', async () => {
    const archive = await syntheticArchive();
    try {
        const changed = path.join(archive.root, 'versione-sconosciuta.db');
        const writer = new Database(changed);
        writer.exec(`create table users (id text, encrypted_master_key text, salt text, created_at integer);
            create table patients (id text, first_name text, last_name text, document_insights text);`);
        writer.prepare('insert into users values (?, ?, ?, ?)').run('u1', 'v9:AAAA', crypto.randomBytes(16).toString('base64'), 1);
        writer.close();
        await assert.rejects(
            runHistoricalDiagnosisArchiveAudit({ dbPath: changed, secret: PIN, privateOut: path.join(archive.root, 'elenco.md'), workParent: archive.workParent, driver: Database }),
            /^Error: Versione di avvolgimento della chiave non supportata: 9\.$/u,
        );
        assert.deepEqual(fs.readdirSync(archive.workParent), []);
    } finally {
        archive.close();
        fs.rmSync(archive.root, { recursive: true, force: true });
    }
});

test('non sovrascrive un elenco privato già presente', async () => {
    const archive = await syntheticArchive();
    try {
        const privateOut = path.join(archive.root, 'elenco-privato.md');
        fs.writeFileSync(privateOut, 'precedente', { mode: 0o600 });
        await assert.rejects(
            runHistoricalDiagnosisArchiveAudit({ dbPath: archive.dbPath, secret: PIN, privateOut, workParent: archive.workParent, driver: Database }),
            /esiste già/u,
        );
        assert.equal(fs.readFileSync(privateOut, 'utf8'), 'precedente');
        assert.deepEqual(fs.readdirSync(archive.workParent), []);
    } finally {
        archive.close();
        fs.rmSync(archive.root, { recursive: true, force: true });
    }
});
