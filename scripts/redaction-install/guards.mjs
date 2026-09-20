/* @Codex — installer-only filesystem/JSON guards. No runtime authority. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export class InstallError extends Error {
  constructor(code, phase = 'preflight') { super(code); this.name = 'InstallError'; this.code = code; this.phase = phase; }
}
export function demand(condition, code, phase) { if (!condition) throw new InstallError(code, phase); }
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const own = (value, key) => Object.hasOwn(value, key);
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function exactKeys(value, keys, code = 'schema_invalid') {
  demand(record(value) && Object.keys(value).length === keys.length && keys.every(k => own(value, k)), code);
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const equal = (a, b) => canonical(a) === canonical(b);

/** Reject duplicate/escaped-duplicate keys, excessive nesting and non-finite numbers. */
export function strictJson(text, maxNodes = 100_000) {
  let i = 0, nodes = 0;
  const bad = () => { throw new InstallError('json_invalid'); };
  const ws = () => { while (' \t\r\n'.includes(text[i]) && i < text.length) i++; };
  const string = () => {
    const start = i;
    if (text[i++] !== '"') return bad();
    while (i < text.length) {
      const c = text[i++];
      if (c === '\\') { i++; continue; }
      if (c === '"') { try { return JSON.parse(text.slice(start, i)); } catch { return bad(); } }
    }
    return bad();
  };
  const value = depth => {
    if (depth > 40 || ++nodes > maxNodes) return bad();
    ws();
    if (text[i] === '"') return string();
    if (text[i] === '{') {
      i++; ws(); const result = Object.create(null), keys = new Set();
      if (text[i] === '}') { i++; return result; }
      for (;;) {
        ws(); const k = string();
        if (keys.has(k)) return bad(); keys.add(k); ws();
        if (text[i++] !== ':') return bad();
        result[k] = value(depth + 1); ws();
        if (text[i] === '}') { i++; return result; }
        if (text[i++] !== ',') return bad();
      }
    }
    if (text[i] === '[') {
      i++; ws(); const result = [];
      if (text[i] === ']') { i++; return result; }
      for (;;) {
        result.push(value(depth + 1)); ws();
        if (text[i] === ']') { i++; return result; }
        if (text[i++] !== ',') return bad();
      }
    }
    const start = i;
    while (i < text.length && !',]} \t\r\n'.includes(text[i])) i++;
    try {
      const result = JSON.parse(text.slice(start, i));
      if (result === null || typeof result === 'boolean' || (typeof result === 'number' && Number.isFinite(result))) return result;
    } catch { /* use a bounded diagnostic, not content */ }
    return bad();
  };
  const result = value(0); ws(); if (i !== text.length) return bad(); return result;
}

export function absolute(value) {
  demand(typeof value === 'string' && value.isWellFormed() && path.isAbsolute(value) && value !== path.parse(value).root
    && value === path.normalize(value) && !/[\x00-\x1f\x7f\\]/.test(value)
    && !value.split(path.sep).some(p => p === '.' || p === '..') && !value.endsWith(path.sep), 'absolute_physical_path_required');
  return value;
}
export function relative(value) {
  demand(typeof value === 'string' && value.isWellFormed() && value.length > 0 && !path.isAbsolute(value)
    && value === path.posix.normalize(value) && !/[\x00-\x1f\x7f\\:]/.test(value)
    && !value.split('/').some(p => p === '.' || p === '..' || p === ''), 'relative_path_invalid');
  return value;
}
export const fingerprint = s => [s.dev, s.ino, s.mode, s.size, s.mtimeNs, s.ctimeNs].join(':');
export const inode = s => `${s.dev}:${s.ino}`;
const uid = () => process.getuid();
function trustedOwner(stat) { return stat.uid === uid() || stat.uid === 0; }

/** Never silently canonicalize a destination. /tmp aliases on macOS need a physical path. */
export function pathGuard(name, { missingLeaf = false, privateLeaf = false } = {}) {
  absolute(name); const parts = name.split(path.sep).filter(Boolean); let current = path.parse(name).root;
  for (let n = 0; n < parts.length; n++) {
    current = path.join(current, parts[n]); let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && missingLeaf && n === parts.length - 1) return null;
      throw new InstallError('path_missing_or_unreadable');
    }
    demand(!stat.isSymbolicLink(), 'path_symlink_denied');
    demand(trustedOwner(stat), 'path_owner_invalid');
    const stickySystemAncestor = n < parts.length - 1 && stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o1000);
    demand(!(stat.mode & 0o022) || stickySystemAncestor, 'path_permissions_invalid');
    if (n < parts.length - 1) demand(stat.isDirectory(), 'path_not_directory');
    if (n === parts.length - 1) {
      if (privateLeaf) demand(stat.uid === uid() && (stat.mode & 0o777) === 0o700 && stat.isDirectory(), 'root_not_private_owned');
      return stat;
    }
  }
  throw new InstallError('path_invalid');
}

export function hashFile(name, { maximum = 4 * 1024 ** 3, keep = false, allowEmpty = false } = {}) {
  pathGuard(name);
  const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    demand(before.isFile() && (allowEmpty || before.size > 0n) && before.size <= BigInt(maximum) && !(before.mode & 0o022n), 'artifact_invalid');
    const hash = createHash('sha256'), chunks = [], buffer = Buffer.alloc(1024 * 1024); let total = 0;
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null); if (!count) break;
      total += count; demand(total <= maximum, 'artifact_too_large');
      hash.update(buffer.subarray(0, count)); if (keep) chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    demand(fingerprint(fs.fstatSync(fd, { bigint: true })) === fingerprint(before)
      && fingerprint(fs.lstatSync(name, { bigint: true })) === fingerprint(before) && BigInt(total) === before.size, 'artifact_changed');
    pathGuard(name);
    return { bytes: total, sha256: hash.digest('hex'), data: keep ? Buffer.concat(chunks) : undefined };
  } finally { fs.closeSync(fd); }
}
export function checkFile(name, expected, options) {
  const result = hashFile(name, options);
  demand(result.bytes === expected.bytes && result.sha256 === expected.sha256, 'artifact_integrity_mismatch'); return result;
}
export function writeNew(name, bytes, mode = 0o600) {
  pathGuard(path.dirname(name)); pathGuard(name, { missingLeaf: true });
  const fd = fs.openSync(name, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
/** Copy from an opened no-follow source and hash the exact copied bytes. */
export function copyVerified(source, destination, expected) {
  pathGuard(source); pathGuard(path.dirname(destination));
  const input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); let output;
  try {
    const before = fs.fstatSync(input, { bigint: true });
    demand(before.isFile() && before.size === BigInt(expected.bytes) && !(before.mode & 0o022n), 'artifact_changed');
    output = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024); let total = 0;
    for (;;) {
      const count = fs.readSync(input, buffer, 0, buffer.length, null); if (!count) break;
      total += count; demand(total <= expected.bytes, 'artifact_changed'); hash.update(buffer.subarray(0, count));
      let offset = 0;
      while (offset < count) offset += fs.writeSync(output, buffer, offset, count - offset);
    }
    fs.fsyncSync(output);
    demand(total === expected.bytes && hash.digest('hex') === expected.sha256
      && fingerprint(before) === fingerprint(fs.fstatSync(input, { bigint: true }))
      && fingerprint(before) === fingerprint(fs.lstatSync(source, { bigint: true })), 'artifact_changed');
    pathGuard(source);
  } finally { if (output !== undefined) fs.closeSync(output); fs.closeSync(input); }
}

export function closedTree(root, expected) {
  demand(pathGuard(root).isDirectory(), 'input_not_directory'); const found = [], directories = [];
  const walk = (directory, prefix) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name; relative(rel); const target = path.join(directory, name);
      const stat = pathGuard(target);
      if (stat.isDirectory()) { directories.push(rel); walk(target, rel); }
      else { demand(stat.isFile(), 'input_special_file'); found.push(rel); }
    }
  };
  walk(root, '');
  demand(equal(found.sort(), expected.map(e => e.path).sort()), 'input_inventory_mismatch');
  const allowedDirectories = new Set(expected.flatMap(e => {
    const parts = e.path.split('/'); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
  }));
  demand(directories.every(d => allowedDirectories.has(d)), 'input_inventory_mismatch');
  for (const entry of expected) checkFile(path.join(root, entry.path), entry);
}
export function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
