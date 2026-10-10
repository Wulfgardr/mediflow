#!/usr/bin/env node
/* @Codex */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = process.cwd();
const DEFAULT_WORK_DIR = path.join(ROOT, 'tmp-backup-restore-drill');
const DEFAULT_REPORT = path.join(DEFAULT_WORK_DIR, 'restore-drill-report.json');

function parseArgs(argv) {
  const options = {
    workDir: process.env.MEDIFLOW_RESTORE_DRILL_WORK_DIR || DEFAULT_WORK_DIR,
    report: process.env.MEDIFLOW_RESTORE_DRILL_REPORT || DEFAULT_REPORT,
    keepWorkDir: process.env.MEDIFLOW_RESTORE_DRILL_KEEP === '1',
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--work-dir' && argv[i + 1]) options.workDir = path.resolve(argv[++i]);
    else if (argv[i] === '--report' && argv[i + 1]) options.report = path.resolve(argv[++i]);
    else if (argv[i] === '--keep-work-dir') options.keepWorkDir = true;
  }
  return options;
}

function timed(name, timings, fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  timings[name] = Math.round(Number(process.hrtime.bigint() - start) / 1_000_000);
  return result;
}

function command(args, env = {}) {
  return execFileSync(args[0], args.slice(1), {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function configureSchedulerState(dataDir, backupDir) {
  const db = new Database(path.join(dataDir, 'medical.db'));
  try {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('backupScheduler', JSON.stringify({
      version: 1,
      config: {
        enabled: true,
        hour: 2,
        minute: 0,
        destinationDir: backupDir,
        retentionKeepArtifacts: 1,
      },
      run: {},
    }));
  } finally {
    db.close();
  }
}

const LOADER = pathToFileURL(path.join(ROOT, 'scripts', 'register-strip-types-loader.mjs')).href;
const moduleUrl = (...segments) => pathToFileURL(path.join(ROOT, ...segments)).href;

// Gives the source archive records with sealed fields, so the restore carries more than an empty schema.
// The product opens the archive first: the prepared fixture reaches the current schema only then.
async function seedSealedRecords(sourceDataDir) {
  command(
    [process.execPath, '--experimental-strip-types', '--import', LOADER, '--input-type=module', '--eval',
      `(await import(${JSON.stringify(moduleUrl('lib', 'db-server.ts'))})).openDbServer();`],
    { MEDIFLOW_DATA_DIR: sourceDataDir },
  );
  const { encryptData, generateMasterKey } = await import(moduleUrl('lib', 'security', 'security.ts'));
  const masterKey = await generateMasterKey();
  const seal = async (label) => {
    const sealed = await encryptData(`SYNTHETIC_RESTORE_DRILL:${label}`, masterKey);
    return `ENC:${sealed.iv}:${sealed.data}`;
  };
  const now = 1_783_000_000;
  const db = new Database(path.join(sourceDataDir, 'medical.db'));
  try {
    db.prepare('INSERT INTO ambulatories (id, name, type, is_default, version, created_at) VALUES (?, ?, ?, 0, 1, ?)')
      .run('drill-source-amb', 'Ambulatorio sintetico drill', 'synthetic', now);
    db.prepare(`INSERT INTO patients (id, first_name, last_name, tax_code, address, notes, ambulatory_id, is_archived, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`)
      .run('drill-source-patient', 'Synthetic', 'RestoreDrill', 'SYNTHETIC-DRILL', await seal('patients.address'), await seal('patients.notes'), 'drill-source-amb', now, now);
    db.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id, assigned_at) VALUES (?, ?, ?)')
      .run('drill-source-patient', 'drill-source-amb', now);
    db.prepare(`INSERT INTO entries (id, patient_id, type, date, title, content, version, created_at, updated_at)
      VALUES (?, ?, 'note', ?, ?, ?, 1, ?, ?)`)
      .run('drill-source-entry', 'drill-source-patient', now, await seal('entries.title'), await seal('entries.content'), now, now);
    db.prepare(`INSERT INTO therapies (id, patient_id, drug_name, dosage, status, start_date, motivation, version, created_at, updated_at)
      VALUES (?, ?, 'Farmaco sintetico', '1 unita', 'active', ?, ?, 1, ?, ?)`)
      .run('drill-source-therapy', 'drill-source-patient', now, await seal('therapies.motivation'), now, now);
    db.prepare(`INSERT INTO attachments (id, patient_id, name, type, size, path, data, created_at, document_source_ref, document_revision, document_freshness_epoch)
      VALUES (?, ?, ?, 'application/pdf', 128, ?, ?, ?, ?, 1, 1)`)
      .run('drill-source-attachment', 'drill-source-patient', await seal('attachments.name'), await seal('attachments.path'), await seal('attachments.data'), now, 'd'.repeat(64));
  } finally {
    db.close();
  }
  return masterKey;
}

// The same executor the product uses, against the synthetic target archive.
function restoreIntoTarget(targetDataDir, artifactPath) {
  const source = `
    import fs from 'node:fs';
    import { parseBackupArtifact } from ${JSON.stringify(moduleUrl('lib', 'backup-artifact.ts'))};
    import { restoreBackupArtifact } from ${JSON.stringify(moduleUrl('lib', 'backup-restore-executor.ts'))};
    const artifact = await parseBackupArtifact(JSON.parse(fs.readFileSync(process.env.MEDIFLOW_RESTORE_DRILL_ARTIFACT, 'utf8')));
    process.stdout.write(JSON.stringify(restoreBackupArtifact(artifact, () => false)));
  `;
  return JSON.parse(command(
    [process.execPath, '--experimental-strip-types', '--import', LOADER, '--input-type=module', '--eval', source],
    { MEDIFLOW_DATA_DIR: targetDataDir, MEDIFLOW_RESTORE_DRILL_ARTIFACT: artifactPath },
  ));
}

// Every collection the backup carries must come back equal; the audit history may only grow.
function compareRestoredPayload(artifactModule, exported, restored) {
  const differences = [];
  let recordsCompared = 0;
  for (const collection of exported.manifest.collections) {
    const before = exported.payload[collection] ?? [];
    const after = restored.payload[collection] ?? [];
    recordsCompared += before.length;
    const same = collection === 'auditEvents'
      ? before.every((event) => after.some((candidate) => artifactModule.stableStringify(candidate) === artifactModule.stableStringify(event)))
      : artifactModule.stableStringify(before) === artifactModule.stableStringify(after);
    if (!same) differences.push(collection);
  }
  return { collectionsCompared: exported.manifest.collections.length, recordsCompared, differences };
}

async function countReadableSealedValues(payload, masterKey) {
  const { decryptData } = await import(moduleUrl('lib', 'security', 'security.ts'));
  let readable = 0;
  for (const collection of ['patients', 'entries', 'therapies', 'attachments']) {
    for (const row of payload[collection] ?? []) {
      if (typeof row.id !== 'string' || !row.id.startsWith('drill-source-')) continue;
      for (const value of Object.values(row)) {
        if (typeof value !== 'string' || !value.startsWith('ENC:')) continue;
        const [, iv, data] = value.split(':');
        if (String(await decryptData(data, iv, masterKey)).startsWith('SYNTHETIC_RESTORE_DRILL:')) readable += 1;
      }
    }
  }
  return readable;
}

function createDrillDataset(artifactModule) {
  const payload = artifactModule.createEmptyDataset();
  payload.ambulatories.push({
    id: 'drill-amb-1',
    name: 'Ambulatorio sintetico drill',
    type: 'synthetic',
    isDefault: 1,
    createdAt: '2026-05-01T00:00:00.000Z',
  });
  payload.patients.push({
    id: 'drill-patient-1',
    firstName: 'Synthetic',
    lastName: 'RestoreDrill',
    taxCode: 'SYNTHETIC-ONLY',
    ambulatoryId: 'drill-amb-1',
    assignedAmbulatoryIds: ['drill-amb-1'],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    version: 1,
  });
  payload.entries.push({
    id: 'drill-entry-1',
    patientId: 'drill-patient-1',
    type: 'note',
    date: '2026-05-01T00:05:00.000Z',
    content: 'SYNTHETIC_RESTORE_DRILL_NOTE',
    createdAt: '2026-05-01T00:05:00.000Z',
  });
  return payload;
}

async function runRestorePreflight(artifactModule, value, targetDataDir) {
  const dbPath = path.join(targetDataDir, 'medical.db');
  const checks = [];
  const add = (id, status, message, remediation) => checks.push({ id, status, message, ...(remediation ? { remediation } : {}) });
  const access = (id, target, mode, ok, fail, remediation) => {
    try {
      fs.accessSync(target, mode);
      add(id, 'pass', ok);
    } catch {
      add(id, 'fail', fail, remediation);
    }
  };

  access('data-dir-accessible', targetDataDir, fs.constants.R_OK | fs.constants.W_OK, 'Synthetic target data dir is readable and writable.', 'Synthetic target data dir is not readable/writable.', 'Recreate the drill sandbox before restore.');
  const dbExists = fs.existsSync(dbPath);
  if (dbExists) access('target-db-readable', dbPath, fs.constants.R_OK, 'Synthetic target DB is readable.', 'Synthetic target DB is not readable.', 'Check target DB permissions.');
  else add('target-db-readable', 'pass', 'Synthetic target DB can be created.');
  access('target-db-writable', dbExists ? dbPath : targetDataDir, fs.constants.W_OK, dbExists ? 'Synthetic target DB is writable.' : 'Synthetic target dir is writable.', 'Synthetic target DB is not writable.', 'Check target DB ownership and permissions.');

  try {
    const artifact = await artifactModule.parseBackupArtifact(value);
    add('artifact-json', 'pass', 'Artifact JSON is readable.');
    add('artifact-format', 'pass', 'Artifact format is valid.');
    add('artifact-version', 'pass', `Artifact version ${artifact.version} is supported.`);
    add('artifact-manifest', 'pass', 'Manifest, counts and references are coherent.');
    add('artifact-checksum', 'pass', 'Artifact checksum is valid.');
    add('artifact-references', 'pass', 'Payload internal references are coherent.');
  } catch (error) {
    add('artifact-preflight', 'fail', error instanceof Error ? error.message : 'Artifact preflight failed.', 'Regenerate the synthetic backup artifact before attempting restore.');
  }

  const firstFailure = checks.find((check) => check.status === 'fail');
  return {
    ok: !firstFailure,
    error: firstFailure ? `${firstFailure.message} ${firstFailure.remediation ?? ''}`.trim() : undefined,
    checks,
    target: {
      dataDirHash: sha256(targetDataDir).slice(0, 16),
      dbPathHash: sha256(dbPath).slice(0, 16),
      dbExists,
    },
  };
}

function syntheticOnly(artifact) {
  const text = JSON.stringify(artifact);
  return !/RSSMRA80A01H501U/i.test(text)
    && !/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/.test(text)
    && !/@/.test(text);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const timings = {};
  const failures = [];
  let report;
  const sourceDataDir = path.join(options.workDir, 'source-data');
  const targetDataDir = path.join(options.workDir, 'target-data');
  const backupDir = path.join(options.workDir, 'backups');

  fs.rmSync(options.workDir, { recursive: true, force: true });
  fs.mkdirSync(backupDir, { recursive: true });

  try {
    timed('prepareSourceDbMs', timings, () => {
      command(['node', 'scripts/prepare-e2e-db.mjs'], { MEDIFLOW_DATA_DIR: sourceDataDir, MEDIFLOW_E2E_DATA_DIR: sourceDataDir });
      configureSchedulerState(sourceDataDir, backupDir);
    });
    const masterKey = await seedSealedRecords(sourceDataDir);
    timed('prepareTargetDbMs', timings, () => command(['node', 'scripts/prepare-e2e-db.mjs'], { MEDIFLOW_DATA_DIR: targetDataDir, MEDIFLOW_E2E_DATA_DIR: targetDataDir }));

    const staleArtifact = path.join(backupDir, 'mediflow-backup-v1-2026-03-17T00-00-00.000Z.mediflow');
    const staleTemp = `${staleArtifact}.tmp`;
    const unrelatedFile = path.join(backupDir, 'operator-note.txt');
    fs.writeFileSync(staleArtifact, 'stale artifact');
    fs.writeFileSync(staleTemp, 'stale temp');
    const staleTempAt = new Date(Date.now() - (16 * 60 * 1000));
    fs.utimesSync(staleTemp, staleTempAt, staleTempAt);
    fs.writeFileSync(unrelatedFile, 'do not delete');

    const schedulerResult = timed('scheduledExportAndRetentionMs', timings, () => JSON.parse(command(
      ['node', '--experimental-strip-types', 'scripts/run-scheduled-backup.mjs'],
      { MEDIFLOW_DATA_DIR: sourceDataDir, MEDIFLOW_BACKUP_DEST_DIR: backupDir, MEDIFLOW_BACKUP_FORCE: '1' },
    )));
    if (!schedulerResult.ok || !schedulerResult.artifactPath) {
      failures.push({ step: 'scheduled-export', message: schedulerResult.message || 'Scheduled backup runner failed.', remediation: 'Check synthetic DB schema and backup destination.' });
      throw new Error('Scheduled synthetic backup did not produce an artifact.');
    }

    const artifactModule = await import(pathToFileURL(path.join(ROOT, 'lib', 'backup-artifact.ts')).href);
    const artifactJson = JSON.parse(fs.readFileSync(schedulerResult.artifactPath, 'utf8'));
    const parsedArtifact = await timed('parseAndChecksumMs', timings, () => artifactModule.parseBackupArtifact(artifactJson));
    const drillArtifact = JSON.parse(await artifactModule.serializeBackupArtifact(createDrillDataset(artifactModule), new Date('2026-05-01T00:00:00.000Z')));
    const parsedDrillArtifact = await artifactModule.parseBackupArtifact(drillArtifact);
    const preflight = await timed('restorePreflightMs', timings, () => runRestorePreflight(artifactModule, drillArtifact, targetDataDir));
    if (!preflight.ok) failures.push({ step: 'restore-preflight', message: preflight.error || 'Restore preflight failed.', remediation: 'Check target permissions, manifest and checksum.' });

    const restoredPayloadPath = path.join(options.workDir, 'restored-payload-snapshot.json');
    timed('restorePayloadMaterializationMs', timings, () => {
      fs.writeFileSync(restoredPayloadPath, `${JSON.stringify(parsedDrillArtifact.payload, null, 2)}\n`);
      JSON.parse(fs.readFileSync(restoredPayloadPath, 'utf8'));
    });

    const retention = {
      staleArtifactRemoved: !fs.existsSync(staleArtifact),
      staleTempRemoved: !fs.existsSync(staleTemp),
      unrelatedFilePreserved: fs.existsSync(unrelatedFile),
    };
    if (!retention.staleArtifactRemoved || !retention.staleTempRemoved || !retention.unrelatedFilePreserved) {
      failures.push({ step: 'retention', message: 'Retention evidence did not match keep-last-N expectations.', remediation: 'Check applyBackupRetention before trusting cleanup.' });
    }
    const realRestoreStartedAt = process.hrtime.bigint();
    const realRestore = await (async () => {
      const restoreResult = restoreIntoTarget(targetDataDir, schedulerResult.artifactPath);
      const reexport = JSON.parse(command(
        [process.execPath, '--experimental-strip-types', 'scripts/run-scheduled-backup.mjs'],
        { MEDIFLOW_DATA_DIR: targetDataDir, MEDIFLOW_BACKUP_DEST_DIR: path.join(options.workDir, 'restored-backups'), MEDIFLOW_BACKUP_FORCE: '1' },
      ));
      if (!reexport.ok || !reexport.artifactPath) throw new Error(reexport.message || 'The restored archive could not be exported again.');
      const restoredArtifact = await artifactModule.parseBackupArtifact(JSON.parse(fs.readFileSync(reexport.artifactPath, 'utf8')));
      return {
        mode: 'sqlite-restore-and-reexport',
        ...compareRestoredPayload(artifactModule, parsedArtifact, restoredArtifact),
        sealedValuesReadable: await countReadableSealedValues(restoredArtifact.payload, masterKey),
        auditCoverage: restoreResult.audit.coverage,
        notCovered: ['unlock key and recovery material', 'durable review commands', 'local accounts and settings'],
      };
    })();
    timings.realRestoreAndReexportMs = Math.round(Number(process.hrtime.bigint() - realRestoreStartedAt) / 1_000_000);
    if (realRestore.differences.length > 0) {
      failures.push({ step: 'real-restore', message: `Restored collections differ from the backup: ${realRestore.differences.join(', ')}.`, remediation: 'Compare the exported and the re-exported artifact kept with --keep-work-dir.' });
    }
    if (realRestore.sealedValuesReadable !== 8) {
      failures.push({ step: 'real-restore', message: 'Sealed synthetic values did not come back readable with their key.', remediation: 'Check that restore leaves encrypted values byte-identical.' });
    }
    if (!syntheticOnly(drillArtifact)) failures.push({ step: 'phi-safe', message: 'Drill artifact contains a real-data shaped token.', remediation: 'Use synthetic identifiers only.' });

    report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: failures.length === 0 ? 'pass' : 'fail',
      scenario: 'synthetic-local-restore-drill',
      localOnly: true,
      sourceDb: { pathHash: sha256(sourceDataDir).slice(0, 16) },
      targetDb: { pathHash: sha256(targetDataDir).slice(0, 16) },
      exportedArtifact: {
        exists: fs.existsSync(schedulerResult.artifactPath),
        format: parsedArtifact.format,
        version: parsedArtifact.version,
        checksum: parsedArtifact.manifest.checksum,
        fileSha256: sha256File(schedulerResult.artifactPath),
      },
      drillArtifact: {
        format: parsedDrillArtifact.format,
        version: parsedDrillArtifact.version,
        checksum: parsedDrillArtifact.manifest.checksum,
        recordCounts: parsedDrillArtifact.manifest.recordCounts,
        syntheticOnly: syntheticOnly(drillArtifact),
      },
      preflight,
      retention,
      restore: {
        mode: 'sandbox-payload-materialization',
        restoredPayloadSnapshotHash: sha256File(restoredPayloadPath),
        note: 'First thin slice validates restore readiness and materializes the parsed synthetic payload in an isolated sandbox without touching the operational database.',
      },
      realRestore,
      timings,
      failures,
    };
  } finally {
    if (!options.keepWorkDir) fs.rmSync(options.workDir, { recursive: true, force: true });
  }

  // Publish after fixture cleanup so reports inside the work directory survive.
  fs.mkdirSync(path.dirname(options.report), { recursive: true });
  fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Restore drill ${report.status}. Report: ${path.relative(ROOT, options.report)}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

await main();
