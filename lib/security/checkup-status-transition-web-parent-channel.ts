/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, decodeCheckupStatusTransitionIpcFrameV1 } from
  '../../packages/aip/src/checkup-status-transition-ipc.ts';

const PREFIX = `{"schemaVersion":"${CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1}"`;
type TerminalReason = 'parent_disconnect' | 'protocol_invalid';
type MessageListener = (message: unknown) => void;
type DisconnectListener = () => void;
type Sources = Readonly<{
  connected(): unknown;
  send(frame: string, done: (error: Error | null) => void): unknown;
  onMessage(listener: MessageListener): unknown;
  offMessage(listener: MessageListener): unknown;
  onDisconnect(listener: DisconnectListener): unknown;
  offDisconnect(listener: DisconnectListener): unknown;
  handlePreview(frame: string): Promise<string>;
  onTerminal(reason: TerminalReason): unknown;
}>;

function discard(value: unknown): boolean {
  if (!types.isPromise(value)) return false;
  try { void Promise.prototype.then.call(value, undefined, () => undefined); } catch { /* terminal */ }
  return true;
}

/** One exact-parent listener for the operation-specific preview protocol; H1a frames remain separate. */
export function createCheckupStatusTransitionWebParentChannelV1(sources: Sources): Readonly<{
  dispose(): boolean;
}> {
  let terminal = false, inFlight = false;
  const connected = (): boolean => {
    try { const value = sources.connected(); return !discard(value) && value === true; }
    catch { return false; }
  };
  const finish = (reason?: TerminalReason): boolean => {
    if (terminal) return false;
    terminal = true; inFlight = false;
    try { discard(sources.offMessage(onMessage)); } catch { /* terminal */ }
    try { discard(sources.offDisconnect(onDisconnect)); } catch { /* terminal */ }
    if (reason) {
      try { discard(sources.onTerminal(reason)); } catch { /* terminal */ }
    }
    return true;
  };
  const protocolFailure = (): void => { finish('protocol_invalid'); };
  const onMessage: MessageListener = (message) => {
    if (terminal || typeof message !== 'string' || !message.startsWith(PREFIX)) return;
    if (!connected() || inFlight) { protocolFailure(); return; }
    try {
      if (decodeCheckupStatusTransitionIpcFrameV1(message).type !== 'preview') {
        protocolFailure(); return;
      }
    } catch { protocolFailure(); return; }
    inFlight = true;
    void Promise.resolve().then(() => sources.handlePreview(message)).then((response) => {
      if (terminal) return;
      try {
        if (!connected() || decodeCheckupStatusTransitionIpcFrameV1(response).type !== 'preview_result') {
          protocolFailure(); return;
        }
        const sent = sources.send(response, (error) => {
          if (terminal) return;
          if (error) { protocolFailure(); return; }
          inFlight = false;
        });
        if (discard(sent)) protocolFailure();
      } catch { protocolFailure(); }
    }, protocolFailure);
  };
  const onDisconnect: DisconnectListener = () => { finish('parent_disconnect'); };
  try {
    if (!connected() || discard(sources.onMessage(onMessage)) || discard(sources.onDisconnect(onDisconnect))) {
      protocolFailure();
    }
  } catch { protocolFailure(); }
  return Object.freeze({ dispose: () => finish() });
}
