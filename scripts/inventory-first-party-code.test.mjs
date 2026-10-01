/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = path.join(import.meta.dirname, 'inventory-first-party-code.mjs');
const hash = (content) => createHash('sha256').update(content).digest('hex');

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mediflow-inventory-ref-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  git('init', '-q');
  git('config', 'user.name', 'Synthetic inventory');
  git('config', 'user.email', 'synthetic@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  // Run the actual CLI from the fixture root without adding it to the census.
  write('.gitignore', 'scripts/inventory-first-party-code.mjs\n');
  write('scripts/inventory-first-party-code.mjs', '');
  copyFileSync(script, path.join(root, 'scripts/inventory-first-party-code.mjs'));
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'synthetic inventory revision');
    return git('rev-parse', 'HEAD');
  };
  const run = (...args) => spawnSync(process.execPath,
    [path.join(root, 'scripts/inventory-first-party-code.mjs'), ...args], { encoding: 'utf8' });
  const inventory = (...args) => {
    const result = run('--json', ...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const blob = (ref, file) => execFileSync('git', ['-C', root, 'show', `${ref}:${file}`]);
  return { root, git, write, commit, run, inventory, blob };
}

function assertRecord(inventory, file, content, category, kind, lines) {
  assert.deepEqual(inventory.records.find((record) => record.path === file), {
    path: file, category, kind, extension: path.extname(file).toLowerCase(),
    lines, bytes: content.byteLength, sha256: hash(content),
  });
}

test('ref census resolves commit/tree and preserves classification, exclusions, hashes and totals', (t) => {
  const f = fixture(t);
  const contents = new Map([
    ['app/page.tsx', Buffer.from('one\r\ntwo\rthree\nfour')],
    ['lib/same.ts', Buffer.from('one\r\ntwo\rthree\nfour')],
    ['lib/empty.ts', Buffer.alloc(0)],
    ['lib/odd \tline\n.ts', Buffer.from([0, 255, 10, 32])],
    ['tests/example.test.ts', Buffer.from('synthetic\n')],
    ['native/Tests/Probe.swift', Buffer.from('synthetic\n')],
    ['packages/bridge/index.js', Buffer.from('bridge\n')],
    ['drizzle/0001.sql', Buffer.from('select 1;\n')],
    ['.github/workflows/check.yml', Buffer.from('name: synthetic\n')],
    ['package.json', Buffer.from('{}\n')],
  ]);
  for (const [file, content] of contents) f.write(file, content);
  f.write('lib/fixtures/input.ts', 'excluded');
  f.write('packages/vendor/source.js', 'excluded');
  f.write('docs/outside.ts', 'out of scope');
  f.write('lib/readme.md', 'not source/config');
  const pin = f.commit();
  f.git('tag', '-a', 'synthetic-pin', '-m', 'synthetic tag', pin);
  const inventory = f.inventory('--ref', 'synthetic-pin');
  assert.equal(inventory.head, pin);
  assert.equal(inventory.source, 'git-ref');
  assert.deepEqual(inventory.revision, { commit: pin, tree: f.git('rev-parse', `${pin}^{tree}`) });
  assert.equal(Object.hasOwn(inventory, 'worktreeClean'), false);
  assert.equal(inventory.trackedFiles, 15);
  assert.equal(inventory.candidateFiles, 10);
  assert.equal(inventory.excludedCandidateFiles, 2);
  assert.deepEqual(inventory.records.map((record) => record.path), [...contents.keys()].sort());
  assert.deepEqual(inventory.excluded, { fixtures: 1, vendor: 1 });
  assert.deepEqual(inventory.excludedPaths, {
    fixtures: ['lib/fixtures/input.ts'], vendor: ['packages/vendor/source.js'],
  });
  for (const [file, content] of contents) assert.equal(hash(f.blob(pin, file)), hash(content));
  assertRecord(inventory, 'app/page.tsx', contents.get('app/page.tsx'), 'web', 'source', 4);
  assertRecord(inventory, 'lib/odd \tline\n.ts', contents.get('lib/odd \tline\n.ts'), 'lib', 'source', 2);
  assertRecord(inventory, 'lib/empty.ts', contents.get('lib/empty.ts'), 'lib', 'source', 0);
  assertRecord(inventory, 'native/Tests/Probe.swift', contents.get('native/Tests/Probe.swift'), 'tests', 'source', 1);
  assertRecord(inventory, 'drizzle/0001.sql', contents.get('drizzle/0001.sql'), 'tooling', 'migration', 1);
  assertRecord(inventory, 'package.json', contents.get('package.json'), 'tooling', 'config', 1);
  assert.deepEqual(inventory.categories, {
    lib: { files: 3, lines: 6, bytes: 23 },
    packages: { files: 1, lines: 1, bytes: 7 },
    tests: { files: 2, lines: 2, bytes: 20 },
    tooling: { files: 3, lines: 3, bytes: 29 },
    web: { files: 1, lines: 4, bytes: 19 },
  });
  assert.deepEqual(inventory.extensions, { '.js': 1, '.json': 1, '.sql': 1, '.swift': 1, '.ts': 4, '.tsx': 1, '.yml': 1 });
  assert.deepEqual(inventory.duplicateGroups, [
    { sha256: hash(contents.get('app/page.tsx')), paths: ['app/page.tsx', 'lib/same.ts'] },
    { sha256: hash(contents.get('tests/example.test.ts')), paths: ['native/Tests/Probe.swift', 'tests/example.test.ts'] },
  ]);
  assert.deepEqual(f.inventory('--ref', pin), inventory);
  assert.deepEqual(f.inventory(`--ref=${pin}`), inventory);
  const summary = f.run('--ref', pin);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, new RegExp(`Revision ${pin} tree ${inventory.revision.tree}`));
  assert.doesNotMatch(summary.stdout, /Worktree/);
});

test('ref snapshot is unchanged by dirty, staged, deleted, renamed and untracked checkout files', (t) => {
  const f = fixture(t);
  for (const name of ['dirty', 'staged', 'deleted', 'removed', 'renamed']) f.write(`lib/${name}.ts`, `${name}\n`);
  f.write('lib/fixtures/excluded.ts', 'excluded\n');
  const pin = f.commit();
  const expected = f.inventory('--ref', pin);
  f.write('lib/dirty.ts', 'checkout mutation\n');
  f.write('lib/staged.ts', 'index mutation\n');
  f.git('add', 'lib/staged.ts');
  f.write('lib/added.ts', 'index addition\n');
  f.git('add', 'lib/added.ts');
  f.write('lib/untracked.ts', 'untracked addition\n');
  rmSync(path.join(f.root, 'lib/deleted.ts'));
  f.git('rm', '-q', 'lib/removed.ts');
  renameSync(path.join(f.root, 'lib/renamed.ts'), path.join(f.root, 'lib/new-name.ts'));
  f.git('add', 'lib/renamed.ts', 'lib/new-name.ts');
  f.write('lib/fixtures/new-excluded.ts', 'new excluded');
  f.git('add', 'lib/fixtures/new-excluded.ts');
  assert.notEqual(f.git('status', '--porcelain=v1'), '');
  assert.deepEqual(f.inventory('--ref', pin), expected);
});

test('two pinned commits use their own paths and blobs regardless of checkout HEAD', (t) => {
  const f = fixture(t);
  f.write('lib/version.ts', 'first\n');
  f.write('lib/old.ts', 'old\n');
  const first = f.commit();
  f.write('lib/version.ts', 'second revision\n');
  f.git('rm', '-q', 'lib/old.ts');
  f.write('lib/new.ts', 'new\n');
  const second = f.commit();
  const old = f.inventory('--ref', first);
  const current = f.inventory('--ref', second);
  assert.equal(old.head, first);
  assert.equal(current.head, second);
  assert.notEqual(old.revision.tree, current.revision.tree);
  assert.deepEqual(old.records.map((record) => record.path), ['lib/old.ts', 'lib/version.ts']);
  assert.deepEqual(current.records.map((record) => record.path), ['lib/new.ts', 'lib/version.ts']);
  assertRecord(old, 'lib/version.ts', f.blob(first, 'lib/version.ts'), 'lib', 'source', 1);
  assertRecord(current, 'lib/version.ts', f.blob(second, 'lib/version.ts'), 'lib', 'source', 1);
  f.git('checkout', '-q', '--detach', first);
  assert.deepEqual(f.inventory('--ref', second), current);
  assert.deepEqual(f.inventory('--ref', 'HEAD'), old);
});

test('ref mode reads symlink blob bytes rather than checkout target bytes', (t) => {
  if (process.platform === 'win32') {
    t.skip('Creating symlinks on Windows requires host privileges');
    return;
  }
  const f = fixture(t);
  f.write('lib/target.ts', 'synthetic target\n');
  symlinkSync('target.ts', path.join(f.root, 'lib/link.ts'));
  const pin = f.commit();
  const expected = f.inventory('--ref', pin);
  assertRecord(expected, 'lib/link.ts', Buffer.from('target.ts'), 'lib', 'source', 1);
  rmSync(path.join(f.root, 'lib/target.ts'));
  assert.deepEqual(f.inventory('--ref', pin), expected);
});

test('invalid, non-commit and malformed ref arguments fail without inventory output', (t) => {
  const f = fixture(t);
  f.write('lib/value.ts', 'synthetic\n');
  const pin = f.commit();
  const tree = f.git('rev-parse', `${pin}^{tree}`);
  const blob = f.git('rev-parse', `${pin}:lib/value.ts`);
  for (const args of [
    ['--ref', 'missing-ref'], ['--ref', tree], ['--ref', blob],
    ['--ref'], ['--ref', ''], ['--ref', '--json'], ['--ref', '--all'],
    ['--ref', pin, '--ref', pin], ['--ref='], ['--ref=missing-ref'],
    ['--ref', pin, `--ref=${pin}`],
  ]) {
    const result = f.run('--json', ...args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.equal(result.stdout, '', JSON.stringify(args));
  }
});

test('a scoped gitlink fails explicitly instead of reading checkout bytes', (t) => {
  const f = fixture(t);
  f.write('lib/value.ts', 'synthetic\n');
  const first = f.commit();
  f.git('update-index', '--add', '--cacheinfo', `160000,${first},lib/submodule.ts`);
  f.git('commit', '-qm', 'synthetic gitlink');
  const result = f.run('--json', '--ref', 'HEAD');
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Cannot inventory non-blob path: lib\/submodule\.ts/);
});

test('legacy mode still uses index paths and checkout bytes, reports dirtiness, and fails on missing files', (t) => {
  const f = fixture(t);
  f.write('lib/value.ts', 'committed\n');
  const pin = f.commit();
  const clean = f.inventory();
  assert.equal(clean.schema, 'mediflow.first-party-code-inventory.v1');
  assert.equal(clean.head, pin);
  assert.equal(clean.worktreeClean, true);
  assert.equal(Object.hasOwn(clean, 'source'), false);
  assert.equal(Object.hasOwn(clean, 'revision'), false);
  f.write('lib/value.ts', 'local bytes\n');
  f.git('add', 'lib/value.ts');
  f.write('lib/value.ts', 'unstaged bytes\n');
  f.write('lib/staged.ts', 'staged bytes\n');
  f.git('add', 'lib/staged.ts');
  f.write('lib/untracked.ts', 'ignored by index selection\n');
  const dirty = f.inventory();
  assert.equal(dirty.head, pin);
  assert.equal(dirty.worktreeClean, false);
  assert.deepEqual(dirty.records.map((record) => record.path), ['lib/staged.ts', 'lib/value.ts']);
  assertRecord(dirty, 'lib/value.ts', Buffer.from('unstaged bytes\n'), 'lib', 'source', 1);
  assert.match(f.run().stdout, /Worktree dirty/);
  rmSync(path.join(f.root, 'lib/value.ts'));
  const missing = f.run('--json');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /ENOENT/);
});
