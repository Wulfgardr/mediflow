import fs from 'node:fs';
import path from 'node:path';

export const visionScratch = '/Volumes/Vision/mf-ui-identita-20261107-scratch';

export function bancoPaths(env = process.env) {
  const scratch = path.resolve(env.MF_BANCO_SCRATCH || visionScratch);
  const data = path.resolve(env.MEDIFLOW_DATA_DIR || path.join(scratch, 'apfs', 'banco'));
  return { scratch, data, needsContainer: scratch === visionScratch };
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function validateBancoData({ scratch, data, needsContainer }, { requireFixture = false } = {}) {
  if (!isInside(scratch, data)) throw new Error('SYNTHETIC_ONLY: data dir fuori dallo scratch rifiutata');
  if (needsContainer && !fs.existsSync(path.join(scratch, 'apfs'))) throw new Error('Montare prima il contenitore APFS: vedere README');

  const realScratch = fs.realpathSync(scratch);
  let existing = data;
  while (!fs.lstatSync(existing, { throwIfNoEntry: false })) existing = path.dirname(existing);
  if (existing !== scratch && !isInside(realScratch, fs.realpathSync(existing))) {
    throw new Error('SYNTHETIC_ONLY: symlink fuori scratch rifiutato');
  }

  const marker = fixtureFile(data, 'SYNTHETIC_ONLY');
  const database = fixtureFile(data, 'medical.db');
  fixtureFile(data, 'reference.json');
  if ((requireFixture || database) && !marker) throw new Error('Archivio senza SYNTHETIC_ONLY rifiutato');
}

function fixtureFile(data, name) {
  const stat = fs.lstatSync(path.join(data, name), { throwIfNoEntry: false });
  if (stat && !stat.isFile()) throw new Error(`SYNTHETIC_ONLY: ${name} deve essere un file regolare`);
  return stat;
}

export function readBancoReference(paths = bancoPaths()) {
  validateBancoData(paths, { requireFixture: true });
  return JSON.parse(fs.readFileSync(path.join(paths.data, 'reference.json'), 'utf8'));
}
