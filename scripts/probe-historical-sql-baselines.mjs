/* C09: explicit synthetic historical origins, not universal installed-release support. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { initializerProgram, readPinnedSource, replayInitializers } from './historical-schema-initializers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/schema-convergence/provenance.json'), 'utf8'));
if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 required');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
git('diff', '--exit-code', manifest.currentCommit, '--', 'lib', 'scripts/db-server-bootstrap-worker.mjs', 'scripts/run-strip-types.mjs');
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && !args[0].startsWith('--families='))) throw new Error('Usage: probe-historical-sql-baselines.mjs [--families=v0.8.0,v0.8.6]');
const requested = args.length ? args[0].slice('--families='.length).split(',') : manifest.families.map(family => family.tags[0].tag);
if (new Set(requested).size !== requested.length || requested.some(tag => !manifest.families.some(family => family.tags[0].tag === tag))) throw new Error('Unknown or duplicate family');
const families = manifest.families.filter(family => requested.includes(family.tags[0].tag));
const programs = families.map(family => initializerProgram(root, family));
// Validate every source before any database is created: provenance drift is fatal.
for (const family of families) {
  for (const { commit } of family.tags) {
    readPinnedSource(root, commit, family.provisioningSource);
    for (const source of family.runtimeSources) readPinnedSource(root, commit, source);
    for (const blob of family.sqlSources) readPinnedSource(root, commit, { ...manifest.sourcesByBlob[blob], blob });
  }
}
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-historical-sql-baselines-')));
const omit = (row, key) => { const copy = { ...row }; delete copy[key]; return copy; };
const quote = name => '"' + name.replaceAll('"', '""') + '"';
function snapshot(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all().map(({ name }) => [name, {
      definition: db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(name).sql,
      triggers: db.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=? ORDER BY name").all(name),
      columns: db.pragma(`table_xinfo(${quote(name)})`).map(column => omit(column, 'cid')).sort((a,b) => a.name.localeCompare(b.name)),
      foreignKeys: db.pragma(`foreign_key_list(${quote(name)})`).map(key => omit(key, 'id')).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      indices: db.pragma(`index_list(${quote(name)})`).map(index => ({ name: index.origin === 'c' ? index.name : null, unique: index.unique, origin: index.origin, partial: index.partial,
        definition: index.origin === 'c' ? db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?").get(index.name)?.sql ?? null : null,
        columns: db.pragma(`index_xinfo(${quote(index.name)})`).map(column => omit(column, 'cid')),
      })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    }]));
  } finally { db.close(); }
}
function auditBehavior(file) {
  const db = new Database(file);
  try {
    db.exec('SAVEPOINT historical_audit_probe');
    db.prepare(`INSERT INTO audit_events(event_id,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,source_surface)
      VALUES(?, 'synthetic.probe', 1, 'success', 'system', 'synthetic', 'settings', 'historical-fixture')`).run('synthetic-c09-audit');
    const rejected = sql => { try { db.exec(sql); return false; } catch (error) { return String(error.message).includes('audit_events is append-only'); } };
    return { insert: true, updateRejected: rejected("UPDATE audit_events SET event_type='synthetic.changed' WHERE event_id='synthetic-c09-audit'"),
      deleteRejected: rejected("DELETE FROM audit_events WHERE event_id='synthetic-c09-audit'") };
  } catch (error) { return { error: error.message }; }
  finally { if (db.inTransaction) db.exec('ROLLBACK TO historical_audit_probe; RELEASE historical_audit_probe'); db.close(); }
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
  for (const [familyIndex, family] of families.entries()) {
    const commit = family.tags[0].commit;
    for (const origin of family.origins) {
      const directory = path.join(workspace, `${family.tags[0].tag}-${origin}`); fs.mkdirSync(directory);
      const file = path.join(directory, 'medical.db');
      let db = new Database(file);
      let warnings = [];
      let historicalError = null;
      try {
        if (origin === 'published-sql-then-same-tag-guards') {
          // Historical prepare-e2e-db provisioning uses sorted SQL without an
          // enclosing transaction and disables FK enforcement during the replay.
          db.pragma('foreign_keys = OFF');
          for (const blob of family.sqlSources) {
            const source = manifest.sourcesByBlob[blob];
            db.exec(readPinnedSource(root, commit, { ...source, blob }));
          }
          db.pragma('foreign_keys = ON');
          // Reopen exactly as runtime does; do not guess its connection defaults.
          db.close(); db = new Database(file);
        } else if (origin !== 'empty-database-historical-bootstrap' || family.tags[0].tag !== 'v0.8.6') throw new Error('Unsupported origin');
        warnings = replayInitializers(programs[familyIndex], db, warnings);
      } catch (error) { historicalError = error.message; }
      finally { db.close(); }
      const before = snapshot(file);
      const historicalAudit = auditBehavior(file);
      const currentBootstrap = historicalError ? null : bootstrap(directory);
      const after = snapshot(file);
      const differences = [];
      const definitionDifferences = [];
      for (const table of historicalError ? [] : [...new Set([...Object.keys(reference), ...Object.keys(after)])].sort()) {
        for (const aspect of ['columns','foreignKeys','indices']) {
          const metadata = value => aspect === 'indices' ? value?.map(index => Object.fromEntries(Object.entries(index).filter(([key]) => !['definition', 'triggers'].includes(key)))) : value;
          if (JSON.stringify(metadata(reference[table]?.[aspect])) !== JSON.stringify(metadata(after[table]?.[aspect]))) differences.push({table,aspect,fresh:metadata(reference[table]?.[aspect]) ?? null,upgradedOrigin:metadata(after[table]?.[aspect]) ?? null});
        }
        for (const aspect of ['definition', 'indices', 'triggers']) {
          if (JSON.stringify(reference[table]?.[aspect]) !== JSON.stringify(after[table]?.[aspect])) definitionDifferences.push({ table, aspect });
        }
      }
      results.push({ tags: family.tags, origin, initializerProvenance: programs[familyIndex].provenance,
        warnings, historicalError, initialTableCount: Object.keys(before).length,
        initialObservations: before.observations?.columns, historicalAudit, currentBootstrap,
        upgradedAudit: auditBehavior(file), differences, definitionDifferences });
    }
  }
  process.exitCode = results.some(result => result.historicalError || result.currentBootstrap?.status !== 0) ? 1 : 0;
  console.log(JSON.stringify({ currentCommit: git('rev-parse','HEAD').trim(), currentBootstrapCommit: manifest.currentCommit, kind: manifest.kind,
    limitations: ['Only the declared synthetic provisioning origins are tested, not all installed release databases or product support versions.', 'Table DDL is compared textually only: definition differences are not semantic CHECK equivalence. Explicit index SQL preserves partial predicates but is not parsed for semantic equivalence.', 'Audit INSERT/UPDATE/DELETE behavior is tested on synthetic rows; general CHECK and FK data behavior remain outside this bounded probe.', 'Exit zero means all requested initializers/current bootstraps completed, not schema parity or release support.'], freshAudit: auditBehavior(path.join(freshDirectory, 'medical.db')), results }, null, 2));
} finally { fs.rmSync(workspace, { recursive: true, force: true }); }
