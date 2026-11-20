import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stageWindowsDocumentChild } from './document-windows-sandbox.mjs';
export const DOCUMENT_CHILD_HEAP_MB = 256;
export const DOCUMENT_CHILD_DATA_BYTES = 1024 * 1024 * 1024;
const documentEnvironment = Object.freeze({ NODE_ENV: 'production', NAPI_RS_ENFORCE_VERSION_CHECK: '1' });

/** @param {string} root
 * @param {string} script
 * @param {{allowAddons?: boolean, args?: readonly string[], wasmMemoryPages?: number, networkGuard?: boolean}} options
 */
export function documentChildLaunch(root, script, { allowAddons = false, args = [], wasmMemoryPages, networkGuard = true } = {}) {
  const env = { ...documentEnvironment };
  const localAppData = process.env.LOCALAPPDATA;
  if (process.platform === 'win32' && (!localAppData || !path.isAbsolute(localAppData))) {
    throw new Error('Windows document sandbox requires LOCALAPPDATA.');
  }
  const windowsEnv = { ...env, LOCALAPPDATA: localAppData };
  const windows = process.platform === 'win32' ? stageWindowsDocumentChild(root, windowsEnv) : undefined;
  const workerRoot = windows?.root ?? root;
  const worker = windows && path.isAbsolute(script) ? path.join(workerRoot, path.relative(root, script)) : script;
  const nodeArgs = [`--max-old-space-size=${DOCUMENT_CHILD_HEAP_MB}`,
    ...(windows ? ['--preserve-symlinks', '--preserve-symlinks-main'] : []),
    ...(wasmMemoryPages ? [`--wasm-max-mem-pages=${wasmMemoryPages}`] : []),
    '--permission', ...(networkGuard ? ['--import', pathToFileURL(path.join(workerRoot, 'scripts/document-child-network-guard.mjs')).href] : []),
    '--disable-warning=SecurityWarning', `--allow-fs-read=${workerRoot}`,
    ...(allowAddons ? ['--allow-addons'] : []), worker, ...args];
  if (windows) return { ...windows.launch(nodeArgs), env: windowsEnv };
  const executable = process.execPath;
  if (process.platform === 'darwin') {
    const profile = '(version 1) (allow default) (deny network*) (deny file-write*) (deny process-fork)';
    return { command: '/usr/bin/sandbox-exec', args: ['-p', profile, executable, ...nodeArgs], cleanup: undefined, env };
  }
  if (process.platform === 'linux') {
    const networkNamespace = process.arch === 'arm64'
      ? ['/usr/bin/unshare', '--user', '--map-current-user', '--net', '--']
      : [];
    return { command: '/usr/bin/prlimit', args: [`--data=${DOCUMENT_CHILD_DATA_BYTES}`, '--', ...networkNamespace, executable, ...nodeArgs], cleanup: undefined, env };
  }
  return { command: executable, args: nodeArgs, cleanup: undefined, env };
}
