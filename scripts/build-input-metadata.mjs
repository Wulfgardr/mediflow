import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const fail = reason => { throw new Error(`Build input metadata: ${reason}`); };
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
export function privateDatabaseDependency(file) {
  return /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal|mj[0-9a-f]+))?$/iu.test(file.replaceAll('\\', '/'));
}
function privateDirectory(relative) {
  return /(?:^|\/)(?:\.venv[^/]*|__pycache__|site-packages|mediflow-data|clinical-data|patient-data)(?:\/|$)/iu.test(relative)
    || /^(?:data|backups|uploads|attachments|logs|tmp(?:[-_][^/]*)?)(?:\/|$)/iu.test(relative);
}
function physical(file, directory, linkedDependency = false) {
  if (!path.isAbsolute(file) || path.normalize(file) !== file || /[\x00-\x1f\x7f]/u.test(file)) fail('noncanonical path');
  let current = path.parse(file).root;
  const parts = file.slice(current.length).split(path.sep);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (index < parts.length - 1 || directory
      ? !stat.isDirectory() : !stat.isFile() || !linkedDependency && stat.nlink !== 1)) fail('nonphysical or multiply linked input');
  }
  if (fs.realpathSync(file) !== file) fail('aliased path');
}

export function macDerivedDataDirectory(sourceRoot, env = process.env) {
  sourceRoot = path.resolve(sourceRoot);
  const key = createHash('sha256').update(sourceRoot).digest('hex').slice(0, 16);
  const directory = env.MEDIFLOW_MAC_DERIVED_DATA ?? path.join(os.homedir(), 'Library/Caches/MediFlow/DerivedData', key);
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory
    || inside(sourceRoot, directory) || inside(path.join(sourceRoot, 'node_modules'), directory)) fail('DerivedData must be outside the source and dependency roots');
  let current = path.parse(directory).root;
  for (const name of directory.slice(current.length).split(path.sep)) {
    current = path.join(current, name);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(current) !== current) fail('DerivedData has an aliased ancestor');
  }
  return directory;
}

// This is a metadata admission of trusted, stable inputs, not a filesystem sandbox.
// Nothing is skipped: rejected inputs require a clean build area, never their removal.
export function assertBuildInputMetadata({ sourceRoot, dependencyRoot, payloadRoot, protectedRoots = [], allowPayloadAliases = true }) {
  sourceRoot = path.resolve(sourceRoot);
  dependencyRoot = path.resolve(dependencyRoot ?? path.join(sourceRoot, 'node_modules'));
  const roots = [sourceRoot];
  if (fs.existsSync(dependencyRoot)) roots.push(dependencyRoot);
  if (payloadRoot && fs.existsSync(payloadRoot)) roots.push(path.resolve(payloadRoot));
  for (const root of roots) physical(root, true);
  const protectedPaths = protectedRoots.filter(Boolean).map(value => path.resolve(value));
  const aliases = [], visited = new Set(), active = new Set(), linkedGroups = new Map();
  function inspect(file, root) {
    root = roots.filter(value => inside(value, file)).sort((a, b) => b.length - a.length)[0] ?? root;
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (protectedPaths.some(value => inside(value, file))) fail('data directory is reachable');
    if (privateDatabaseDependency(file) || /(?:^|\/)\.env(?:\.[^/]*)?$/iu.test(relative)) fail('private file is reachable');
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      if (privateDirectory(relative)) fail('data or environment directory is reachable');
      if (active.has(file)) fail('cyclic payload alias');
      if (visited.has(file)) return;
      visited.add(file); active.add(file);
      for (const name of fs.readdirSync(file)) inspect(path.join(file, name), root);
      active.delete(file);
    } else if (stat.isSymbolicLink()) {
      const inPayload = payloadRoot && inside(path.resolve(payloadRoot), file);
      if (inPayload && !allowPayloadAliases) fail('materialized payload contains an alias');
      const target = fs.realpathSync(file);
      const nodeModules = file.slice(0, file.lastIndexOf(`${path.sep}node_modules${path.sep}`) + '/node_modules'.length);
      const bin = /(?:^|\/)node_modules\/(?:.*\/)?\.bin\/[^/]+$/u.test(file.split(path.sep).join('/'));
      const packageName = path.relative(dependencyRoot, target).split(path.sep).join('/');
      const packageAlias = inPayload && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageName);
      if (bin && roots.some(value => inside(value, nodeModules)) && inside(nodeModules, target)) physical(target, false, inside(dependencyRoot, target));
      else if (inPayload && inside(path.resolve(payloadRoot), target)) physical(target, fs.lstatSync(target).isDirectory());
      else if (packageAlias) physical(target, true);
      else fail('unadmitted alias');
      aliases.push({ link: file, target });
      inspect(target, packageAlias ? dependencyRoot : nodeModules);
    } else if (!stat.isFile()) fail('special file');
    else if (stat.nlink !== 1) {
      if (!inside(dependencyRoot, file) || payloadRoot && inside(path.resolve(payloadRoot), file)) fail('multiply linked source or payload file');
      if (![stat.dev, stat.ino, stat.nlink].every(Number.isSafeInteger) || stat.ino <= 0 || stat.nlink < 2) fail('unverifiable dependency hardlink group');
      const key = `${stat.dev}:${stat.ino}`;
      const group = linkedGroups.get(key) ?? { links: stat.nlink, peers: new Set() };
      if (group.links !== stat.nlink) fail('dependency hardlink group changed');
      group.peers.add(file); linkedGroups.set(key, group);
    }
  }
  for (const root of roots) inspect(root, root);
  for (const group of linkedGroups.values()) if (group.peers.size !== group.links) fail('dependency hardlink group is not closed');
  return { roots, aliases, dependencyHardlinkGroups: [...linkedGroups.values()].map(group => [...group.peers].sort()) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const allowPayloadAliases = args.at(-1) !== '--materialized';
    if (!allowPayloadAliases) args.pop();
    if (args.length === 2 && args[0] === '--derived') {
      process.stdout.write(macDerivedDataDirectory(args[1]));
    } else {
      if (args.length !== 2 && args.length !== 4 || args[0] !== '--source' || args.length === 4 && args[2] !== '--payload') fail('expected --source ROOT [--payload ROOT]');
      assertBuildInputMetadata({ sourceRoot: args[1], payloadRoot: args[3] ?? path.join(path.resolve(args[1]), process.env.MEDIFLOW_NEXT_DIST_DIR ?? '.next', 'standalone'), protectedRoots: [process.env.MEDIFLOW_DATA_DIR], allowPayloadAliases });
    }
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
