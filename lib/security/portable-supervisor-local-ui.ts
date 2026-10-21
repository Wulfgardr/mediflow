import { createAipOperationRpcHostV1 } from '../../packages/aip/src/operation-rpc.ts';
import { LOCAL_UI_IPC_SCHEMA, LOCAL_UI_OPERATION, LOCAL_UI_RESULT,
  localUiArgumentsSchema } from '../../packages/mcp/src/local-ui-contract.ts';
import { createPortableSupervisorProductionChildProcessesV1,
  type PortableSupervisorChildProcessesOptionsV1,
  type PortableSupervisorProductionChildProcessesV1 } from './portable-supervisor-child-processes.ts';

export const LOCAL_UI_WEB_READY = '{"schemaVersion":"mediflow.local-ui.ready.v1"}';
const READY_TIMEOUT_MS = 8_000;

export function createLocalUiSupervisorRuntime(children: PortableSupervisorProductionChildProcessesV1) {
  let terminal = false, ready = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const waiters = new Set<(available: boolean) => void>();
  const offWeb = children.subscribeWeb(frame => {
    if (terminal || frame !== LOCAL_UI_WEB_READY) return;
    ready = true;
    for (const waiter of [...waiters]) waiter(true);
  });
  const transportReady = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (ready && !terminal && !signal.aborted) { resolve(); return; }
    if (terminal || signal.aborted) { reject(new Error('navigation_unavailable')); return; }
    const finish = (available: boolean) => {
      if (!waiters.delete(finish)) return;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (available) resolve(); else reject(new Error('navigation_unavailable'));
    };
    const abort = () => finish(false);
    const timer = setTimeout(abort, READY_TIMEOUT_MS);
    waiters.add(finish); signal.addEventListener('abort', abort, { once: true });
  });
  const rpc = createAipOperationRpcHostV1({ operations: [{ ...LOCAL_UI_OPERATION, timeoutMs: 9_000,
    async execute(input: unknown, signal: AbortSignal) {
      const parsed = localUiArgumentsSchema.safeParse(input);
      if (terminal || signal.aborted || !parsed.success) throw new Error('navigation_unavailable');
      await transportReady(signal);
      if (terminal || signal.aborted) throw new Error('navigation_unavailable');
      children.sendWeb(JSON.stringify({ schemaVersion: LOCAL_UI_IPC_SCHEMA, intent: parsed.data.intent }),
        error => { if (error) terminate(); });
      return LOCAL_UI_RESULT;
    },
  }] });
  const handle = rpc.attach({ subscribe: children.mcpPort.subscribe, publish: children.mcpPort.publish });
  let offChild = () => {};
  const terminate = () => {
    if (terminal) return false;
    terminal = true;
    for (const waiter of [...waiters]) waiter(false);
    offWeb(); rpc.revoke(handle); offChild(); children.terminateAll(); resolveClosed();
    return true;
  };
  offChild = children.onTerminal(terminate);
  return Object.freeze({ closed, terminate });
}

export function createLocalUiSupervisorProduction(
  options: Pick<PortableSupervisorChildProcessesOptionsV1,
    'spawnChild' | 'webDirectory' | 'webTargetPath' | 'webBuildIdentity'> = {},
) {
  const dataDir = process.env.MEDIFLOW_DATA_DIR;
  if (!dataDir) throw new Error('data_directory_required');
  const children = createPortableSupervisorProductionChildProcessesV1({ ...options, dataDir, agentKind: 'plugin_local_ui' });
  try { return createLocalUiSupervisorRuntime(children); }
  catch (error) { children.terminateAll(); throw error; }
}
