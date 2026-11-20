import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { bancoPaths, readBancoReference, validateBancoData, visionScratch } from './banco-paths.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-banco-paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = bancoPaths({ MF_BANCO_SCRATCH: path.join(root, 'scratch') });
  fs.mkdirSync(paths.scratch);
  return { root, paths };
}

test('mantiene la selezione Vision implicita ed esplicita', () => {
  const expected = { scratch: visionScratch, data: path.join(visionScratch, 'apfs', 'banco'), needsContainer: true };
  assert.deepEqual(bancoPaths({}), expected);
  assert.deepEqual(bancoPaths({ MF_BANCO_SCRATCH: visionScratch }), expected);
});

test('distingue bootstrap da lettura del banco sintetico e non crea cartelle', t => {
  const { paths } = fixture(t);
  validateBancoData(paths);
  assert.throws(() => readBancoReference(paths), /senza SYNTHETIC_ONLY/);
  assert.deepEqual(fs.readdirSync(paths.scratch), []);

  fs.mkdirSync(paths.data, { recursive: true });
  fs.writeFileSync(path.join(paths.data, 'medical.db'), 'fixture');
  assert.throws(() => validateBancoData(paths), /senza SYNTHETIC_ONLY/);
  fs.writeFileSync(path.join(paths.data, 'SYNTHETIC_ONLY'), 'fixture');
  const reference = { referenceId: 'synthetic-reference', emptyId: 'synthetic-empty' };
  fs.writeFileSync(path.join(paths.data, 'reference.json'), JSON.stringify(reference));
  assert.deepEqual(readBancoReference(paths), reference);
});

test('rifiuta la radice stessa e un percorso fratello con prefisso simile', t => {
  const { paths } = fixture(t);
  for (const data of [paths.scratch, `${paths.scratch}-sibling/banco`]) {
    assert.throws(() => validateBancoData({ ...paths, data }), /fuori dallo scratch/);
  }
});

test('rifiuta il symlink a cartelle esterne anche se il database non esiste ancora', t => {
  const { paths, root } = fixture(t);
  const outside = path.join(root, 'outside');
  const link = path.join(paths.scratch, 'link');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, link, 'dir');
  assert.throws(() => validateBancoData({ ...paths, data: path.join(link, 'banco') }), /symlink fuori scratch/);
});

test('rifiuta marker, database o riferimento puntati a fixture esterne', t => {
  const { paths, root } = fixture(t);
  const outside = path.join(root, 'fixture');
  fs.writeFileSync(outside, '{}');
  fs.mkdirSync(paths.data, { recursive: true });
  for (const name of ['SYNTHETIC_ONLY', 'medical.db', 'reference.json']) {
    const file = path.join(paths.data, name);
    fs.symlinkSync(outside, file, 'file');
    assert.throws(() => validateBancoData(paths), new RegExp(`${name} deve essere un file regolare`));
    fs.unlinkSync(file);
    fs.writeFileSync(file, '{}');
  }
});
