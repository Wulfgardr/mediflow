/* @Codex — staging test uses only the fixed public source fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const node24 = process.execPath;
const stager = path.join(root, 'scripts', 'stage-chatgpt-execution-mac-assets.ts');
const sourceDirectory = process.env.MEDIFLOW_MAC_PUBLIC_SOURCE_DIR;
const c1ReceiptPath = process.env.MEDIFLOW_MAC_C1_RECEIPT;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-mac-stager-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const installationRoot = path.join(directory, 'standalone');
  const binary = path.join(directory, 'codex');
  const nativeSource = path.join(directory, 'mac-owner.c');
  fs.mkdirSync(installationRoot);
  fs.writeFileSync(binary, 'synthetic binary input');
  fs.writeFileSync(nativeSource, 'synthetic C input');
  return { directory, installationRoot, binary, nativeSource };
}

function stage(input, extra = []) {
  return spawnSync(node24, ['scripts/run-strip-types.mjs', stager,
    '--installation-root', input.installationRoot,
    '--binary', input.binary,
    '--native-source', input.nativeSource,
    '--schema-directory', sourceDirectory ?? path.join(input.directory, 'absent-schema'),
    '--c1-receipt', c1ReceiptPath ?? path.join(input.directory, 'absent-c1'), ...extra], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' },
  });
}

test('stager copies only explicit public inputs into the standalone layout and reopens it', (t) => {
  if (!sourceDirectory || !c1ReceiptPath) { t.skip('MEDIFLOW_MAC_PUBLIC_SOURCE_DIR and MEDIFLOW_MAC_C1_RECEIPT not configured'); return; }
  const input = fixture(t);
  const result = stage(input);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const destination = path.join(input.installationRoot, 'resources', 'chatgpt-execution', 'mac', 'codex-0.153.4');
  for (const name of ['codex', 'mac-owner.c', 'C1-RECEIPT.json',
    'schema/config.schema.json', 'schema/RECEIPT.json', 'schema/config-loader-mod.rs', 'schema/LOADER-RECEIPT.json']) {
    const status = fs.lstatSync(path.join(destination, name));
    assert.ok(status.isFile());
    assert.equal(status.isSymbolicLink(), false);
  }
  assert.deepEqual(fs.readdirSync(destination).sort(), ['C1-RECEIPT.json', 'codex', 'mac-owner.c', 'schema']);
  const rerun = stage(input);
  assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
});

test('stager requires every explicit input and rejects a symlinked source', (t) => {
  const input = fixture(t);
  const missing = spawnSync(node24, ['scripts/run-strip-types.mjs', stager, '--installation-root', input.installationRoot], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' },
  });
  assert.notEqual(missing.status, 0);
  const linked = path.join(input.directory, 'linked-codex');
  fs.symlinkSync(input.binary, linked);
  const result = stage({ ...input, binary: linked });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sorgente non fisica/u);
});

test('stager rejects an altered public pin before writing the destination tree', (t) => {
  if (!sourceDirectory || !c1ReceiptPath) { t.skip('MEDIFLOW_MAC_PUBLIC_SOURCE_DIR and MEDIFLOW_MAC_C1_RECEIPT not configured'); return; }
  const input = fixture(t);
  const schema = path.join(input.directory, 'schema');
  fs.cpSync(sourceDirectory, schema, { recursive: true });
  fs.writeFileSync(path.join(schema, 'config.schema.json'), 'altered public pin');
  const result = spawnSync(node24, ['scripts/run-strip-types.mjs', stager,
    '--installation-root', input.installationRoot,
    '--binary', input.binary,
    '--native-source', input.nativeSource,
    '--schema-directory', schema,
    '--c1-receipt', c1ReceiptPath], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pin pubblico non valido/u);
  assert.equal(fs.existsSync(path.join(input.installationRoot, 'resources')), false);
});

test('stager refuses altered or partial prior payloads without overwriting them', (t) => {
  if (!sourceDirectory || !c1ReceiptPath) { t.skip('MEDIFLOW_MAC_PUBLIC_SOURCE_DIR and MEDIFLOW_MAC_C1_RECEIPT not configured'); return; }
  const input = fixture(t);
  assert.equal(stage(input).status, 0);
  const binary = path.join(input.installationRoot, 'resources', 'chatgpt-execution', 'mac', 'codex-0.153.4', 'codex');
  fs.writeFileSync(binary, 'altered staged binary');
  const altered = stage(input);
  assert.notEqual(altered.status, 0);
  assert.equal(fs.readFileSync(binary, 'utf8'), 'altered staged binary');
  const partial = fixture(t);
  fs.mkdirSync(path.join(partial.installationRoot, 'resources', 'chatgpt-execution', 'mac', 'codex-0.153.4'), { recursive: true });
  const rejected = stage(partial);
  assert.notEqual(rejected.status, 0);
});
