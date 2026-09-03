/* @Codex */
import assert from 'node:assert/strict';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { createPortableSupervisorProductionChildProcessesV1 } from
  './portable-supervisor-child-processes.ts';

class SyntheticChild extends EventEmitter {
  connected = true;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  sent: string[] = [];
  pendingCallbacks: Array<(error: Error | null) => void> = [];

  send(frame: string, callback?: (error: Error | null) => void): boolean {
    this.sent.push(frame);
    if (callback) this.pendingCallbacks.push(callback);
    return true;
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false; this.emit('disconnect');
  }

  kill(): boolean { this.killed = true; return true; }
}

const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-supervisor-children-')));
const repoRoot = fs.realpathSync(process.cwd());
const webDirectory = path.join(fixtureRoot, 'standalone');
const dataDir = path.join(fixtureRoot, 'data');
const paths = {
  nodePath: path.join(fixtureRoot, 'node'),
  loaderPath: path.join(repoRoot, 'scripts', 'register-strip-types-loader.mjs'),
  mcpTargetPath: path.join(repoRoot, 'scripts', 'intelligent-host-mcp-stdio.mjs'),
  webDirectory,
  webTargetPath: path.join(webDirectory, 'server.js'),
};
fs.mkdirSync(webDirectory); fs.mkdirSync(dataDir);
for (const file of [paths.nodePath, paths.webTargetPath]) {
  fs.writeFileSync(file, 'synthetic fixture\n');
}
after(() => { fs.rmSync(fixtureRoot, { recursive: true, force: true }); });

function setup() {
  const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
  const children = [new SyntheticChild(), new SyntheticChild()];
  const processes = createPortableSupervisorProductionChildProcessesV1({
    dataDir, ...paths,
    spawnChild: (command, args, options) => {
      calls.push({ command, args, options });
      return children[calls.length - 1] as unknown as ChildProcess;
    },
  });
  return { calls, children, processes };
}

test('spawns one marker-only MCP child with a file URL loader and one direct loopback Web child', () => {
  const current = setup();
  assert.equal(current.calls.length, 2);
  const [mcp, web] = current.calls;
  assert.equal(mcp?.command, paths.nodePath);
  assert.deepEqual(mcp?.args, [
    '--experimental-strip-types', '--import', pathToFileURL(paths.loaderPath).href, paths.mcpTargetPath,
  ]);
  assert.deepEqual(mcp?.options.stdio, ['inherit', 'inherit', 'inherit', 'ipc']);
  assert.deepEqual(mcp?.options.env, {
    MEDIFLOW_AIP_OPERATION_RPC: 'late_bound_authenticated_inherited_child_ipc_v1',
  });
  assert.doesNotMatch(JSON.stringify(mcp?.options.env), /bootstrap|cookie|pin|password|secret|token/iu);

  assert.equal(web?.command, paths.nodePath);
  assert.deepEqual(web?.args, [paths.webTargetPath]);
  assert.equal(web?.options.cwd, webDirectory);
  assert.deepEqual(web?.options.stdio, ['ignore', 2, 2, 'ipc']);
  assert.deepEqual(web?.options.env, {
    NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3000', MEDIFLOW_DATA_DIR: dataDir,
  });
  current.processes.terminateAll();
});

test('routes only the exact spawned children and reports unexpected lifecycle loss once', () => {
  const current = setup();
  const webFrames: unknown[] = [], terminal: string[] = [];
  current.processes.subscribeWeb((frame) => { webFrames.push(frame); });
  current.processes.onTerminal((reason) => { terminal.push(reason); });
  current.children[1]?.emit('message', 'synthetic-web-frame');
  current.children[0]?.emit('message', 'synthetic-mcp-frame');
  assert.deepEqual(webFrames, ['synthetic-web-frame']);
  current.children[0]?.emit('error', new Error('synthetic exit'));
  current.children[0]?.emit('disconnect'); current.children[1]?.emit('exit', 1);
  assert.deepEqual(terminal, ['mcp_disconnect']);
  current.processes.terminateAll();
});

test('keeps intentional shutdown terminal-silent and completes Web sends via callback', () => {
  const current = setup();
  const terminal: string[] = [], callbacks: Array<Error | null> = [];
  current.processes.onTerminal((reason) => { terminal.push(reason); });
  current.processes.sendWeb('synthetic-response', (error) => { callbacks.push(error); });
  assert.deepEqual(current.children[1]?.sent, ['synthetic-response']);
  assert.deepEqual(callbacks, []);
  current.children[1]?.pendingCallbacks.shift()?.(null);
  assert.deepEqual(callbacks, [null]);
  current.processes.terminateMcp(); current.processes.terminateWeb();
  assert.deepEqual(terminal, []);
  assert.equal(current.children.every((child) => child.killed), true);
});

test('fails before spawning when a deterministic runtime path is missing or relative', () => {
  let spawns = 0;
  const spawnChild = () => { spawns += 1; return new SyntheticChild() as unknown as ChildProcess; };
  assert.throws(() => createPortableSupervisorProductionChildProcessesV1({
    dataDir: 'relative-data', ...paths, spawnChild,
  }), /data_directory_path_invalid/u);
  assert.throws(() => createPortableSupervisorProductionChildProcessesV1({
    dataDir, ...paths, webTargetPath: path.join(webDirectory, 'missing.js'), spawnChild,
  }), /web_unavailable/u);
  assert.equal(spawns, 0);
});

test('rejects symlinked executable, runtime, Web and data targets before spawning', (context) => {
  const links = {
    nodePath: path.join(fixtureRoot, 'node-link'), loaderPath: path.join(fixtureRoot, 'loader-link.mjs'),
    mcpTargetPath: path.join(fixtureRoot, 'mcp-link.mjs'), webTargetPath: path.join(webDirectory, 'server-link.js'),
    webDirectory: path.join(fixtureRoot, 'standalone-link'), dataDir: path.join(fixtureRoot, 'data-link'),
  };
  try {
    fs.symlinkSync(paths.nodePath, links.nodePath, 'file');
    fs.symlinkSync(paths.loaderPath, links.loaderPath, 'file');
    fs.symlinkSync(paths.mcpTargetPath, links.mcpTargetPath, 'file');
    fs.symlinkSync(paths.webTargetPath, links.webTargetPath, 'file');
    fs.symlinkSync(webDirectory, links.webDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(dataDir, links.dataDir, process.platform === 'win32' ? 'junction' : 'dir');
  } catch { context.skip('symlink creation is unavailable'); return; }
  let spawns = 0;
  const spawnChild = () => { spawns += 1; return new SyntheticChild() as unknown as ChildProcess; };
  for (const override of [
    { nodePath: links.nodePath }, { loaderPath: links.loaderPath }, { mcpTargetPath: links.mcpTargetPath },
    { webDirectory: links.webDirectory, webTargetPath: path.join(links.webDirectory, 'server.js') },
    { webTargetPath: links.webTargetPath }, { dataDir: links.dataDir },
  ]) {
    assert.throws(() => createPortableSupervisorProductionChildProcessesV1({
      dataDir, ...paths, ...override, spawnChild,
    }), /(?:unavailable|path_invalid)/u);
  }
  assert.equal(spawns, 0);
});
