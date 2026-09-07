/* @Codex */
import { argv, exit, stdin, stdout } from 'node:process';
import { runMiniSession } from './session.ts';
import { MINI_MAX_INPUT_BYTES, parseMiniRequest, executeMiniRequest, serializeMiniResponse,
  type MiniRequest } from './protocol.ts';
import { OperationClientError, createOperationClient } from '../../mcp/src/operation-client.ts';

const SCHEMA_VERSION = 'mediflow.mini.transport.v1';
type ErrorCode = 'INVALID_REQUEST' | 'TRANSPORT_UNBOUND' | 'OPERATION_DENIED';

function writeAndExit(code: number, value: unknown): void {
  stdout.write(serializeMiniResponse(value), () => exit(code));
}

function fail(code: ErrorCode, exitCode: number): void {
  writeAndExit(exitCode, { schemaVersion: SCHEMA_VERSION, ok: false, error: { code } });
}

function succeed(result: unknown): void {
  writeAndExit(0, { schemaVersion: SCHEMA_VERSION, ok: true, result });
}

if (argv.length === 3 && argv[2] === '--session') {
  await runMiniSession();
} else if (argv.length === 3 && argv[2] === '--help') {
  stdout.write('Usage: mediflow-mini [--format json|ndjson] < request.json\n', () => exit(0));
} else {
  const validArguments = argv.length === 2 || (argv.length === 4 && argv[2] === '--format'
    && (argv[3] === 'json' || argv[3] === 'ndjson'));
  if (!validArguments) fail('INVALID_REQUEST', 2);
  else {
    const bytes = Buffer.alloc(MINI_MAX_INPUT_BYTES);
    let byteLength = 0;
    let settled = false;
    stdin.on('data', (chunk: Buffer) => {
      if (settled) return;
      if (!Buffer.isBuffer(chunk) || byteLength + chunk.length > MINI_MAX_INPUT_BYTES) {
        settled = true; stdin.removeAllListeners('data'); stdin.removeAllListeners('end'); stdin.destroy();
        fail('INVALID_REQUEST', 2); return;
      }
      chunk.copy(bytes, byteLength); byteLength += chunk.length;
    });
    stdin.on('end', async () => {
      if (settled) return;
      settled = true;
      let request: MiniRequest;
      try {
        request = parseMiniRequest(bytes.subarray(0, byteLength));
      } catch { fail('INVALID_REQUEST', 2); return; }
      let client: ReturnType<typeof createOperationClient> | null = null;
      try {
        client = createOperationClient();
        const result = await executeMiniRequest(client, request);
        client.close(); succeed(result);
      } catch (error) {
        client?.close();
        if (error instanceof OperationClientError && error.code === 'host_unbound') {
          fail('TRANSPORT_UNBOUND', 69);
        } else fail('OPERATION_DENIED', 70);
      }
    });
  }
}
