/* @Codex */
import { argv, exit, stdin, stdout } from 'node:process';
import { z } from 'zod';
import {
  followUpProposalArgumentsSchema, openLoopsArgumentsSchema, terminologyArgumentsSchema,
} from '../../mcp/src/contracts.ts';
import { OperationClientError, createOperationClient } from '../../mcp/src/operation-client.ts';

const SCHEMA_VERSION = 'mediflow.mini.transport.v1';
const MAX_INPUT_BYTES = 16 * 1024;
const PARSE = JSON.parse;
const STRINGIFY = JSON.stringify;
const CREATE = Object.create;
const DEFINE = Object.defineProperty;
const KEYS = Object.keys;
type ErrorCode = 'INVALID_REQUEST' | 'TRANSPORT_UNBOUND' | 'OPERATION_DENIED';
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const requestSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('status'), args: z.object({}).strict() }).strict(),
  z.object({ command: z.literal('capabilities'), args: z.object({}).strict() }).strict(),
  z.object({ command: z.literal('terminology search'), args: terminologyArgumentsSchema }).strict(),
  z.object({ command: z.literal('open-loops'), args: openLoopsArgumentsSchema }).strict(),
  z.object({ command: z.literal('follow-up-proposal'), args: followUpProposalArgumentsSchema }).strict(),
]);

function hasDuplicateKeys(source: string): boolean {
  const stack: Array<Set<string> | null> = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '{') { stack.push(new Set()); continue; }
    if (character === '[') { stack.push(null); continue; }
    if (character === '}' || character === ']') { stack.pop(); continue; }
    if (character !== '"') continue;
    const start = index;
    for (index += 1; index < source.length; index += 1) {
      if (source[index] === '\\') { index += 1; continue; }
      if (source[index] === '"') break;
    }
    let next = index + 1;
    while (/\s/u.test(source[next] ?? '')) next += 1;
    if (source[next] !== ':') continue;
    const objectKeys = stack[stack.length - 1];
    if (!objectKeys) return true;
    const key = PARSE(source.slice(start, index + 1)) as string;
    if (objectKeys.has(key)) return true;
    objectKeys.add(key);
  }
  return false;
}

function isolated(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const output: JsonValue[] = [];
    DEFINE(output, 'toJSON', { value: undefined, enumerable: false });
    for (let index = 0; index < value.length; index += 1) output[index] = isolated(value[index]);
    return output;
  }
  const output = CREATE(null) as { [key: string]: JsonValue };
  const keys = KEYS(value as object);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    DEFINE(output, key, { value: isolated((value as Record<string, unknown>)[key]), enumerable: true });
  }
  return output;
}

function writeAndExit(code: number, value: unknown): void {
  stdout.write(`${STRINGIFY(isolated(value))}\n`, () => exit(code));
}

function fail(code: ErrorCode, exitCode: number): void {
  writeAndExit(exitCode, { schemaVersion: SCHEMA_VERSION, ok: false, error: { code } });
}

function succeed(result: unknown): void {
  writeAndExit(0, { schemaVersion: SCHEMA_VERSION, ok: true, result });
}

if (argv.length === 3 && argv[2] === '--help') {
  stdout.write('Usage: mediflow-mini [--format json|ndjson] < request.json\n', () => exit(0));
} else {
  const validArguments = argv.length === 2 || (argv.length === 4 && argv[2] === '--format'
    && (argv[3] === 'json' || argv[3] === 'ndjson'));
  if (!validArguments) fail('INVALID_REQUEST', 2);
  else {
    const bytes = Buffer.alloc(MAX_INPUT_BYTES);
    let byteLength = 0;
    let settled = false;
    stdin.on('data', (chunk: Buffer) => {
      if (settled) return;
      if (!Buffer.isBuffer(chunk) || byteLength + chunk.length > MAX_INPUT_BYTES) {
        settled = true; stdin.removeAllListeners('data'); stdin.removeAllListeners('end'); stdin.destroy();
        fail('INVALID_REQUEST', 2); return;
      }
      chunk.copy(bytes, byteLength); byteLength += chunk.length;
    });
    stdin.on('end', async () => {
      if (settled) return;
      settled = true;
      let source: string; let request: z.infer<typeof requestSchema>;
      try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, byteLength));
        const decoded = PARSE(source) as unknown;
        if (hasDuplicateKeys(source)) throw new Error('duplicate');
        request = requestSchema.parse(decoded);
      } catch { fail('INVALID_REQUEST', 2); return; }
      let client: ReturnType<typeof createOperationClient> | null = null;
      try {
        client = createOperationClient();
        const result = request.command === 'status'
          ? await client.status()
          : request.command === 'capabilities'
          ? await client.publicCatalog()
          : request.command === 'terminology search'
            ? await client.searchTerminology(request.args)
            : request.command === 'open-loops'
              ? await client.readOpenLoops()
              : await client.proposeOpenLoopsFollowUp(request.args);
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
