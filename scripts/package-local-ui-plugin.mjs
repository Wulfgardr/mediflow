import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySourceRuntime } from './source-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export function packageLocalUiPlugin(destination, dataDir, sourceRoot = root) {
  if (!path.isAbsolute(destination) || fs.existsSync(destination) || !path.isAbsolute(dataDir)
    || fs.realpathSync(dataDir) !== dataDir || !fs.statSync(dataDir).isDirectory()) throw new Error('Package paths unavailable');
  const { identity } = verifySourceRuntime(sourceRoot);
  if (process.version !== 'v24.21.0') throw new Error('Node 24.21.0 required');
  const source = path.join(root, 'plugins/mediflow-local-ui');
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false, filter: file => !file.endsWith('/runtime.json') });
  const nodePath = fs.realpathSync(process.execPath);
  fs.writeFileSync(path.join(destination, 'runtime.json'), JSON.stringify({ schemaVersion: 1,
    nodePath, sourceRoot: fs.realpathSync(sourceRoot), revision: identity.revision, dataDir }) + '\n', { flag: 'wx' });
  for (const manifest of ['mcp.json', '.mcp.codex.json', '.mcp.claude.json']) {
    const file = path.join(destination, manifest), value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.mcpServers['mediflow-local-ui'].command = nodePath;
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  }
  return { revision: identity.revision, destination };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Expected absolute destination and data directory');
    process.stdout.write(JSON.stringify(packageLocalUiPlugin(process.argv[2], process.argv[3])) + '\n');
  } catch { process.stderr.write('MediFlow local UI package unavailable; an admitted build and canonical paths are required.\n'); process.exitCode = 1; }
}
