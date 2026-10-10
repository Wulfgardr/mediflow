/* C09 diagnostic only: SQL baselines are NOT installed-release schemas. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/schema-convergence/provenance.json'), 'utf8'));
if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 required');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-historical-sql-baselines-')));
const quote = name => '"' + name.replaceAll('"', '""') + '"';
function snapshot(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all().map(({ name }) => [name, {
      columns: db.pragma(`table_xinfo(${quote(name)})`).map(({ cid, ...column }) => column).sort((a,b) => a.name.localeCompare(b.name)),
      foreignKeys: db.pragma(`foreign_key_list(${quote(name)})`).map(({ id, ...key }) => key).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      indices: db.pragma(`index_list(${quote(name)})`).map(index => ({ name: index.origin === 'c' ? index.name : null, unique: index.unique, origin: index.origin, partial: index.partial,
        columns: db.pragma(`index_xinfo(${quote(index.name)})`).map(({ cid, ...column }) => column),
      })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    }]));
  } finally { db.close(); }
}
function bootstrap(directory) {
  const result = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/db-server-bootstrap-worker.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, NEXT_PHASE: '', MEDIFLOW_DATA_DIR: directory, MEDIFLOW_E2E_DATA_DIR: directory, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' },
  });
  return { status: result.status, signal: result.signal, error: result.error?.message ?? null, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}
try {
  const freshDirectory = path.join(workspace, 'fresh'); fs.mkdirSync(freshDirectory);
  const fresh = bootstrap(freshDirectory);
  if (fresh.status !== 0) throw new Error(`Current fresh bootstrap failed: ${fresh.output}`);
  const reference = snapshot(path.join(freshDirectory, 'medical.db'));
  const results = [];
  for (const family of manifest.families) {
    const commit = family.tags[0].commit;
    const directory = path.join(workspace, family.tags[0].tag); fs.mkdirSync(directory);
    const file = path.join(directory, 'medical.db');
    const db = new Database(file);
    try {
      db.transaction(() => {
        for (const blob of family.sqlSources) {
          const source = manifest.sourcesByBlob[blob];
          const sql = git('show', `${commit}:${source.path}`);
          if (sha256(sql) !== source.sha256 || git('rev-parse', `${commit}:${source.path}`).trim() !== blob) throw new Error(`Source mismatch: ${commit}:${source.path}`);
          db.exec(sql);
        }
      })();
    } finally { db.close(); }
    const before = snapshot(file);
    const currentBootstrap = bootstrap(directory);
    const after = snapshot(file);
    const differences = [];
    for (const table of [...new Set([...Object.keys(reference), ...Object.keys(after)])].sort()) {
      for (const aspect of ['columns','foreignKeys','indices']) {
        if (JSON.stringify(reference[table]?.[aspect]) !== JSON.stringify(after[table]?.[aspect])) differences.push({table,aspect,fresh:reference[table]?.[aspect] ?? null,upgradedSqlBaseline:after[table]?.[aspect] ?? null});
      }
    }
    results.push({ tags: family.tags, origin: 'historical-sql-only; installed-release-origin-unqualified', initialObservations: before.observations?.columns, currentBootstrap, differences });
  }
  console.log(JSON.stringify({ currentCommit: git('rev-parse','HEAD').trim(), kind: manifest.kind,
    limitations: ['Does not replay historical runtime guards or assert installed-release equivalence.', 'Column/FK/index metadata only; CHECK expressions, partial-index predicates and audit trigger behavior are not qualified by this probe.', 'Exit zero means diagnostic completed, not schema parity or release support.'], results }, null, 2));
} finally { fs.rmSync(workspace, { recursive: true, force: true }); }
