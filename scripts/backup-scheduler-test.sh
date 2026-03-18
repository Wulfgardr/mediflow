#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$ROOT_DIR/tmp-backup-scheduler-test"
DATA_DIR="$TMP_DIR/data"
OUT_DIR="$TMP_DIR/out"

rm -rf "$TMP_DIR"
mkdir -p "$OUT_DIR"

MEDIFLOW_E2E_DATA_DIR="$DATA_DIR" node "$ROOT_DIR/scripts/prepare-e2e-db.mjs"

MEDIFLOW_DATA_DIR="$DATA_DIR" \
MEDIFLOW_BACKUP_DEST_DIR="$OUT_DIR" \
MEDIFLOW_BACKUP_FORCE=1 \
node --experimental-strip-types "$ROOT_DIR/scripts/run-scheduled-backup.mjs" > "$TMP_DIR/result.json"

ROOT_DIR="$ROOT_DIR" TMP_DIR="$TMP_DIR" node --experimental-strip-types --input-type=module <<'NODE'
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const rootDir = process.env.ROOT_DIR;
const tmpDir = process.env.TMP_DIR;
const result = JSON.parse(fs.readFileSync(path.join(tmpDir, 'result.json'), 'utf8'));
if (!result.ok) {
  throw new Error(result.message || 'Scheduled backup runner failed.');
}
if (!result.artifactPath || !fs.existsSync(result.artifactPath)) {
  throw new Error('Scheduled backup artifact was not created.');
}

const { parseBackupArtifact } = await import(pathToFileURL(path.join(rootDir, 'lib', 'backup-artifact.ts')).href);
const artifact = JSON.parse(fs.readFileSync(result.artifactPath, 'utf8'));
const parsed = await parseBackupArtifact(artifact);

if (parsed.format !== 'mediflow-backup' || parsed.version !== 1) {
  throw new Error('Unexpected backup artifact format.');
}
NODE

node --experimental-strip-types --test "$ROOT_DIR/lib/backup-scheduler.test.ts"
