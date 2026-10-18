import 'server-only';

import { types } from 'node:util';
import { ProfileQueryError, type ProfileQuery, type ProfileResult } from '../patient-profile-scoped-contract.ts';

import { PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1, decodePatientProfileQueryIpcFrameV1,
  encodePatientProfileQueryIpcFrameV1, type PatientProfileQueryIpcFrameV1 } from
  '../../packages/aip/src/patient-profile-query-ipc.ts';

const OPERATION = 'patient-profile.read.v1';
const PREFIX = `{"schemaVersion":"${PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1}"`;
const TIMEOUT_MS = 5_000;
type TerminalReason = 'protocol_invalid' | 'timeout' | 'web_disconnect';
type Pending = { requestRef: string; resolve(value: PatientProfileQueryIpcFrameV1): void;
  reject(error: Error): void; cancel: () => void };
type Sources = Readonly<{
  randomBytes(size: number): unknown;
  sendWeb(frame: string, complete: (error: Error | null) => void): unknown;
  schedule(delayMs: number, callback: () => void): unknown;
  onTerminal(reason: TerminalReason): unknown;
}>;

function unavailable(): Error { return new ProfileQueryError('query_unavailable'); }
function discard(value: unknown): boolean {
  if (!types.isPromise(value)) return false;
  try { void Promise.prototype.then.call(value, undefined, () => undefined); } catch { /* terminal */ }
  return true;
}

/** Supervisor-owned request/result correlation for the private read-only Web channel. */
export function createPatientProfileQuerySupervisorPortV1(sources: Sources) {
  let terminal = false, pending: Pending | null = null;
  const issued = new Set<string>();
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
    const ref = `ppqr_${Buffer.from(bytes).toString('hex')}`;
    if (issued.has(ref) || issued.size >= 256) throw unavailable();
    issued.add(ref); return ref;
  };
  const executeProfileQuery = (input: ProfileQuery, signal?: AbortSignal): Promise<ProfileResult> => {
    if (terminal || pending) return Promise.reject(unavailable());
    if (signal?.aborted) { finish('timeout'); return Promise.reject(unavailable()); }
    let requestRef: string, frame: string;
    try {
      requestRef = nextRequestRef();
      frame = encodePatientProfileQueryIpcFrameV1({ schemaVersion: PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1,
        type: 'query', requestRef, operationId: OPERATION, input });
    } catch { return Promise.reject(unavailable()); }
    return new Promise<PatientProfileQueryIpcFrameV1>((resolve, reject) => {
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
    }).then(frame => {
      if (frame.type !== 'query_result') throw unavailable();
      if (frame.outcome === 'denied') throw new ProfileQueryError(frame.denialCode);
      return frame.result;
    });
  };
  const acceptWebFrame = (frame: unknown): boolean => {
    if (typeof frame !== 'string' || !frame.startsWith(PREFIX)) return false;
    if (terminal) return true;
    let response: PatientProfileQueryIpcFrameV1;
    try { response = decodePatientProfileQueryIpcFrameV1(frame); }
    catch { finish('protocol_invalid'); return true; }
    const current = pending;
    if (!current || response.type !== 'query_result' || response.requestRef !== current.requestRef) {
      finish('protocol_invalid'); return true;
    }
    pending = null;
    try { current.cancel(); } catch { finish('protocol_invalid'); return true; }
    current.resolve(response); return true;
  };
  return Object.freeze({ executeProfileQuery, acceptWebFrame, close: finish });
}
