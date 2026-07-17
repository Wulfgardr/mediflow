#!/usr/bin/env node
/* @Codex */

import { createCipheriv, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXED_NOW_SECONDS = Date.parse('2026-07-17T08:00:00.000Z') / 1000;
const FIXTURE_KEY = Buffer.from('83c4f061bfd9c7d14fe63f7566fc0aa980b16019d8d8ab4a8ef971b52508b6db', 'hex');
const FIXTURE_USER = {
  id: 'performance-baseline-admin',
  username: 'performance-baseline',
  pin: '314159',
  passwordHash: '$2b$10$abcdefghijklmnopqrstuu/wvEjv3nXWHtp7iCXrVnXx9GxkRO/iG',
};
const DEFAULT_COUNTS = { entries: 8, observations: 6, documents: 2 };

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || (flag === '--patients' && parsed < 1)) {
    throw new Error(`${flag} richiede un intero ${flag === '--patients' ? 'positivo' : 'non negativo'}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    dataDir: null,
    patients: 200,
    entries: DEFAULT_COUNTS.entries,
    observations: DEFAULT_COUNTS.observations,
    documents: DEFAULT_COUNTS.documents,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--force') args.force = true;
    else if (flag === '--data-dir') args.dataDir = path.resolve(argv[++index] ?? '');
    else if (flag === '--patients') args.patients = parsePositiveInteger(argv[++index], flag);
    else if (flag === '--entries-per-patient') args.entries = parsePositiveInteger(argv[++index], flag);
    else if (flag === '--observations-per-patient') args.observations = parsePositiveInteger(argv[++index], flag);
    else if (flag === '--documents-per-patient') args.documents = parsePositiveInteger(argv[++index], flag);
    else throw new Error(`Argomento non riconosciuto: ${flag}`);
  }
  if (!args.dataDir) throw new Error('--data-dir e obbligatorio');
  return args;
}

function applyMigrations(db) {
  const migrationsDir = path.join(ROOT_DIR, 'drizzle');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
  db.pragma('foreign_keys = OFF');
  try {
    for (const fileName of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8')
        .replace(/^-->\s+statement-breakpoint\s*$/gm, '');
      if (sql.trim()) db.exec(sql);
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function encryptedFixture(value, identity) {
  const iv = createHash('sha256').update(`mediflow-performance:${identity}`).digest().subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', FIXTURE_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `ENC:${iv.toString('base64')}:${encrypted.toString('base64')}`;
}

function patientId(index) {
  return `perf-patient-${String(index).padStart(6, '0')}`;
}

function seedRows(db, counts) {
  const insertPatient = db.prepare(`
    INSERT INTO patients (
      id, first_name, last_name, tax_code, birth_date, address, phone, caregiver,
      diagnoses, notes, document_insights, is_adi, is_archived, version,
      ambulatory_id, created_at, updated_at
    ) VALUES (
      @id, @firstName, @lastName, @taxCode, @birthDate, @address, @phone, @caregiver,
      @diagnoses, @notes, @documentInsights, @isAdi, 0, 1,
      'performance-baseline-ambulatory', @createdAt, @updatedAt
    )
  `);
  const insertMembership = db.prepare(`
    INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id, assigned_at)
    VALUES (?, 'performance-baseline-ambulatory', ?)
  `);
  const insertEntry = db.prepare(`
    INSERT INTO entries (id, patient_id, type, title, date, content, metadata, version, created_at, updated_at)
    VALUES (@id, @patientId, @type, @title, @date, @content, @metadata, 1, @createdAt, @updatedAt)
  `);
  const insertObservation = db.prepare(`
    INSERT INTO observations (
      id, patient_id, code_system, code, display, unit_system, unit_code, value,
      notes, observed_at, source, version, created_at, updated_at
    ) VALUES (
      @id, @patientId, 'LOINC', @code, @display, 'UCUM', @unitCode, @value,
      @notes, @observedAt, 'manual', 1, @createdAt, @updatedAt
    )
  `);
  const insertDocument = db.prepare(`
    INSERT INTO attachments (
      id, patient_id, name, type, size, path, data, summary_snapshot,
      parse_evidence_artifact_snapshot, ocr_queue_state, ocr_queue_updated_at, created_at
    ) VALUES (
      @id, @patientId, @name, 'application/pdf', 4096, @path, @data, @summary,
      @evidence, 'ocr_done', @createdAt, @createdAt
    )
  `);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO users (
        id, username, display_name, ambulatory_name, role, password_hash,
        encrypted_master_key, salt, failed_login_attempts, created_at
      ) VALUES (?, ?, 'Benchmark sintetico', 'Ambulatorio benchmark', 'admin', ?,
        'fixture-wrapped-master-key-not-for-runtime', 'AAECAwQFBgcICQoLDA0ODw==', 0, ?)
    `).run(FIXTURE_USER.id, FIXTURE_USER.username, FIXTURE_USER.passwordHash, FIXED_NOW_SECONDS);
    db.prepare(`
      INSERT INTO ambulatories (id, name, type, is_default, version, created_at)
      VALUES ('performance-baseline-ambulatory', 'Ambulatorio benchmark sintetico', 'test', 1, 1, ?)
    `).run(FIXED_NOW_SECONDS);

    for (let patientIndex = 0; patientIndex < counts.patients; patientIndex += 1) {
      const id = patientId(patientIndex);
      const createdAt = FIXED_NOW_SECONDS - (counts.patients - patientIndex) * 3600;
      const identity = `patient:${patientIndex}`;
      insertPatient.run({
        id,
        firstName: `Persona${String(patientIndex).padStart(6, '0')}`,
        lastName: `Sintetica${String(patientIndex % 97).padStart(2, '0')}`,
        taxCode: `PERF${String(patientIndex).padStart(12, '0')}`,
        birthDate: FIXED_NOW_SECONDS - (40 + (patientIndex % 55)) * 365 * 86400,
        address: encryptedFixture(`Via sintetica ${patientIndex % 200}, Comune test`, `${identity}:address`),
        phone: encryptedFixture(`+3902${String(patientIndex).padStart(8, '0')}`, `${identity}:phone`),
        caregiver: encryptedFixture(`Contatto sintetico ${patientIndex}`, `${identity}:caregiver`),
        diagnoses: encryptedFixture([{ code: 'TEST-01', description: 'Condizione cronica sintetica' }], `${identity}:diagnoses`),
        notes: encryptedFixture('Nota clinica sintetica ripetibile per il benchmark locale.', `${identity}:notes`),
        documentInsights: encryptedFixture([], `${identity}:document-insights`),
        isAdi: patientIndex % 10 === 0 ? 1 : 0,
        createdAt,
        updatedAt: createdAt + 1800,
      });
      insertMembership.run(id, createdAt);

      for (let index = 0; index < counts.entries; index += 1) {
        const rowIdentity = `${identity}:entry:${index}`;
        insertEntry.run({
          id: `${id}-entry-${String(index).padStart(2, '0')}`,
          patientId: id,
          type: ['visit', 'phone', 'exam', 'note'][index % 4],
          title: encryptedFixture(`Voce clinica sintetica ${index + 1}`, `${rowIdentity}:title`),
          date: createdAt - index * 14 * 86400,
          content: encryptedFixture('Contenuto clinico sintetico con lunghezza stabile per la baseline.', `${rowIdentity}:content`),
          metadata: encryptedFixture({ source: 'performance-baseline', ordinal: index }, `${rowIdentity}:metadata`),
          createdAt,
          updatedAt: createdAt,
        });
      }

      for (let index = 0; index < counts.observations; index += 1) {
        const rowIdentity = `${identity}:observation:${index}`;
        insertObservation.run({
          id: `${id}-observation-${String(index).padStart(2, '0')}`,
          patientId: id,
          code: ['85354-9', '8867-4', '8310-5'][index % 3],
          display: ['Pressione arteriosa', 'Frequenza cardiaca', 'Temperatura corporea'][index % 3],
          unitCode: ['mm[Hg]', '/min', 'Cel'][index % 3],
          value: String(70 + ((patientIndex + index) % 60)),
          notes: encryptedFixture('Osservazione sintetica per misura ripetibile.', `${rowIdentity}:notes`),
          observedAt: createdAt - index * 30 * 86400,
          createdAt,
          updatedAt: createdAt,
        });
      }

      for (let index = 0; index < counts.documents; index += 1) {
        const rowIdentity = `${identity}:document:${index}`;
        insertDocument.run({
          id: `${id}-document-${String(index).padStart(2, '0')}`,
          patientId: id,
          name: encryptedFixture(`referto-sintetico-${index + 1}.pdf`, `${rowIdentity}:name`),
          path: encryptedFixture(`fixture/referto-sintetico-${index + 1}.pdf`, `${rowIdentity}:path`),
          data: encryptedFixture('JVBERi0xLjQKJSBmaXh0dXJlIHNpbnRldGljYQo=', `${rowIdentity}:data`),
          summary: encryptedFixture('Sintesi documentale sintetica, sempre soggetta a revisione.', `${rowIdentity}:summary`),
          evidence: encryptedFixture({ schemaVersion: 1, facts: [], source: 'synthetic' }, `${rowIdentity}:evidence`),
          createdAt: createdAt - index * 7 * 86400,
        });
      }
    }
  })();
}

export async function seedPerformanceDatabase(options) {
  fs.mkdirSync(options.dataDir, { recursive: true });
  const dbPath = path.join(options.dataDir, 'medical.db');
  if (fs.existsSync(dbPath) && !options.force) {
    throw new Error(`${dbPath} esiste gia: usa --force solo per sostituire questa fixture sintetica`);
  }
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });

  const bootstrapDb = new Database(dbPath);
  try {
    applyMigrations(bootstrapDb);
  } finally {
    bootstrapDb.close();
  }

  process.env.MEDIFLOW_DATA_DIR = options.dataDir;
  await import('@/lib/db-server');

  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    seedRows(db, options);
    db.exec('ANALYZE');
    db.pragma('wal_checkpoint(TRUNCATE)');
    return {
      schemaVersion: 'mediflow.performance_seed.v1',
      seed: 'mediflow-performance-2026-07-17',
      dataDir: options.dataDir,
      dbPath,
      patients: options.patients,
      entries: options.patients * options.entries,
      observations: options.patients * options.observations,
      documents: options.patients * options.documents,
      login: { username: FIXTURE_USER.username, pin: FIXTURE_USER.pin },
    };
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await seedPerformanceDatabase(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(`[performance-seed] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
