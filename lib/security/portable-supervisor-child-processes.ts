/* @Codex */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AIP_OPERATION_RPC_ENV_KEY_V1,
  AIP_OPERATION_RPC_LATE_BIND_ENV_V1,
} from '../../packages/aip/src/child-ipc-contract.ts';
import type { LateBoundMcpChildPortV1 } from './authenticated-headless-agent-pre-spawned-mcp-child.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LOADER = path.join(ROOT, 'scripts', 'register-strip-types-loader.mjs');
const MCP_TARGET = path.join(ROOT, 'scripts', 'intelligent-host-mcp-stdio.mjs');
const WEB_DIRECTORY = path.join(ROOT, '.next', 'standalone');
const WEB_TARGET = path.join(WEB_DIRECTORY, 'server.js');
const ROOT_REAL = fs.realpathSync(ROOT);

export type PortableSupervisorChildTerminalReasonV1 = 'web_disconnect' | 'mcp_disconnect';
type TerminalListener = (reason: PortableSupervisorChildTerminalReasonV1) => void;
type SpawnChild = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export type PortableSupervisorChildProcessesOptionsV1 = Readonly<{
  dataDir: string;
  spawnChild?: SpawnChild;
  nodePath?: string;
  loaderPath?: string;
  mcpTargetPath?: string;
  webDirectory?: string;
  webTargetPath?: string;
}>;

export type PortableSupervisorProductionChildProcessesV1 = Readonly<{
  mcpPort: LateBoundMcpChildPortV1;
  subscribeWeb(listener: (frame: unknown) => void): () => void;
  sendWeb(frame: string, complete: (error: Error | null) => void): void;
  onTerminal(listener: TerminalListener): () => void;
  terminateMcp(): void;
  terminateWeb(): void;
  terminateAll(): void;
}>;

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function requireAbsoluteFile(value: string, label: string, root?: string): string {
  if (!path.isAbsolute(value)) throw new Error(`${label}_path_invalid`);
  let stat: fs.Stats, real: string;
  try { stat = fs.lstatSync(value); real = fs.realpathSync(value); }
  catch { throw new Error(`${label}_unavailable`); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label}_unavailable`);
  if (root && !inside(root, real)) throw new Error(`${label}_path_invalid`);
  return real;
}

function requireAbsoluteDirectory(value: string, label: string, root?: string): string {
  if (!path.isAbsolute(value)) throw new Error(`${label}_path_invalid`);
  let stat: fs.Stats, real: string;
  try { stat = fs.lstatSync(value); real = fs.realpathSync(value); }
  catch { throw new Error(`${label}_unavailable`); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label}_unavailable`);
  if (root && !inside(root, real)) throw new Error(`${label}_path_invalid`);
  return real;
}

function stop(child: ChildProcess): void {
  try { if (child.connected) child.disconnect(); } catch { /* terminal */ }
  try {
    if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill();
  } catch { /* terminal */ }
}

/** Creates both production children; no existing process or public listener is adopted. */
export function createPortableSupervisorProductionChildProcessesV1(
  options: PortableSupervisorChildProcessesOptionsV1,
): PortableSupervisorProductionChildProcessesV1 {
  const nodePath = requireAbsoluteFile(options.nodePath ?? process.execPath, 'node');
  const loaderPath = requireAbsoluteFile(options.loaderPath ?? LOADER, 'loader', ROOT_REAL);
  const mcpTargetPath = requireAbsoluteFile(options.mcpTargetPath ?? MCP_TARGET, 'mcp', ROOT_REAL);
  const webDirectory = requireAbsoluteDirectory(options.webDirectory ?? WEB_DIRECTORY, 'web_directory');
  const webTargetPath = requireAbsoluteFile(options.webTargetPath ?? WEB_TARGET, 'web', webDirectory);
  const dataDir = requireAbsoluteDirectory(options.dataDir, 'data_directory');
  if (path.dirname(webTargetPath) !== webDirectory) throw new Error('web_path_invalid');

  const spawnChild = options.spawnChild ?? ((command, args, spawnOptions) =>
    spawn(command, [...args], spawnOptions));
  const mcpEnvironment = {
    [AIP_OPERATION_RPC_ENV_KEY_V1]: AIP_OPERATION_RPC_LATE_BIND_ENV_V1,
  } as unknown as NodeJS.ProcessEnv;
  let mcp: ChildProcess;
  try {
    mcp = spawnChild(nodePath,
      ['--experimental-strip-types', '--import', loaderPath, mcpTargetPath], {
        cwd: ROOT_REAL,
        env: mcpEnvironment,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      });
  } catch { throw new Error('mcp_spawn_failed'); }

  let web: ChildProcess;
  try {
    web = spawnChild(nodePath, [webTargetPath], {
      cwd: webDirectory,
      env: { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3000', MEDIFLOW_DATA_DIR: dataDir },
      // Descriptor 2 is the Supervisor's stderr. Its stdout remains reserved for the MCP child.
      stdio: ['ignore', 2, 2, 'ipc'],
    });
  } catch { stop(mcp); throw new Error('web_spawn_failed'); }

  const terminalListeners = new Set<TerminalListener>();
  let terminalReason: PortableSupervisorChildTerminalReasonV1 | null = null;
  let stoppingMcp = false, stoppingWeb = false;
  const terminal = (reason: PortableSupervisorChildTerminalReasonV1): void => {
    if (terminalReason) return;
    terminalReason = reason;
    for (const listener of [...terminalListeners]) {
      try { listener(reason); } catch { /* terminal */ }
    }
  };
  const watch = (child: ChildProcess, reason: PortableSupervisorChildTerminalReasonV1,
    intentionallyStopping: () => boolean): void => {
    const ended = () => { if (!intentionallyStopping()) terminal(reason); };
    child.once('error', ended); child.once('exit', ended); child.once('disconnect', ended);
  };
  watch(mcp, 'mcp_disconnect', () => stoppingMcp);
  watch(web, 'web_disconnect', () => stoppingWeb);

  const terminateMcp = (): void => {
    if (stoppingMcp) return;
    stoppingMcp = true; stop(mcp);
  };
  const terminateWeb = (): void => {
    if (stoppingWeb) return;
    stoppingWeb = true; stop(web);
  };
  const mcpPort: LateBoundMcpChildPortV1 = Object.freeze({
    connection: Object.freeze(Object.create(null)) as object,
    subscribe: (listener: (frame: unknown) => void) => {
      mcp.on('message', listener); return () => { mcp.off('message', listener); };
    },
    publish: (frame: string) => {
      if (stoppingMcp || !mcp.connected) throw new Error('mcp_disconnected');
      mcp.send(frame, (error) => { if (error && !stoppingMcp) terminal('mcp_disconnect'); });
    },
    onClose: (listener: () => void) => {
      mcp.once('error', listener); mcp.once('exit', listener); mcp.once('disconnect', listener);
      return () => {
        mcp.off('error', listener); mcp.off('exit', listener); mcp.off('disconnect', listener);
      };
    },
    terminate: terminateMcp,
  });
  return Object.freeze({
    mcpPort,
    subscribeWeb: (listener: (frame: unknown) => void) => {
      web.on('message', listener); return () => { web.off('message', listener); };
    },
    sendWeb: (frame: string, complete: (error: Error | null) => void) => {
      if (stoppingWeb || !web.connected) { complete(new Error('web_disconnected')); return; }
      web.send(frame, (error) => { complete(error ?? null); });
    },
    onTerminal: (listener: TerminalListener) => {
      if (terminalReason) { try { listener(terminalReason); } catch { /* terminal */ } }
      else terminalListeners.add(listener);
      return () => { terminalListeners.delete(listener); };
    },
    terminateMcp,
    terminateWeb,
    terminateAll: () => { terminateMcp(); terminateWeb(); },
  });
}
