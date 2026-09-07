/* @Codex */
import { z } from 'zod';
import {
  followUpProposalArgumentsSchema, openLoopsArgumentsSchema, semanticQueryArgumentsSchema,
  terminologyArgumentsSchema,
} from '../../mcp/src/contracts.ts';
import type { createOperationClient } from '../../mcp/src/operation-client.ts';

export const MINI_MAX_INPUT_BYTES = 16 * 1024;
const PARSE = JSON.parse;
const STRINGIFY = JSON.stringify;
const CREATE = Object.create;
const DEFINE = Object.defineProperty;
const KEYS = Object.keys;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const miniRequestSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('status'), args: z.object({}).strict() }).strict(),
  z.object({ command: z.literal('capabilities'), args: z.object({}).strict() }).strict(),
  z.object({ command: z.literal('terminology search'), args: terminologyArgumentsSchema }).strict(),
  z.object({ command: z.literal('open-loops'), args: openLoopsArgumentsSchema }).strict(),
  z.object({ command: z.literal('follow-up-proposal'), args: followUpProposalArgumentsSchema }).strict(),
  z.object({ command: z.literal('semantic-query'), args: semanticQueryArgumentsSchema }).strict(),
]);

export type MiniRequest = z.infer<typeof miniRequestSchema>;

export function parseMiniRequest(bytes: Uint8Array): MiniRequest {
  if (bytes.byteLength > MINI_MAX_INPUT_BYTES) throw new Error('invalid_request');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const decoded = PARSE(source) as unknown;
  if (hasDuplicateKeys(source)) throw new Error('invalid_request');
  return miniRequestSchema.parse(decoded);
}

/** Both transports invoke precisely the existing OperationClient methods and DTOs. */
export function executeMiniRequest(client: ReturnType<typeof createOperationClient>, request: MiniRequest) {
  switch (request.command) {
    case 'status': return client.status();
    case 'capabilities': return client.publicCatalog();
    case 'terminology search': return client.searchTerminology(request.args);
    case 'open-loops': return client.readOpenLoops();
    case 'follow-up-proposal': return client.proposeOpenLoopsFollowUp(request.args);
    case 'semantic-query': return client.executeSemanticQuery(request.args);
  }
}

/** Strip inherited serialization hooks; stdout never invokes caller-provided toJSON. */
export function serializeMiniResponse(value: unknown): string {
  return `${STRINGIFY(isolated(value))}\n`;
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
