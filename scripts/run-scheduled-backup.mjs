#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

import { normalizeRowDates } from './scheduled-backup-date-fields.mjs';

const SETTINGS_KEY = 'backupScheduler';
const BACKUP_ARTIFACT_FORMAT = 'mediflow-backup';
const BACKUP_ARTIFACT_VERSION = 1;
const BACKUP_ARTIFACT_SCOPE = 'mediflow-web-local-backup';
const DEFAULT_BACKUP_RETENTION_KEEP_ARTIFACTS = 14;
const BACKUP_ARTIFACT_FILE_PREFIX = 'mediflow-backup-v1-';
const BACKUP_ARTIFACT_FILE_SUFFIX = '.mediflow';
const BACKUP_ARTIFACT_TEMP_SUFFIX = '.mediflow.tmp';
const BACKUP_LOCK_FILE_NAME = '.mediflow-backup.lock';
const BACKUP_LOCK_STALE_MS = 6 * 60 * 60 * 1000;
const BACKUP_TEMP_MIN_AGE_MS = 15 * 60 * 1000;
const PATIENT_AMBULATORY_TABLE = 'patients_to_ambulatories';

/* @Codex */
const BACKUP_TABLES = {
  ambulatories: 'ambulatories',
  attachments: 'attachments',
  conversations: 'conversations',
  drugs: 'drugs',
  entries: 'entries',
  exemptions: 'exemptions',
  messages: 'messages',
  observations: 'observations',
  patients: 'patients',
  prostheticPrescriptions: 'prosthetic_prescriptions',
  serviceCatalogEntries: 'service_catalog_entries',
  servicePrescriptionItems: 'service_prescription_items',
  servicePrescriptions: 'service_prescriptions',
  sissHandoffs: 'siss_handoff_events',
  checkups: 'checkups',
  therapies: 'therapies',
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
      destinationDir: path.join(getDefaultDataDir(), 'backups'),
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

function normalizeJson(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => normalizeJson(entry));
  if (value && typeof value === 'object') {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      const entry = normalizeJson(value[key]);
      if (entry !== undefined) normalized[key] = entry;
    }
    return normalized;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null) {
    return value;
  }
  return undefined;
}

function stableStringify(value) {
  return JSON.stringify(normalizeJson(value));
}

async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function serializeBackupArtifact(payload, createdAt = new Date()) {
  const payloadSnapshot = normalizeJson(payload);
  const checksum = await sha256Hex(stableStringify(payloadSnapshot));
  const recordCounts = Object.fromEntries(
    Object.keys(BACKUP_TABLES).map((collection) => [collection, payload[collection]?.length ?? 0]),
  );
  const artifact = {
    format: BACKUP_ARTIFACT_FORMAT,
    version: BACKUP_ARTIFACT_VERSION,
    manifest: {
      scope: BACKUP_ARTIFACT_SCOPE,
      createdAt: createdAt.toISOString(),
      checksumAlgorithm: 'sha256',
      checksum,
      collections: Object.keys(BACKUP_TABLES),
      recordCounts,
    },
    payload,
  };
  return JSON.stringify(normalizeJson(artifact), null, 2);
}

function clampRetentionKeepArtifacts(value, fallback = DEFAULT_BACKUP_RETENTION_KEEP_ARTIFACTS) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 365);
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

function isRecentTemp(file, nowMs = Date.now()) {
  return file.kind === 'temp' && nowMs - file.modifiedAtMs < BACKUP_TEMP_MIN_AGE_MS;
}

function readBackupLockPid(lockPath) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return Number.isSafeInteger(lock?.pid) && lock.pid > 0 ? lock.pid : null;
  } catch {
    return undefined;
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
    const lockAgeMs = nowMs - fs.statSync(lockPath).mtimeMs;
    const lockPid = readBackupLockPid(lockPath);
    if (lockPid === undefined) return false;
    if (lockPid !== null) return isProcessAlive(lockPid);
    return lockAgeMs < BACKUP_LOCK_STALE_MS;
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
      } finally {
        fs.closeSync(descriptor);
      }
      return lockPath;
    } catch (error) {
      if (error?.code !== 'EEXIST' || isBackupLockActive(destinationDir)) {
        throw new Error('Backup automatico gia in esecuzione.');
      }
      fs.rmSync(lockPath, { force: true });
    }
  }
  throw new Error('Impossibile acquisire il lock del backup automatico.');
}

function releaseBackupLock(lockPath) {
  if (lockPath) fs.rmSync(lockPath, { force: true });
}

function applyBackupRetention(config, options = {}) {
  const preservePaths = new Set((options.preservePaths ?? []).map((value) => path.resolve(value)));
  const nowMs = options.nowMs ?? Date.now();
  const activeBackupLock = !options.ignoreBackupLock && isBackupLockActive(config.destinationDir, nowMs);
  const managedFiles = listManagedBackupFiles(config.destinationDir).sort((left, right) => {
    if (left.modifiedAtMs !== right.modifiedAtMs) return right.modifiedAtMs - left.modifiedAtMs;
    return right.name.localeCompare(left.name);
  });
  const artifacts = managedFiles.filter((file) => file.kind === 'artifact');
  const orphanTemps = managedFiles
    .filter((file) => file.kind === 'temp')
    .filter((file) => !preservePaths.has(path.resolve(file.path)))
    .filter((file) => !isRecentTemp(file, nowMs))
    .filter(() => !activeBackupLock);
  const staleArtifacts = artifacts
    .slice(clampRetentionKeepArtifacts(config.retentionKeepArtifacts))
    .filter((file) => !preservePaths.has(path.resolve(file.path)));
  const items = [
    ...staleArtifacts.map((file) => ({
      path: file.path,
      kind: file.kind,
      reason: 'keep-last-n',
      sizeBytes: file.sizeBytes,
      modifiedAt: file.modifiedAt,
    })),
    ...orphanTemps.map((file) => ({
      path: file.path,
      kind: file.kind,
      reason: 'orphan-temp',
      sizeBytes: file.sizeBytes,
      modifiedAt: file.modifiedAt,
    })),
  ];
  for (const item of items) {
    if (fs.existsSync(item.path)) fs.unlinkSync(item.path);
  }
  return {
    destinationDir: config.destinationDir,
    keepArtifacts: clampRetentionKeepArtifacts(config.retentionKeepArtifacts),
    artifactCount: artifacts.length,
    orphanTempCount: orphanTemps.length,
    deleteCount: items.length,
    deleteBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    items,
    deletedCount: items.length,
    deletedBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
  };
}

function applyRetentionResultToState(current, result, mode, occurredAt = new Date()) {
  const retainedArtifactPath = current.run.lastArtifactPath
    && result.items.some((item) => item.path === current.run.lastArtifactPath)
    ? null
    : current.run.lastArtifactPath;
  return {
    ...current,
    run: {
      ...current.run,
      lastArtifactPath: retainedArtifactPath,
      lastRetentionAt: occurredAt.toISOString(),
      lastRetentionDeletedCount: result.deletedCount,
      lastRetentionDeletedBytes: result.deletedBytes,
      lastRetentionMode: mode,
    },
  };
}

function saveState(db, state) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(SETTINGS_KEY, JSON.stringify(state));
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

/* @Codex */
function filterRowsByReference(rows, foreignKey, validRefs) {
  return rows.filter((row) => typeof row?.[foreignKey] === 'string' && validRefs.has(row[foreignKey]));
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

function buildDataset(db, backupCollections) {
  return db.transaction(() => {
    const dataset = Object.fromEntries(
      backupCollections.map((collection) => [
        collection,
        hasTable(db, BACKUP_TABLES[collection])
          ? db.prepare(`SELECT * FROM ${BACKUP_TABLES[collection]}`).all().map((row) => normalizeRowDates(normalizeRowKeys(row)))
          : [],
      ]),
    );
    const patientAmbulatoryRows = hasTable(db, PATIENT_AMBULATORY_TABLE)
      ? db.prepare(`SELECT * FROM ${PATIENT_AMBULATORY_TABLE}`).all().map((row) => normalizeRowKeys(row))
      : [];
    dataset.patients = dataset.patients.map((patient) => {
      const assignedAmbulatoryIds = buildAssignedAmbulatoryIds(patient, patientAmbulatoryRows);
      return assignedAmbulatoryIds.length > 0 ? { ...patient, assignedAmbulatoryIds } : patient;
    });

    const patientIds = new Set(dataset.patients.map((row) => row.id).filter((value) => typeof value === 'string' && value.length > 0));
    const conversationIds = new Set(dataset.conversations.map((row) => row.id).filter((value) => typeof value === 'string' && value.length > 0));

    dataset.attachments = filterRowsByReference(dataset.attachments, 'patientId', patientIds);
    dataset.entries = filterRowsByReference(dataset.entries, 'patientId', patientIds);
    dataset.observations = filterRowsByReference(dataset.observations, 'patientId', patientIds);
    dataset.checkups = filterRowsByReference(dataset.checkups, 'patientId', patientIds);
    dataset.therapies = filterRowsByReference(dataset.therapies, 'patientId', patientIds);
    dataset.prostheticPrescriptions = filterRowsByReference(dataset.prostheticPrescriptions, 'patientId', patientIds);
    dataset.sissHandoffs = filterRowsByReference(dataset.sissHandoffs, 'patientId', patientIds);
    dataset.messages = filterRowsByReference(dataset.messages, 'conversationId', conversationIds);

    return dataset;
  })();
}

async function main() {
  const dataDir = getDefaultDataDir();
  const dbPath = path.join(dataDir, 'medical.db');
  const forced = process.env.MEDIFLOW_BACKUP_FORCE === '1';
  let backupLockPath = null;

  try {
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database non trovato: ${dbPath}`);
    }

    const db = new Database(dbPath, { readonly: false });
    const currentState = readState(db);
    const destinationDir = process.env.MEDIFLOW_BACKUP_DEST_DIR || currentState.config.destinationDir;

    if (!currentState.config.enabled && !forced) {
      throw new Error('Backup automatico disabilitato.');
    }

    fs.mkdirSync(destinationDir, { recursive: true });
    backupLockPath = acquireBackupLock(destinationDir);

    const createdAt = new Date();
    const payload = buildDataset(db, Object.keys(BACKUP_TABLES));
    const artifact = await serializeBackupArtifact(payload, createdAt);
    const fileName = `mediflow-backup-v1-${formatTimestamp(createdAt)}.mediflow`;
    const finalPath = path.join(destinationDir, fileName);
    const tempPath = `${finalPath}.tmp`;

    fs.writeFileSync(tempPath, artifact, 'utf8');
    fs.renameSync(tempPath, finalPath);

    const backedUpState = {
      ...currentState,
      config: {
        ...currentState.config,
        destinationDir,
      },
      run: {
        lastRunAt: createdAt.toISOString(),
        lastRunStatus: 'success',
        lastRunMessage: 'Backup completato.',
        lastArtifactPath: finalPath,
      },
    };
    const retentionResult = applyBackupRetention(
      {
        destinationDir,
        retentionKeepArtifacts: currentState.config.retentionKeepArtifacts,
      },
      { preservePaths: [finalPath], ignoreBackupLock: true },
    );
    const nextState = applyRetentionResultToState(backedUpState, retentionResult, 'auto', createdAt);
    nextState.run.lastRunMessage = retentionResult.deletedCount > 0
      ? `Backup completato. Retention: rimossi ${retentionResult.deletedCount} file.`
      : 'Backup completato.';
    saveState(db, nextState);

    console.log(JSON.stringify({
      ok: true,
      artifactPath: finalPath,
      createdAt: createdAt.toISOString(),
      message: nextState.run.lastRunMessage,
    }));
    db.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backup fallito.';
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath, { readonly: false });
      const currentState = readState(db);
      const destinationDir = process.env.MEDIFLOW_BACKUP_DEST_DIR || currentState.config.destinationDir;
      const nextState = {
        ...currentState,
        config: {
          ...currentState.config,
          destinationDir,
        },
        run: {
          lastRunAt: new Date().toISOString(),
          lastRunStatus: 'error',
          lastRunMessage: message,
          lastArtifactPath: currentState.run.lastArtifactPath,
        },
      };
      try {
        saveState(db, nextState);
      } catch {
        // best effort
      } finally {
        db.close();
      }
    }
    console.log(JSON.stringify({
      ok: false,
      message,
    }));
    process.exitCode = 1;
  } finally {
    releaseBackupLock(backupLockPath);
  }
}

await main();
