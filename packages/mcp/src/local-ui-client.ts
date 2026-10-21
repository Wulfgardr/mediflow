import { AIP_OPERATION_RPC_ENV_KEY_V1 } from '../../aip/src/child-ipc-contract.ts';
import { LOCAL_UI_OPERATION, LOCAL_UI_RESULT, LOCAL_UI_RPC_MODE, localUiArgumentsSchema } from './local-ui-contract.ts';

export function createLocalUiClient() {
  if (process.env[AIP_OPERATION_RPC_ENV_KEY_V1] !== LOCAL_UI_RPC_MODE
    || !process.connected || typeof process.send !== 'function') throw new Error('navigation_unavailable');
  let sequence = 0, closed = false;
  const pending = new Map<string, { finish(ok: boolean): void }>();
  const onMessage = (frame: unknown) => {
    if (typeof frame !== 'string' || Buffer.byteLength(frame) > 4_096) return close();
    let response;
    try { response = JSON.parse(frame); } catch { close(); return; }
    const entry = pending.get(response.requestId);
    if (!entry) return;
    const value = response.result;
    entry.finish(response.schemaVersion === 'mediflow.aip.operation.result.v1' && response.outcome === 'completed'
      && JSON.stringify(value?.operation) === JSON.stringify(LOCAL_UI_OPERATION)
      && JSON.stringify(value?.value) === JSON.stringify(LOCAL_UI_RESULT));
  };
  const close = () => {
    if (closed) return;
    closed = true;
    process.off('message', onMessage); process.off('disconnect', close);
    for (const entry of [...pending.values()]) entry.finish(false);
    if (process.connected) process.disconnect();
  };
  process.on('message', onMessage); process.once('disconnect', close);
  return Object.freeze({ close, navigate(input: unknown, signal?: AbortSignal) {
    const parsed = localUiArgumentsSchema.safeParse(input);
    if (closed || signal?.aborted || !parsed.success || sequence + pending.size + 2 > 256) return Promise.reject(new Error('navigation_unavailable'));
    const requestId = `rpc_ui_${++sequence}`;
    return new Promise<typeof LOCAL_UI_RESULT>((resolve, reject) => {
      const abort = () => {
        if (!pending.has(requestId)) return;
        try { process.send!(JSON.stringify({ schemaVersion: 'mediflow.aip.operation.request.v1',
          method: 'cancel', requestId: `rpc_ui_cancel_${++sequence}`, targetRequestId: requestId }),
        undefined, undefined, () => {}); } catch { /* channel may already be closed */ }
        finish(false);
      };
      const finish = (ok: boolean) => {
        if (!pending.delete(requestId)) return;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (ok) resolve(LOCAL_UI_RESULT); else reject(new Error('navigation_unavailable'));
      };
      const timer = setTimeout(abort, 10_000);
      pending.set(requestId, { finish });
      signal?.addEventListener('abort', abort, { once: true });
      try { process.send!(JSON.stringify({ schemaVersion: 'mediflow.aip.operation.request.v1',
        method: 'call', requestId, operationId: LOCAL_UI_OPERATION.operationId, input: parsed.data }),
      undefined, undefined, (error: Error | null) => { if (error) finish(false); }); } catch { finish(false); }
    });
  } });
}
