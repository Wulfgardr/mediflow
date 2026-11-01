import path from 'node:path';
export const DOCUMENT_CHILD_HEAP_MB = 256;
export const DOCUMENT_CHILD_DATA_BYTES = 1024 * 1024 * 1024;

/** @param {string} root
 * @param {string} script
 * @param {{allowAddons?: boolean, args?: readonly string[], wasmMemoryPages?: number, networkGuard?: boolean}} options
 */
export function documentChildLaunch(root, script, { allowAddons = false, args = [], wasmMemoryPages, networkGuard = true } = {}) {
  const nodeArgs = [`--max-old-space-size=${DOCUMENT_CHILD_HEAP_MB}`,
    ...(wasmMemoryPages ? [`--wasm-max-mem-pages=${wasmMemoryPages}`] : []),
    '--permission', ...(networkGuard ? ['--import', path.join(root, 'scripts/document-child-network-guard.mjs')] : []), '--disable-warning=SecurityWarning', `--allow-fs-read=${root}`,
    ...(allowAddons ? ['--allow-addons'] : []), script, ...args];
  return boundedDocumentLaunch(process.execPath, nodeArgs, root);
}

/** @param {string} executable
 * @param {readonly string[]} args
 * @param {string} root
 */
export function boundedDocumentLaunch(executable, args, root) {
  if (process.platform === 'darwin') {
    const profile = '(version 1) (allow default) (deny network*) (deny file-write*)';
    return { command: '/usr/bin/sandbox-exec', args: ['-p', profile, executable, ...args] };
  }
  if (process.platform === 'linux') {
    return { command: '/usr/bin/prlimit', args: [`--data=${DOCUMENT_CHILD_DATA_BYTES}`, '--', executable, ...args] };
  }
  return { command: executable, args };
}
