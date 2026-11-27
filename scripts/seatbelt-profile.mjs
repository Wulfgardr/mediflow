import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const SEATBELT_PROFILE_MODULE = 'scripts/seatbelt-profile.mjs';

const BROAD_EXEC_SUBPATHS = new Set([
  '/', '/usr', '/usr/bin', '/usr/sbin', '/usr/local', '/usr/local/bin',
  '/bin', '/sbin', '/Applications', '/Library', '/System', '/private',
  '/private/tmp', '/tmp', '/var', '/private/var', '/Users',
]);

/** @param {string} file */
function assertSafeAbsolutePath(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || /[\x00-\x1f\x7f]/u.test(file)) {
    throw new Error('seatbelt-program-path');
  }
}

/** @param {string} file */
function resolvePath(file) {
  assertSafeAbsolutePath(file);
  try {
    return realpathSync(file);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return file;
    throw error;
  }
}

/** @param {string} file */
function literal(file) {
  assertSafeAbsolutePath(file);
  return `(literal ${JSON.stringify(file)})`;
}

/** @param {string} directory */
function subpath(directory) {
  const resolved = resolvePath(directory).replace(/\/+$/u, '') || '/';
  if (BROAD_EXEC_SUBPATHS.has(resolved)) throw new Error('seatbelt-broad-exec-subpath');
  return `(subpath ${JSON.stringify(resolved)})`;
}

/**
 * Seatbelt profile that always denies LaunchServices, Apple Events, and arbitrary
 * program execution, allowing only exact executables (and optional narrow tool directories).
 * @param {{ rules: string, programs: readonly string[], programSubpaths?: readonly string[] }} options
 */
export function seatbeltProfile({ rules, programs, programSubpaths = [] }) {
  if (typeof rules !== 'string' || /\((?:allow|deny)\s+(?:default|lsopen|appleevent-send|process-exec)/u.test(rules)) {
    throw new Error('seatbelt-rules');
  }
  if (!Array.isArray(programs) || programs.length === 0) throw new Error('seatbelt-programs');
  if (!Array.isArray(programSubpaths)) throw new Error('seatbelt-program-subpaths');
  const literalFilters = [...new Set(programs.map(resolvePath))].map(literal);
  const subpathFilters = [...new Set(programSubpaths.map(entry => resolvePath(entry).replace(/\/+$/u, '') || '/'))].map(subpath);
  const allowed = [...literalFilters, ...subpathFilters].join(' ');
  return `(version 1) (allow default) ${rules} (deny process-exec) (allow process-exec ${allowed}) (deny lsopen) (deny appleevent-send)`;
}

/**
 * Resolves the exact executable chain a Python interpreter or venv entry point needs under Seatbelt on macOS.
 * @param {string} executable
 * @returns {string[]}
 */
export function pythonExecutablesForSandbox(executable) {
  assertSafeAbsolutePath(executable);
  const resolved = new Set();
  const pending = [executable];
  while (pending.length > 0) {
    const candidate = pending.pop();
    const target = resolvePath(candidate);
    if (resolved.has(target)) continue;
    resolved.add(target);
    if (process.platform === 'darwin' && target === '/usr/bin/python3') {
      try {
        const developerPython = execFileSync('/usr/bin/xcrun', ['--find', 'python3'], {
          encoding: 'utf8',
          env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
          timeout: 5_000,
        }).trim();
        if (path.isAbsolute(developerPython)) pending.push(developerPython);
      } catch {}
    }
    const frameworkApp = path.resolve(path.dirname(target), '../Resources/Python.app/Contents/MacOS/Python');
    if (existsSync(frameworkApp)) pending.push(frameworkApp);
    try {
      const head = readFileSync(target).subarray(0, 512).toString('latin1');
      if (head.startsWith('#!')) {
        const firstLine = head.split(/\r?\n/u, 1)[0];
        const interpreter = firstLine.slice(2).trim().split(/\s+/u)[0];
        if (interpreter && path.isAbsolute(interpreter)) pending.push(interpreter);
        const execMatch = /'''exec'\s+'((?:[^']|'\\''|'"'"')*)'/u.exec(head);
        const execTarget = execMatch?.[1].replaceAll("'\\''", "'").replaceAll(`'"'"'`, "'");
        if (execTarget && path.isAbsolute(execTarget)) pending.push(execTarget);
      }
    } catch {}
  }
  return [...resolved];
}

/**
 * Resolves the exact executable chain a Java launcher needs under Seatbelt on macOS.
 * @param {string} executable
 * @returns {string[]}
 */
export function javaExecutablesForSandbox(executable) {
  assertSafeAbsolutePath(executable);
  const resolved = new Set([resolvePath(executable)]);
  if (process.platform === 'darwin' && resolved.has('/usr/bin/java')) {
    if (existsSync('/usr/libexec/java_home')) {
      resolved.add(resolvePath('/usr/libexec/java_home'));
      try {
        const javaHome = execFileSync('/usr/libexec/java_home', [], {
          encoding: 'utf8',
          env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
          timeout: 5_000,
        }).trim();
        const jdkJava = path.join(javaHome, 'bin', 'java');
        if (path.isAbsolute(jdkJava) && existsSync(jdkJava)) resolved.add(resolvePath(jdkJava));
      } catch {}
    }
  }
  return [...resolved];
}
