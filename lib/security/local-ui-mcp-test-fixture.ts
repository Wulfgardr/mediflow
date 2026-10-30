import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { LOCAL_UI_WEB_READY, createLocalUiSupervisorRuntime } from './portable-supervisor-local-ui.ts';
import type { PortableSupervisorProductionChildProcessesV1 } from './portable-supervisor-child-processes.ts';
import { LOCAL_UI_RPC_MODE, type LocalUiIntent } from '../../packages/mcp/src/local-ui-contract.ts';

const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'synthetic-local-ui-test', version: '1' } };

export function fixture(ready = true, navigate?: (intent: LocalUiIntent, signal: AbortSignal) => Promise<void>) {
  const child = spawn(process.execPath, ['--import', pathToFileURL(`${process.cwd()}/scripts/register-strip-types-loader.mjs`).href,
    'scripts/local-ui-mcp-stdio.mjs'], { env: { MEDIFLOW_DATA_DIR: process.env.MEDIFLOW_DATA_DIR, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', NODE_ENV: 'test', MEDIFLOW_AIP_OPERATION_RPC: LOCAL_UI_RPC_MODE, NODE_NO_WARNINGS: '1' },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const pending = new Map<number, (value: any) => void>();
  const wire: string[] = [], web: string[] = [], stderr: string[] = [];
  const childFrames: Record<string, unknown>[] = [], parentFrames: Record<string, unknown>[] = [];
  child.on('message', frame => { if (typeof frame === 'string') childFrames.push(JSON.parse(frame)); });
  let buffer = '', counter = 0, terminal: (() => void) | undefined, stopped = false;
  child.stdout!.setEncoding('utf8'); child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', text => stderr.push(text));
  child.stdout!.on('data', text => {
    buffer += text;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n'), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      wire.push(line); const value = JSON.parse(line); pending.get(value.id)?.(value); pending.delete(value.id);
    }
  });
  const port = { connection: {}, subscribe(listener: (frame: unknown) => void) {
    child.on('message', listener); return () => { child.off('message', listener); };
  }, publish(frame: string) { parentFrames.push(JSON.parse(frame)); child.send(frame); }, onClose() { return () => {}; }, terminate() { child.kill(); } };
  let webListener: ((frame: unknown) => void) | undefined;
  const children = { mcpPort: port, subscribeWeb(listener: (frame: unknown) => void) { webListener = listener; return () => {}; },
    sendWeb(frame: string, done: (error: Error | null) => void) { web.push(frame); done(null); },
    onTerminal(listener: () => void) { terminal = listener; return () => { terminal = undefined; }; },
    terminateAll() { stopped = true; child.kill(); }, terminateMcp() { child.kill(); }, terminateWeb() {} };
  const runtime = createLocalUiSupervisorRuntime(children as unknown as PortableSupervisorProductionChildProcessesV1, navigate);
  if (ready) webListener?.(LOCAL_UI_WEB_READY);
  const request = (method: string, params: object, timeout = 5_000) => {
    const id = ++counter;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('synthetic_timeout')), timeout);
      pending.set(id, value => { clearTimeout(timer); resolve(value); });
      child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: META } }) + '\n');
    });
  };
  const detachedRequest = (method: string, params: object) => {
    const id = ++counter;
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: META } }) + '\n');
    return id;
  };
  const notify = (method: string, params: object) => child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return { request, detachedRequest, notify, childFrames, parentFrames, web, wire, stderr, runtime, ready: () => webListener?.(LOCAL_UI_WEB_READY), terminal: () => terminal?.(), stopped: () => stopped, child };
}

