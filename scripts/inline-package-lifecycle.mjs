import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';

const names = ['mediflow-chat-demo', 'mediflow-synthetic', 'mediflow-local-ui'];
export function isolatedHost(root, host, binary) {
  if (!path.isAbsolute(root) || !['codex', 'claude-code', 'claude-desktop'].includes(host)) throw new Error('Explicit absolute root and supported host required');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  root = fs.realpathSync(root);
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const env = { HOME: home, PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
    CODEX_HOME: path.join(root, 'codex'), CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false' };
  for (const dir of [env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const config = host === 'codex' ? path.join(env.CODEX_HOME, 'config.toml')
    : host === 'claude-code' ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json')
      : path.join(root, 'desktop', 'claude_desktop_config.json');
  const run = args => {
    if (!binary || !path.isAbsolute(binary)) throw new Error('Absolute host binary required');
    const r = spawnSync(binary, args, { cwd: home, env, encoding: 'utf8', timeout: 30000 });
    if (r.error || r.status !== 0) throw new Error(`Host command failed: ${r.error?.message ?? r.stderr}`);
    return r.stdout;
  };
  return { root, host, config, env, run };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

// Codex reports every launch setting; any value beyond the recorded command and args
// (environment, working directory, timeouts, disabled state) counts as a local change.
function codexServer({ transport, enabled, startup_timeout_sec, tool_timeout_sec }) {
  const { type, command, args, env, env_vars: envVars, cwd, ...rest } = transport;
  const server = { type, command, args };
  const extra = { ...rest, enabled, startup_timeout_sec, tool_timeout_sec, env, env_vars: envVars, cwd };
  const defaults = { enabled: true, startup_timeout_sec: null, tool_timeout_sec: null, env: null, env_vars: [], cwd: null };
  for (const [key, value] of Object.entries(extra)) {
    const empty = value === undefined || isDeepStrictEqual(value, defaults[key])
      || (key === 'env' && value && Object.keys(value).length === 0);
    if (!empty) server[key] = value;
  }
  return server;
}

export function changeInlinePackage(target, action, packageRoot, name) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node 24.x required');
  if (!['install', 'revoke'].includes(action)) throw new Error('Expected install or revoke');
  let version, server;
  if (action === 'install') {
    packageRoot = fs.realpathSync(packageRoot);
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'plugin.json')));
    name = manifest.name; version = manifest.version;
    if (!names.includes(name) || typeof version !== 'string') throw new Error('Unsupported package');
    const entry = path.join(packageRoot, 'src', name === 'mediflow-local-ui' ? 'launch.mjs' : 'stdio.mjs');
    fs.accessSync(entry);
    if (name === 'mediflow-local-ui') fs.accessSync(path.join(packageRoot, 'runtime.json'));
    else fs.accessSync(path.join(packageRoot, 'dist/app.html'));
    server = { type: 'stdio', command: fs.realpathSync(process.execPath), args: [entry] };
  }
  if (!names.includes(name)) throw new Error('Unsupported package');
  const state = path.join(target.root, 'receipts', target.host, name);
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  const lock = path.join(target.root, `${target.host}.lock`);
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    const receiptFile = path.join(state, 'receipt.json'), auditFile = path.join(state, 'audit.jsonl');
    const previous = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile)) : null;
    let document, current;
    if (target.host === 'codex') {
      const servers = JSON.parse(target.run(['mcp', 'list', '--json']));
      current = servers.find(item => item.name === name);
      if (current) current = codexServer(current);
    } else {
      document = fs.existsSync(target.config) ? JSON.parse(fs.readFileSync(target.config)) : {};
      current = document.mcpServers?.[name];
    }
    if (current && (!previous?.active || !isDeepStrictEqual(current, previous.server))) throw new Error('Unmanaged or changed server; refusing overwrite');
    const event = { action: action === 'install' && previous?.active ? 'upgrade' : action,
      name, version: version ?? previous?.version, previousVersion: previous?.version ?? null,
      at: new Date().toISOString() };
    fs.appendFileSync(auditFile, JSON.stringify({ ...event, status: 'pending' }) + '\n', { mode: 0o600 });
    if (target.host === 'codex') {
      if (action === 'install') target.run(['mcp', 'add', name, '--', server.command, ...server.args]);
      else if (current) target.run(['mcp', 'remove', name]);
    } else {
      document.mcpServers ??= {};
      if (action === 'install') document.mcpServers[name] = server;
      else delete document.mcpServers[name];
      writeJson(target.config, document);
    }
    const receipt = { ...event, active: action === 'install', server: server ?? previous?.server };
    writeJson(receiptFile, receipt);
    fs.appendFileSync(auditFile, JSON.stringify({ ...event, status: 'complete' }) + '\n');
    return { receiptFile, auditFile, config: target.config, receipt };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, host, root, value, binary] = process.argv.slice(2);
  try {
    const target = isolatedHost(root, host, binary);
    process.stdout.write(JSON.stringify(changeInlinePackage(target, action,
      action === 'install' ? value : undefined, action === 'revoke' ? value : undefined)) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
