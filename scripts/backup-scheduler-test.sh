#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$ROOT_DIR/tmp-backup-scheduler-test"
DATA_DIR="$TMP_DIR/data"
OUT_DIR="$TMP_DIR/out"

rm -rf "$TMP_DIR"
mkdir -p "$OUT_DIR"

MEDIFLOW_E2E_DATA_DIR="$DATA_DIR" node "$ROOT_DIR/scripts/prepare-e2e-db.mjs"

DATA_DIR="$DATA_DIR" node --input-type=module <<'NODE'
import Database from 'better-sqlite3';
import path from 'path';

const dataDir = process.env.DATA_DIR;
const db = new Database(path.join(dataDir, 'medical.db'));
db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run('backupScheduler', JSON.stringify({
  version: 1,
  config: {
    enabled: true,
    hour: 2,
    minute: 0,
    destinationDir: path.join(dataDir, 'backups'),
    retentionKeepArtifacts: 1,
  },
  run: {},
}));
db.close();
NODE

printf 'old artifact' > "$OUT_DIR/mediflow-backup-v1-2026-03-17T00-00-00.000Z.mediflow"
printf 'orphan temp' > "$OUT_DIR/mediflow-backup-v1-2026-03-17T00-00-00.000Z.mediflow.tmp"
touch -t 202001010000 "$OUT_DIR/mediflow-backup-v1-2026-03-17T00-00-00.000Z.mediflow.tmp"
printf 'recent temp' > "$OUT_DIR/mediflow-backup-v1-current.mediflow.tmp"
printf '{"pid":999999999,"startedAt":"2020-01-01T00:00:00.000Z"}' > "$OUT_DIR/.mediflow-backup.lock"
touch -t 202001010000 "$OUT_DIR/.mediflow-backup.lock"
printf 'keep me' > "$OUT_DIR/notes.txt"

MEDIFLOW_DATA_DIR="$DATA_DIR" \
MEDIFLOW_BACKUP_DEST_DIR="$OUT_DIR" \
MEDIFLOW_BACKUP_FORCE=1 \
node "$ROOT_DIR/scripts/run-scheduled-backup.mjs" > "$TMP_DIR/result.json"

cat > "$TMP_DIR/verify-backup-artifact.mjs" <<'NODE'
import fs from 'fs';
import path from 'path';

const tmpDir = process.env.TMP_DIR;
const result = JSON.parse(fs.readFileSync(path.join(tmpDir, 'result.json'), 'utf8'));
if (!result.ok) {
  throw new Error(result.message || 'Scheduled backup runner failed.');
}
if (!result.artifactPath || !fs.existsSync(result.artifactPath)) {
  throw new Error('Scheduled backup artifact was not created.');
}
if (fs.existsSync(path.join(path.dirname(result.artifactPath), 'mediflow-backup-v1-2026-03-17T00-00-00.000Z.mediflow'))) {
  throw new Error('Retention did not remove the stale backup artifact.');
}
if (fs.existsSync(path.join(path.dirname(result.artifactPath), 'mediflow-backup-v1-2026-03-17T00-00-00.000Z.mediflow.tmp'))) {
  throw new Error('Retention did not remove the orphan temp file.');
}
if (!fs.existsSync(path.join(path.dirname(result.artifactPath), 'mediflow-backup-v1-current.mediflow.tmp'))) {
  throw new Error('Retention removed a recent temp file.');
}
if (fs.existsSync(path.join(path.dirname(result.artifactPath), '.mediflow-backup.lock'))) {
  throw new Error('Runner did not recover and release a stale backup lock.');
}
if (!fs.existsSync(path.join(path.dirname(result.artifactPath), 'notes.txt'))) {
  throw new Error('Retention removed an unrelated file.');
}

const artifact = JSON.parse(fs.readFileSync(result.artifactPath, 'utf8'));

if (artifact.format !== 'mediflow-backup' || artifact.version !== 1) {
  throw new Error('Unexpected backup artifact format.');
}
if (!artifact.manifest || !artifact.payload) {
  throw new Error('Backup artifact is missing manifest or payload sections.');
}
NODE

TMP_DIR="$TMP_DIR" node "$TMP_DIR/verify-backup-artifact.mjs"

printf '{"pid":%s,"startedAt":"2020-01-01T00:00:00.000Z"}' "$$" > "$OUT_DIR/.mediflow-backup.lock"
touch -t 202001010000 "$OUT_DIR/.mediflow-backup.lock"
if MEDIFLOW_DATA_DIR="$DATA_DIR" \
  MEDIFLOW_BACKUP_DEST_DIR="$OUT_DIR" \
  MEDIFLOW_BACKUP_FORCE=1 \
  node "$ROOT_DIR/scripts/run-scheduled-backup.mjs" > "$TMP_DIR/live-lock-result.json"; then
  echo 'Runner acquired an old lock held by a live PID.' >&2
  exit 1
fi
if [[ ! -f "$OUT_DIR/.mediflow-backup.lock" ]]; then
  echo 'Runner removed an old lock held by a live PID.' >&2
  exit 1
fi

printf '{not valid json' > "$OUT_DIR/.mediflow-backup.lock"
MEDIFLOW_DATA_DIR="$DATA_DIR" \
MEDIFLOW_BACKUP_DEST_DIR="$OUT_DIR" \
MEDIFLOW_BACKUP_FORCE=1 \
node "$ROOT_DIR/scripts/run-scheduled-backup.mjs" > "$TMP_DIR/corrupt-lock-result.json"

TMP_DIR="$TMP_DIR" OUT_DIR="$OUT_DIR" node --input-type=module <<'NODE'
import fs from 'fs';
import path from 'path';

const { TMP_DIR, OUT_DIR } = process.env;
const result = JSON.parse(fs.readFileSync(path.join(TMP_DIR, 'corrupt-lock-result.json'), 'utf8'));
if (!result.ok || !result.artifactPath || !fs.existsSync(result.artifactPath)) {
  throw new Error('Runner did not recover a corrupted backup lock.');
}
if (fs.existsSync(path.join(OUT_DIR, '.mediflow-backup.lock'))) {
  throw new Error('Runner did not release the recovered corrupted backup lock.');
}
NODE

node "$ROOT_DIR/scripts/run-strip-types.mjs" --test "$ROOT_DIR/lib/backup-scheduler.test.ts"
