#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const SETTINGS_KEY = 'backupScheduler';
const BACKUP_COLLECTIONS = [
  'ambulatories',
  'attachments',
  'conversations',
  'drugs',
  'entries',
  'exemptions',
  'messages',
  'observations',
  'patients',
  'prostheticPrescriptions',
  'sissHandoffs',
  'checkups',
  'therapies',
];

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

function buildDataset(db) {
  const dataset = Object.fromEntries(
    BACKUP_COLLECTIONS.map((collection) => [
      collection,
      hasTable(db, BACKUP_TABLES[collection])
        ? db.prepare(`SELECT * FROM ${BACKUP_TABLES[collection]}`).all().map(normalizeRowKeys)
        : [],
    ]),
  );

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
}

async function main() {
  const artifactModule = await import(new URL('../lib/backup-artifact.ts', import.meta.url));
  const schedulerModule = await import(new URL('../lib/backup-scheduler.ts', import.meta.url));
  const { serializeBackupArtifact } = artifactModule;
  const { applyBackupRetention, applyRetentionResultToState } = schedulerModule;

  const dataDir = getDefaultDataDir();
  const dbPath = path.join(dataDir, 'medical.db');
  const forced = process.env.MEDIFLOW_BACKUP_FORCE === '1';

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

    const createdAt = new Date();
    const payload = buildDataset(db);
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
      { preservePaths: [finalPath] },
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
  }
}

await main();
