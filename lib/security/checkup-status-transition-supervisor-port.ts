/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, decodeCheckupStatusTransitionIpcFrameV1,
  encodeCheckupStatusTransitionIpcFrameV1, type CheckupStatusTransitionIpcFrameV1 } from
  '../../packages/aip/src/checkup-status-transition-ipc.ts';

const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
const PREFIX = `{"schemaVersion":"${CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1}"`;
const TIMEOUT_MS = 5_000;
type TerminalReason = 'protocol_invalid' | 'timeout' | 'web_disconnect';
type Pending = { requestRef: string; resolve(value: CheckupStatusTransitionIpcFrameV1): void;
  reject(error: Error): void; cancel: () => void };
type Sources = Readonly<{
  randomBytes(size: number): unknown;
  sendWeb(frame: string, complete: (error: Error | null) => void): unknown;
  schedule(delayMs: number, callback: () => void): unknown;
  onTerminal(reason: TerminalReason): unknown;
}>;

function unavailable(): Error { return new Error('checkup_preview_unavailable'); }
function discard(value: unknown): boolean {
  if (!types.isPromise(value)) return false;
  try { void Promise.prototype.then.call(value, undefined, () => undefined); } catch { /* terminal */ }
  return true;
}

/** Supervisor-owned request/result correlation for the private proposal-only Web channel. */
export function createCheckupStatusTransitionSupervisorPortV1(sources: Sources) {
  let terminal = false, pending: Pending | null = null;
  const finish = (reason?: TerminalReason): boolean => {
    if (terminal) return false;
    terminal = true;
    const current = pending; pending = null;
    try { current?.cancel(); } catch { /* terminal */ }
    current?.reject(unavailable());
    if (reason) { try { discard(sources.onTerminal(reason)); } catch { /* terminal */ } }
    return true;
  };
  const nextRequestRef = (): string => {
    let bytes: unknown;
    try { bytes = sources.randomBytes(16); } catch { throw unavailable(); }
    if (discard(bytes) || !(bytes instanceof Uint8Array) || types.isProxy(bytes) || bytes.byteLength !== 16) {
      throw unavailable();
    }
    return `hcqr_${Buffer.from(bytes).toString('hex')}`;
  };
  const preview = (input: unknown, signal?: AbortSignal): Promise<CheckupStatusTransitionIpcFrameV1> => {
    if (terminal || pending) return Promise.reject(unavailable());
    if (signal?.aborted) { finish('timeout'); return Promise.reject(unavailable()); }
    let requestRef: string, frame: string;
    try {
      requestRef = nextRequestRef();
      frame = encodeCheckupStatusTransitionIpcFrameV1({ schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1,
        type: 'preview', requestRef, operationId: OPERATION, input });
    } catch { return Promise.reject(unavailable()); }
    return new Promise((resolve, reject) => {
      let cancel: unknown, scheduling = true, fired = false;
      try { cancel = sources.schedule(TIMEOUT_MS, () => {
        if (scheduling) { fired = true; return; } finish('timeout');
      }); }
      catch { finish('web_disconnect'); reject(unavailable()); return; }
      scheduling = false;
      if (typeof cancel !== 'function' || types.isProxy(cancel) || types.isAsyncFunction(cancel)) {
        finish('web_disconnect'); reject(unavailable()); return;
      }
      if (fired) { try { (cancel as () => void)(); } catch { /* terminal */ }
        finish('timeout'); reject(unavailable()); return; }
      const onAbort = () => { finish('timeout'); };
      signal?.addEventListener('abort', onAbort, { once: true });
      const cancelAll = () => { signal?.removeEventListener('abort', onAbort); (cancel as () => void)(); };
      pending = { requestRef, resolve, reject, cancel: cancelAll };
      try {
        const sent = sources.sendWeb(frame, (error) => { if (error) finish('web_disconnect'); });
        if (discard(sent)) finish('web_disconnect');
      } catch { finish('web_disconnect'); }
    });
  };
  const acceptWebFrame = (frame: unknown): boolean => {
    if (typeof frame !== 'string' || !frame.startsWith(PREFIX)) return false;
    if (terminal) return true;
    let response: CheckupStatusTransitionIpcFrameV1;
    try { response = decodeCheckupStatusTransitionIpcFrameV1(frame); }
    catch { finish('protocol_invalid'); return true; }
    const current = pending;
    if (!current || response.type !== 'preview_result' || response.requestRef !== current.requestRef) {
      finish('protocol_invalid'); return true;
    }
    pending = null;
    try { current.cancel(); } catch { finish('protocol_invalid'); return true; }
    current.resolve(response); return true;
  };
  return Object.freeze({ preview, acceptWebFrame, close: finish });
}
