#!/usr/bin/env node
import { assertPrivateDirectory } from './windows-private-directory.mjs';
/* @Codex */
import { serializeProstheticsDocument } from '../lib/reference-data/prosthetics-catalog-backup.ts';
import { BACKUP_COLLECTIONS, serializeBackupRows } from '../lib/backup-artifact.ts';
export { serializeBackupArtifact } from '../lib/backup-artifact.ts';
import { createHash } from 'node:crypto';

import fs from 'fs';
import { backupStorageDirectory, validateBackupDestination } from './backup-destination-policy.mjs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { openAdmittedSqlite } from '../lib/sqlite-maintenance-admission.mjs';

import { normalizeRowDates } from './scheduled-backup-date-fields.mjs';

const SETTINGS_KEY = 'backupScheduler';
const BACKUP_ARTIFACT_FILE_PREFIX = 'mediflow-backup-v1-';
const BACKUP_ARTIFACT_FILE_SUFFIX = '.mediflow';
const BACKUP_ARTIFACT_TEMP_SUFFIX = '.mediflow.tmp';
const BACKUP_LOCK_FILE_NAME = '.mediflow-backup.lock';
const BACKUP_LOCK_STALE_MS = 6 * 60 * 60 * 1000;
const PATIENT_AMBULATORY_TABLE = 'patients_to_ambulatories';

/* @Codex */
const BACKUP_TABLES = {
  agentCassettes: 'agent_cassettes',
  ambulatories: 'ambulatories',
  attachments: 'attachments',
  conversations: 'conversations',
  documentDiagnosisProposals: 'document_diagnosis_proposals',
  drugs: 'drugs',
  entries: 'entries',
  entryRevisions: 'entry_revisions',
  exemptions: 'exemptions',
  exemptionImportReceipts: 'exemption_import_receipts',
  prostheticsCatalogEntries: 'prosthetics_catalog_entries',
  prostheticsCatalogReceipts: 'prosthetics_catalog_receipts',
  prostheticsCatalogSources: 'prosthetics_catalog_sources',
  prostheticsCatalogDocuments: 'prosthetics_catalog_documents',
  messages: 'messages',
  observations: 'observations',
  patients: 'patients',
  physicianReviewAttestations: 'physician_review_attestations',
  prostheticPrescriptions: 'prosthetic_prescriptions',
  serviceCatalogEntries: 'service_catalog_entries',
  servicePrescriptionItems: 'service_prescription_items',
  servicePrescriptions: 'service_prescriptions',
  sissHandoffs: 'siss_handoff_events',
  checkups: 'checkups',
  therapies: 'therapies',
  therapyStatusCommands: 'therapy_status_commands',
  ambulatoryDestructiveCommands: 'ambulatory_destructive_commands',
  auditEvents: 'audit_events',
};

function getDefaultDataDir() {
  return process.env.MEDIFLOW_DATA_DIR
    || (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
      : path.join(os.homedir(), '.mediflow'));
}

function getDefaultState() {
  return {
    version: 1,
    config: {
      enabled: false,
      hour: 2,
      minute: 0,
      destinationDir: backupStorageDirectory(path.join(getDefaultDataDir(), 'backups')),
      retentionKeepArtifacts: 14,
    },
    run: {
      lastRunAt: null,
      lastRunStatus: null,
      lastRunMessage: null,
      lastArtifactPath: null,
      lastRetentionAt: null,
      lastRetentionDeletedCount: null,
      lastRetentionDeletedBytes: null,
      lastRetentionMode: null,
    },
  };
}

function readState(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY);
  if (!row?.value) return getDefaultState();
  try {
    const parsed = JSON.parse(row.value);
    return {
      ...getDefaultState(),
      ...parsed,
      config: {
        ...getDefaultState().config,
        ...(parsed.config || {}),
        enabled: parsed.config?.enabled === true,
        destinationDir: backupStorageDirectory(parsed.config?.destinationDir || getDefaultState().config.destinationDir),
      },
      run: {
        ...getDefaultState().run,
        ...(parsed.run || {}),
      },
    };
  } catch {
    return getDefaultState();
  }
}

function classifyManagedBackupFile(name) {
  if (name.startsWith(BACKUP_ARTIFACT_FILE_PREFIX) && name.endsWith(BACKUP_ARTIFACT_TEMP_SUFFIX)) {
    return 'temp';
  }
  if (name.startsWith(BACKUP_ARTIFACT_FILE_PREFIX) && name.endsWith(BACKUP_ARTIFACT_FILE_SUFFIX)) {
    return 'artifact';
  }
  return null;
}

function listManagedBackupFiles(destinationDir) {
  if (!fs.existsSync(destinationDir)) return [];
  return fs.readdirSync(destinationDir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile()) return [];
    const kind = classifyManagedBackupFile(entry.name);
    if (!kind) return [];
    const filePath = path.join(destinationDir, entry.name);
    const stats = fs.statSync(filePath);
    return [{
      path: filePath,
      name: entry.name,
      kind,
      sizeBytes: stats.size,
      modifiedAt: Number.isFinite(stats.mtimeMs) ? stats.mtime.toISOString() : null,
      modifiedAtMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : 0,
    }];
  });
}

function readBackupLock(lockPath) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const startedAtMs = typeof lock?.startedAt === 'string' ? Date.parse(lock.startedAt) : Number.NaN;
    return {
      pid: Number.isSafeInteger(lock?.pid) && lock.pid > 0 ? lock.pid : null,
      startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null,
    };
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    return true;
  }
}

function isBackupLockActive(destinationDir, nowMs = Date.now()) {
  const lockPath = path.join(destinationDir, BACKUP_LOCK_FILE_NAME);
  try {
    const lock = readBackupLock(lockPath);
    if (!lock) return false;

    const modifiedAtMs = fs.statSync(lockPath).mtimeMs;
    const startedAtMs = lock.startedAtMs !== null && lock.startedAtMs <= nowMs
      ? lock.startedAtMs
      : modifiedAtMs;
    if (nowMs - startedAtMs >= BACKUP_LOCK_STALE_MS) return false;
    return lock.pid === null || isProcessAlive(lock.pid);
  } catch {
    return false;
  }
}

function acquireBackupLock(destinationDir) {
  const lockPath = path.join(destinationDir, BACKUP_LOCK_FILE_NAME);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        return { path: lockPath, identity: fs.fstatSync(descriptor) };
      } finally {
        fs.closeSync(descriptor);
      }
    } catch (error) {
      if (error?.code !== 'EEXIST' || isBackupLockActive(destinationDir)) {
        throw new Error('Backup automatico gia in esecuzione.');
      }
      fs.rmSync(lockPath, { force: true });
    }
  }
  throw new Error('Impossibile acquisire il lock del backup automatico.');
}

function releaseBackupLock(lock) {
  if (lock && fs.existsSync(lock.path) && sameFile(fs.lstatSync(lock.path), lock.identity)) fs.unlinkSync(lock.path);
}

// A backup holds names, identifiers and therapies in clear: only the owning account may read it.
// Artifacts written before this rule keep the mode they were created with until tightened here.
function restrictManagedBackupFiles(destinationDir) {
  if (process.platform === 'win32') return;
  for (const file of listManagedBackupFiles(destinationDir)) {
    if ((fs.statSync(file.path).mode & 0o077) !== 0) fs.chmodSync(file.path, 0o600);
  }
}

function syncBackupDirectory(directory) {
  if (process.platform === 'win32') return;
  const descriptor = fs.openSync(directory, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertBackupDirectory(directory, identity) {
  if (fs.realpathSync(directory) !== directory || !sameFile(fs.statSync(directory), identity)) {
    throw new Error('La cartella di destinazione è cambiata durante il backup. Backup non confermato.');
  }
}

function readPublishedDigest(file, ownFile) {
  const descriptor = fs.openSync(file, 'r');
  try {
    if (!sameFile(fs.fstatSync(descriptor), ownFile)) throw new Error('Il file di backup è cambiato. Backup non confermato.');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let bytesRead;
    while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } finally { fs.closeSync(descriptor); }
}

export function publishScheduledBackup(finalPath, artifact, directoryIdentity = fs.statSync(path.dirname(finalPath))) {
  const directory = path.dirname(finalPath);
  const tempPath = `${finalPath}.tmp`;
  assertPrivateDirectory(directory);
  const descriptor = fs.openSync(tempPath, 'wx', 0o600);
  const ownFile = fs.fstatSync(descriptor);
  const assertOwnFile = file => {
    if (!sameFile(fs.lstatSync(file), ownFile)) throw new Error('Il file di backup è cambiato. Backup non confermato.');
  };
  let linked = false;
  let confirmed = false;
  const removeOwnedFile = file => {
    try {
      assertBackupDirectory(directory, directoryIdentity);
      assertOwnFile(file);
    } catch { return; }
    fs.unlinkSync(file);
    syncBackupDirectory(directory);
  };
  try {
    assertBackupDirectory(directory, directoryIdentity);
    assertOwnFile(tempPath);
    const hash = createHash('sha256');
    const write = chunk => {
      fs.writeFileSync(descriptor, chunk, { encoding: 'utf8' });
      hash.update(chunk);
    };
    if (typeof artifact === 'string') write(artifact);
    else artifact(write);
    fs.fsyncSync(descriptor);
    assertBackupDirectory(directory, directoryIdentity);
    assertOwnFile(tempPath);
    fs.linkSync(tempPath, finalPath);
    linked = true;
    assertBackupDirectory(directory, directoryIdentity);
    assertOwnFile(finalPath);
    syncBackupDirectory(directory);
    if (readPublishedDigest(finalPath, ownFile) !== hash.digest('hex')) throw new Error('Backup non confermato dalla rilettura.');
    assertOwnFile(finalPath);
    assertBackupDirectory(directory, directoryIdentity);
    confirmed = true;
  } finally {
    fs.closeSync(descriptor);
    if (linked && !confirmed) removeOwnedFile(finalPath);
    removeOwnedFile(tempPath);
  }
  assertBackupDirectory(directory, directoryIdentity);
  assertOwnFile(finalPath);
}

function saveRunState(db, run) {
  db.transaction(() => {
    const current = readState(db);
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(SETTINGS_KEY, JSON.stringify({ ...current, run: { ...current.run, ...run } }));
  }).immediate();
}

function formatTimestamp(now = new Date()) {
  return now.toISOString().replaceAll(':', '-');
}

/* @Codex */
function hasTable(db, tableName) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  );
}

/* @Codex */
function toCamelKey(key) {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/* @Codex */
function normalizeRowKeys(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [toCamelKey(key), value]),
  );
}

function buildAssignedAmbulatoryIds(patient, rows) {
  const ids = new Set();
  if (typeof patient.ambulatoryId === 'string' && patient.ambulatoryId.trim().length > 0) {
    ids.add(patient.ambulatoryId);
  }
  for (const row of rows) {
    if (row.patientId === patient.id && typeof row.ambulatoryId === 'string' && row.ambulatoryId.trim().length > 0) {
      ids.add(row.ambulatoryId);
    }
  }
  return Array.from(ids).sort((left, right) => left.localeCompare(right));
}

/* @Codex */
function buildAssignedAmbulatoryMemberships(patient, rows) {
  const memberships = new Map();
  for (const row of rows) {
    if (row.patientId === patient.id && typeof row.ambulatoryId === 'string' && row.ambulatoryId.trim().length > 0) {
      memberships.set(row.ambulatoryId, row.assignedAt ?? null);
    }
  }
  if (typeof patient.ambulatoryId === 'string' && patient.ambulatoryId.trim().length > 0 && !memberships.has(patient.ambulatoryId)) {
    memberships.set(patient.ambulatoryId, patient.updatedAt ?? patient.createdAt ?? null);
  }
  return Array.from(memberships, ([ambulatoryId, assignedAt]) => ({ ambulatoryId, assignedAt }))
    .sort((left, right) => left.ambulatoryId.localeCompare(right.ambulatoryId));
}

const ROWS_BY_PATIENT = new Set(['attachments', 'documentDiagnosisProposals', 'entries', 'observations',
  'checkups', 'therapies', 'prostheticPrescriptions', 'sissHandoffs']);

function datasetRows(db) {
  const schemaVersion = db.pragma('user_version', { simple: true });
  if (!hasTable(db, 'therapy_status_commands') && (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0 || schemaVersion > 4)) throw new Error('Therapy command ledger unavailable');
  if (!hasTable(db, 'ambulatory_destructive_commands') && (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0 || schemaVersion > 5)) throw new Error('Ambulatory command ledger unavailable');
  if (!hasTable(db, 'entry_revisions') && (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0 || schemaVersion > 16)) throw new Error('Entry revision history unavailable');
  const tables = new Set(Object.values(BACKUP_TABLES).filter(table => hasTable(db, table)));
  const memberships = new Map();
  if (hasTable(db, PATIENT_AMBULATORY_TABLE)) {
    for (const raw of db.prepare(`SELECT * FROM ${PATIENT_AMBULATORY_TABLE}`).iterate()) {
      const row = normalizeRowDates(normalizeRowKeys(raw));
      let rows = memberships.get(row.patientId);
      if (!rows) memberships.set(row.patientId, rows = []);
      rows.push(row);
    }
  }

  const patientRef = foreignKey => `EXISTS (SELECT 1 FROM patients AS parent
    WHERE typeof(parent.id) = 'text' AND length(parent.id) > 0 AND parent.id = ${foreignKey})`;
  const filterFor = collection => {
    if (ROWS_BY_PATIENT.has(collection)) return tables.has('patients') ? patientRef('source.patient_id') : '0';
    if (collection === 'entryRevisions') return tables.has('entries') && tables.has('patients')
      ? `EXISTS (SELECT 1 FROM entries AS entry WHERE entry.id = source.entry_id AND ${patientRef('entry.patient_id')})` : '0';
    if (collection === 'messages') return tables.has('conversations') ? `EXISTS (SELECT 1 FROM conversations AS parent
      WHERE typeof(parent.id) = 'text' AND length(parent.id) > 0 AND parent.id = source.conversation_id)` : '0';
    return '1';
  };

  function *rows(collection) {
    const table = BACKUP_TABLES[collection];
    if (!tables.has(table)) return;
    const order = collection === 'entryRevisions' ? ' ORDER BY event_id' : '';
    for (const raw of db.prepare(`SELECT source.* FROM ${table} AS source WHERE ${filterFor(collection)}${order}`).iterate()) {
      const row = normalizeRowKeys(raw);
      if (collection === 'prostheticsCatalogDocuments') {
        yield serializeProstheticsDocument(row);
      } else if (collection === 'auditEvents' || collection === 'therapyStatusCommands' || collection === 'ambulatoryDestructiveCommands') {
        yield row;
      } else {
        const normalized = normalizeRowDates(row);
        if (collection === 'patients') {
          const assigned = memberships.get(row.id) ?? [];
          const assignedAmbulatoryIds = buildAssignedAmbulatoryIds(normalized, assigned);
          if (assignedAmbulatoryIds.length > 0) {
            normalized.assignedAmbulatoryIds = assignedAmbulatoryIds;
            normalized.assignedAmbulatoryMemberships = buildAssignedAmbulatoryMemberships(normalized, assigned);
          }
        } else if (collection === 'prostheticPrescriptions' && typeof normalized.catalogSnapshot === 'string') {
          normalized.catalogSnapshot = JSON.parse(normalized.catalogSnapshot);
        }
        yield normalized;
      }
    }
  }

  return Object.fromEntries(BACKUP_COLLECTIONS.filter(collection => collection !== 'auditEvents' || tables.has('audit_events'))
    .map(collection => [collection, { [Symbol.iterator]: () => rows(collection) }]));
}

async function main() {
  const dataDir = getDefaultDataDir();
  const dbPath = path.join(dataDir, 'medical.db');
  const forced = process.env.MEDIFLOW_BACKUP_FORCE === '1';
  let backupLock = null;
  let participant = null;
  let db = null;
  let result;

  try {
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database non trovato: ${dbPath}`);
    }

    participant = openAdmittedSqlite(dbPath, { role: 'scheduled-backup', sqliteOptions: { fileMustExist: true } });
    db = participant.database;
    const currentState = readState(db);
    const requestedDestination = process.env.MEDIFLOW_BACKUP_DEST_DIR || currentState.config.destinationDir;

    if (!currentState.config.enabled && !forced) {
      throw new Error('Backup automatico disabilitato.');
    }

    const { destination: destinationDir, directoryIdentity } = validateBackupDestination(requestedDestination, currentState.config.volumeProtectionAcknowledged, currentState.config.volumeProtectionIdentity ?? '');
    backupLock = acquireBackupLock(destinationDir);

    const createdAt = new Date();
    const fileName = `mediflow-backup-v1-${formatTimestamp(createdAt)}.mediflow`;
    const finalPath = path.join(destinationDir, fileName);
    publishScheduledBackup(finalPath, write => db.transaction(() => {
      for (const chunk of serializeBackupRows(datasetRows(db), createdAt)) write(chunk);
    })(), directoryIdentity);
    restrictManagedBackupFiles(destinationDir);
    assertBackupDirectory(destinationDir, directoryIdentity);

    saveRunState(db, {
      lastRunAt: createdAt.toISOString(),
      lastRunStatus: 'success',
      lastRunMessage: 'Backup completato.',
      lastArtifactPath: finalPath,
    });

    result = {
      ok: true,
      artifactPath: finalPath,
      createdAt: createdAt.toISOString(),
      message: 'Backup completato.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backup fallito.';
    // Admission denial must not acquire a second writer to report the error.
    // An already admitted run may finish its state update before it drains.
    if (db?.open) {
      try {
        saveRunState(db, {
          lastRunAt: new Date().toISOString(),
          lastRunStatus: 'error',
          lastRunMessage: message,
        });
      } catch {
        // best effort
      }
    }
    result = { ok: false, message };
  } finally {
    try { if (participant) await participant.close(); }
    catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : 'Chiusura database non verificata.' };
    }
    try { releaseBackupLock(backupLock); }
    catch { result = { ok: false, message: 'Pulizia lock backup non completata.' }; }
  }
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
