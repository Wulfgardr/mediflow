/* @Codex */
import { stdin, stdout } from 'node:process';
import { createOperationClient, OperationClientError } from '../../mcp/src/operation-client.ts';
import { MINI_MAX_INPUT_BYTES, parseMiniRequest, executeMiniRequest, serializeMiniResponse,
  type MiniRequest } from './protocol.ts';

const SCHEMA = 'mediflow.mini.session.v1';
const MAX_REQUESTS = 64;
const authorizationStep = Object.freeze({
  code: 'AUTHORIZE_IN_OWNED_WEB',
  message: 'Apri il Web avviato dal Supervisor, accedi, seleziona il contesto e attiva Intelligent Host.',
});

function write(value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    stdout.write(serializeMiniResponse(value), (error) => error ? reject(error) : resolve());
  });
}

/** A connected IPC channel is not an unlocked session or a capability grant. */
export async function runMiniSession(): Promise<void> {
  let client: ReturnType<typeof createOperationClient>;
  const unavailable = (code: string) => ({
    schemaVersion: SCHEMA, ok: false, error: { code },
    status: { transport: process.connected === true ? 'connected' : 'disconnected',
      session: 'unavailable', ready: false, capabilities: [] },
  });
  try { client = createOperationClient(); }
  catch {
    await write(unavailable('TRANSPORT_UNBOUND'));
    if (process.connected) process.disconnect();
    process.exitCode = 69; return;
  }
  let authorized = false;
  const execute = async (frame: Buffer): Promise<boolean> => {
    let request: MiniRequest;
    try {
      request = parseMiniRequest(frame);
    } catch {
      await write(unavailable('INVALID_REQUEST')); process.exitCode = 2; return false;
    }
    try {
      // Only readiness has a transport-specific shape; all operation DTOs use the shared dispatch.
      const result = request.command === 'status'
        ? await client.publicCatalog().then((catalog) => ({ transport: 'connected', session: 'authorized',
          ready: catalog.operations.length > 0, capabilities: catalog.operations, nextStep: null }))
        : await executeMiniRequest(client, request);
      if (process.connected !== true) throw new OperationClientError('host_unbound');
      authorized = true;
      await write({ schemaVersion: SCHEMA, ok: true, result });
      return true;
    } catch (error) {
      if (!authorized && process.connected === true
        && error instanceof OperationClientError && error.code === 'host_unbound') {
        const status = { transport: 'connected', session: 'not_unlocked', ready: false,
          capabilities: [], nextStep: authorizationStep };
        await write(request.command === 'status'
          ? { schemaVersion: SCHEMA, ok: true, result: status }
          : { schemaVersion: SCHEMA, ok: false, error: { code: 'SESSION_NOT_UNLOCKED' }, status });
        return true;
      }
      await write(unavailable('OPERATION_DENIED')); process.exitCode = 70; return false;
    }
  };
  const onDisconnect = () => { process.exitCode = 69; stdin.destroy(); };
  process.once('disconnect', onDisconnect);
  let pending = Buffer.alloc(0), requests = 0;
  try {
    for await (const chunk of stdin) {
      const bytes = chunk as Buffer;
      let offset = 0;
      while (offset < bytes.length) {
        const newline = bytes.indexOf(10, offset);
        const end = newline < 0 ? bytes.length : newline;
        if (pending.length + end - offset > MINI_MAX_INPUT_BYTES) {
          await write(unavailable('INVALID_REQUEST')); process.exitCode = 2; return;
        }
        pending = Buffer.concat([pending, bytes.subarray(offset, end)]);
        offset = end + 1;
        if (newline < 0) break;
        requests += 1;
        if (requests > MAX_REQUESTS) {
          await write(unavailable('REQUEST_LIMIT')); process.exitCode = 2; return;
        }
        if (!await execute(pending)) return;
        pending = Buffer.alloc(0);
      }
    }
    if (pending.length) {
      await write(unavailable('INVALID_REQUEST')); process.exitCode = 2;
    }
  } catch {
    // Closed stdin/stdout or IPC is terminal; do not print raw stream errors.
    process.exitCode = 69;
  } finally {
    process.off('disconnect', onDisconnect);
    client.close();
    stdin.destroy();
  }
}
