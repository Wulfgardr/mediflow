/* @Codex */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${ROOT}/docs/capability-mapping/source-manifest.v1.json`, 'utf8'));
const sources = new Map(manifest.sources.map((source) => [source.sourceId, source]));
const outputDirectory = `${ROOT}/docs/capability-mapping/sources`;

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function git(args, options = {}) { return execFileSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, ...options }); }
function tree(ref) {
  return git(['ls-tree', '-rl', ref], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map((line) => {
    const match = line.match(/^(\d+) (\w+) ([0-9a-f]+)\s+(\d+)\t(.+)$/);
    if (!match || match[2] !== 'blob') throw new Error(`cannot parse tree entry for ${ref}`);
    return { path: match[5], gitBlob: match[3], byteLength: Number(match[4]) };
  });
}
function selectedRecords(set, source) {
  const records = tree(source.commit);
  if (Array.isArray(set.paths)) return set.paths.map((expected) => {
    const actual = records.find((record) => record.path === expected.path);
    if (!actual || actual.gitBlob !== expected.gitBlob || actual.byteLength !== expected.byteLength) throw new Error(`${set.sourceSetId}: source drift at ${expected.path}`);
    return actual;
  }).sort((left, right) => left.path.localeCompare(right.path));
  const matcher = new RegExp(set.pathMatcher, set.pathMatcherFlags ?? '');
  return records.filter((record) => matcher.test(record.path)).sort((left, right) => left.path.localeCompare(right.path));
}

mkdirSync(outputDirectory, { recursive: true });
for (const set of manifest.sourceSets) {
  const source = sources.get(set.sourceId);
  if (!source) throw new Error(`${set.sourceSetId}: unknown source`);
  const records = selectedRecords(set, source).map((record) => ({
    ...record,
    sha256: sha256(git(['show', `${source.commit}:${record.path}`]))
  }));
  const roster = {
    schema: 'mediflow.capability-mapping.source-roster.v1',
    sourceSetId: set.sourceSetId,
    sourceId: set.sourceId,
    sourceRef: source.commit,
    parser: 'git-ls-tree-v1+git-show-sha256-v1',
    records
  };
  writeFileSync(`${outputDirectory}/${set.sourceSetId}.v1.json`, `${JSON.stringify(roster)}\n`);
}
