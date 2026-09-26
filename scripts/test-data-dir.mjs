/* @Codex */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function acquireTestDataDir(environment = process.env, prefix = 'mediflow-test-') {
  const explicit = environment?.MEDIFLOW_DATA_DIR;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return { dataDir: explicit, owned: false };
  }

  return {
    dataDir: fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))),
    owned: true,
  };
}

export function cleanupTestDataDir({ dataDir, owned }) {
  if (!owned) return;
  fs.rmSync(dataDir, { recursive: true, force: true });
}
