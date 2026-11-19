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
    '--permission', ...(networkGuard ? ['--import', path.join(root, 'scripts/document-child-network-guard.mjs')] : []),
    '--disable-warning=SecurityWarning', `--allow-fs-read=${root}`,
    ...(allowAddons ? ['--allow-addons'] : []), script, ...args];
  const executable = process.execPath;
  if (process.platform === 'darwin') {
    const profile = '(version 1) (allow default) (deny network*) (deny file-write*) (deny process-fork)';
    return { command: '/usr/bin/sandbox-exec', args: ['-p', profile, executable, ...nodeArgs] };
  }
  if (process.platform === 'linux') {
    const networkNamespace = process.arch === 'arm64'
      ? ['/usr/bin/unshare', '--user', '--map-current-user', '--net', '--']
      : [];
    return { command: '/usr/bin/prlimit', args: [`--data=${DOCUMENT_CHILD_DATA_BYTES}`, '--', ...networkNamespace, executable, ...nodeArgs] };
  }
  return { command: executable, args: nodeArgs };
}
