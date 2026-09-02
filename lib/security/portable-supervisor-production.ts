/* @Codex */
import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

import { createPortableSupervisorContextMirrorV1 } from
  '../../packages/aip/src/portable-supervisor-context-mirror.ts';
import {
  createPortableSupervisorWebControlV1,
} from '../../packages/aip/src/portable-supervisor-web-control.ts';
import { decodePortableSupervisorWebIpcFrameV1 } from
  '../../packages/aip/src/portable-supervisor-web-ipc-contract.ts';
import { getDataDir } from '../data-dir';
import { createCheckupStatusTransitionSupervisorPortV1 } from
  './checkup-status-transition-supervisor-port.ts';
import { createProductionMcpAgentLauncherWithPreSpawnedChildV1 } from
  './authenticated-headless-agent-launcher-production.ts';
import { createPortableSupervisorAipAuditPortV1 } from './portable-supervisor-aip-audit-port.ts';
import {
  createPortableSupervisorProductionChildProcessesV1,
  type PortableSupervisorProductionChildProcessesV1,
} from './portable-supervisor-child-processes.ts';
import { createPortableSupervisorPatientVersionProductionV1 } from
  './portable-supervisor-patient-version-production.ts';
import { createPortableSupervisorSemanticAuditPortV1 } from
  './portable-supervisor-semantic-audit-port.ts';

type TerminalReason = 'logout' | 'application_lock' | 'reselection' | 'expiry'
  | 'web_disconnect' | 'mcp_disconnect' | 'restart' | 'explicit';
type MirrorPort = Readonly<{
  activate(capture: unknown): boolean;
  readHostContext(): Readonly<Record<string, unknown>>;
  revoke(): boolean;
}>;
type AuthenticatedSession = Readonly<{
  schemaVersion: 'mediflow.headless.authenticated-launch.v1';
  status: 'authenticated';
  close(): boolean;
}>;
type RuntimeSources = Readonly<{
  now(): number;
  nextChallenge(): string;
  schedule(delayMs: number, callback: () => void): () => void;
  mirror: MirrorPort;
  launchMcp(): Promise<AuthenticatedSession>;
  checkup: Readonly<{ acceptWebFrame(frame: unknown): boolean; close(): boolean }>;
  children: PortableSupervisorProductionChildProcessesV1;
}>;

// The ACK send callback proves queueing, so keep the authority-free Web child alive to drain its HTTP response.
export const PORTABLE_SUPERVISOR_WEB_ACK_DRAIN_MS_V1 = 250;
export const PORTABLE_SUPERVISOR_WEB_ACK_QUEUE_TIMEOUT_MS_V1 = 250;

export type PortableSupervisorProductionRuntimeV1 = Readonly<{
  closed: Promise<void>;
  terminate(reason?: TerminalReason): boolean;
}>;

function terminalFromMirror(reason: string): TerminalReason {
  if (reason === 'expired') return 'expiry';
  if (reason === 'restarted') return 'restart';
  return 'explicit';
}

/** Orchestrates the closed inherited-IPC topology. Sources are injectable only for runtime tests. */
export function createPortableSupervisorProductionRuntimeV1(
  sources: RuntimeSources,
): PortableSupervisorProductionRuntimeV1 {
  const { children, mirror } = sources;
  let session: AuthenticatedSession | null = null;
  let authorityRevoked = false, terminal = false, ackPending = false, cleaned = false;
  let cancelAckQueue: (() => void) | null = null;
  let cancelAckDrain: (() => void) | null = null;
  let unsubscribeWeb: () => void = () => undefined;
  let unsubscribeChild: () => void = () => undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });

  const revokeAuthority = (): void => {
    if (authorityRevoked) return;
    authorityRevoked = true; ackPending = true;
    let failed = false;
    const current = session; session = null;
    try { current?.close(); } catch { failed = true; }
    try { mirror.revoke(); } catch { failed = true; }
    try { sources.checkup.close(); } catch { failed = true; }
    try { children.terminateMcp(); } catch { failed = true; }
    if (failed) throw new Error('revoke_failed');
  };
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    const cancelQueue = cancelAckQueue; cancelAckQueue = null;
    const cancel = cancelAckDrain; cancelAckDrain = null;
    try { cancelQueue?.(); } catch { /* terminal */ }
    try { cancel?.(); } catch { /* terminal */ }
    try { unsubscribeWeb(); } catch { /* terminal */ }
    try { unsubscribeChild(); } catch { /* terminal */ }
    resolveClosed();
  };
  const control = createPortableSupervisorWebControlV1({
    now: sources.now,
    nextChallenge: sources.nextChallenge,
    activate: async (capture: unknown) => {
      if (terminal || authorityRevoked || mirror.activate(capture) !== true) {
        throw new Error('activation_failed');
      }
      let launched: AuthenticatedSession;
      try { launched = await sources.launchMcp(); }
      catch (error) { try { revokeAuthority(); } catch { /* original failure */ } throw error; }
      if (terminal || authorityRevoked || launched.status !== 'authenticated'
        || launched.schemaVersion !== 'mediflow.headless.authenticated-launch.v1') {
        try { launched.close(); } catch { /* denied activation */ }
        throw new Error('activation_failed');
      }
      session = launched;
      const context = mirror.readHostContext();
      if (!Number.isSafeInteger(context.expiresAt) || (context.expiresAt as number) <= sources.now()) {
        throw new Error('activation_failed');
      }
      return Object.freeze({ expiresAt: context.expiresAt as number });
    },
    revoke: () => { revokeAuthority(); },
  });
  const terminate = (reason: TerminalReason = 'explicit'): boolean => {
    if (terminal) return false;
    terminal = true; ackPending = true;
    void control.terminate(reason).catch(() => undefined);
    try { children.terminateMcp(); } catch { /* terminal */ }
    try { children.terminateWeb(); } catch { /* terminal */ }
    cleanup();
    return true;
  };

  const finishAfterAckDrain = (): void => {
    if (terminal) return;
    terminal = true;
    try { children.terminateWeb(); } catch { /* terminal */ }
    cleanup();
  };
  const beginAckDrain = (): void => {
    if (terminal) return;
    try {
      cancelAckDrain = sources.schedule(PORTABLE_SUPERVISOR_WEB_ACK_DRAIN_MS_V1, finishAfterAckDrain);
      if (typeof cancelAckDrain !== 'function') throw new Error('drain_unavailable');
    } catch { terminate('explicit'); }
  };
  const beginAckQueueTimeout = (): void => {
    if (terminal) return;
    try {
      cancelAckQueue = sources.schedule(PORTABLE_SUPERVISOR_WEB_ACK_QUEUE_TIMEOUT_MS_V1,
        finishAfterAckDrain);
      if (typeof cancelAckQueue !== 'function') throw new Error('queue_timeout_unavailable');
    } catch { terminate('explicit'); }
  };
  const completeAckQueue = (): void => {
    if (terminal || !cancelAckQueue) return;
    const cancel = cancelAckQueue; cancelAckQueue = null;
    try { cancel(); } catch { terminate('explicit'); return; }
    beginAckDrain();
  };
  const handleWeb = async (frame: unknown): Promise<void> => {
    if (terminal || ackPending) return;
    if (sources.checkup.acceptWebFrame(frame)) return;
    let revoke = false;
    try { revoke = decodePortableSupervisorWebIpcFrameV1(frame).method === 'revoke_all'; }
    catch { terminate('explicit'); return; }
    if (revoke) ackPending = true;
    let response: string;
    try { response = await control.handle(frame); }
    catch { terminate('explicit'); return; }
    if (terminal) return;
    const terminalAck = revoke || authorityRevoked;
    if (terminalAck) beginAckQueueTimeout();
    if (terminal) return;
    try {
      children.sendWeb(response, (error) => {
        if (error) terminate('web_disconnect');
        else if (terminalAck) completeAckQueue();
      });
    } catch { terminate('web_disconnect'); }
  };
  unsubscribeWeb = children.subscribeWeb((frame) => { void handleWeb(frame); });
  unsubscribeChild = children.onTerminal((reason) => { terminate(reason); });
  return Object.freeze({ closed, terminate });
}

/** Starts the production mirror, audit ports, launcher and exact child-process topology. */
export function createPortableSupervisorProductionV1(): PortableSupervisorProductionRuntimeV1 {
  const now = () => Date.now();
  const dataDir = getDataDir();
  if (!path.isAbsolute(dataDir)) throw new Error('data_directory_path_invalid');
  let runtime: PortableSupervisorProductionRuntimeV1 | null = null;
  let expectedMirrorTermination = false;
  const mirror = createPortableSupervisorContextMirrorV1({
    now,
    hashRef: (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`,
    readPatientVersion: createPortableSupervisorPatientVersionProductionV1(),
    schedule: (delayMs: number, callback: () => void) => {
      const timer = setTimeout(callback, delayMs); timer.unref(); return () => { clearTimeout(timer); };
    },
    onTerminal: (reason: string) => {
      if (!expectedMirrorTermination) runtime?.terminate(terminalFromMirror(reason));
    },
  });
  const context: MirrorPort = Object.freeze({
    activate: mirror.activate,
    readHostContext: mirror.readHostContext,
    revoke: () => {
      expectedMirrorTermination = true;
      try { return mirror.revoke(); } finally { expectedMirrorTermination = false; }
    },
  });
  const writeAudit = createPortableSupervisorAipAuditPortV1({ now, readHostContext: context.readHostContext });
  const commitTerminalAudit = createPortableSupervisorSemanticAuditPortV1({
    now, readHostContext: context.readHostContext,
  });
  const children = createPortableSupervisorProductionChildProcessesV1({ dataDir });
  const checkup = createCheckupStatusTransitionSupervisorPortV1({
    randomBytes,
    sendWeb: children.sendWeb,
    schedule: (delayMs: number, callback: () => void) => {
      const timer = setTimeout(callback, delayMs); timer.unref(); return () => { clearTimeout(timer); };
    },
    onTerminal: (reason) => runtime?.terminate(reason === 'web_disconnect' ? 'web_disconnect' : 'explicit'),
  });
  try {
    runtime = createPortableSupervisorProductionRuntimeV1({
      now,
      nextChallenge: () => `pswc_${randomBytes(32).toString('hex')}`,
      schedule: (delayMs: number, callback: () => void) => {
        const timer = setTimeout(callback, delayMs); return () => { clearTimeout(timer); };
      },
      mirror: context,
      checkup,
      children,
      launchMcp: () => createProductionMcpAgentLauncherWithPreSpawnedChildV1({
        readHostContext: context.readHostContext, writeAudit, commitTerminalAudit,
        previewCheckupStatus: checkup.preview,
      }, children.mcpPort).launch(),
    });
    return runtime;
  } catch (error) { children.terminateAll(); throw error; }
}
