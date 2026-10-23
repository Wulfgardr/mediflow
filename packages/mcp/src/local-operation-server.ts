import { z } from 'zod';
import { LOCAL_OPERATION_TOOL, LOCAL_OPERATION_TOOL_DESCRIPTOR, LOCAL_OPERATION_ERROR, LOCAL_OPERATION_SCHEMA,
    localOperationInputSchema, localOperationResultSchema, type LocalOperationInput, type LocalOperationResult } from './local-operation-contract.ts';

const frameSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.number().int().min(0).max(1_000_000).optional(),
    method: z.string().max(64), params: z.unknown().optional() }).strict();
const callSchema = z.object({ name: z.literal(LOCAL_OPERATION_TOOL), arguments: localOperationInputSchema }).strict();
const initializeSchema = z.object({ protocolVersion: z.literal('2025-11-25'), capabilities: z.object({}).passthrough(),
    clientInfo: z.object({ name: z.string().max(128), version: z.string().max(64), title: z.string().max(128).optional() }).strict() }).strict();
const empty = z.object({}).strict();
const unavailable: LocalOperationResult = { schema: LOCAL_OPERATION_SCHEMA, status: 'unavailable' };

/** The entire wire is constructed here; no SDK diagnostics, peer strings or host objects are forwarded. */
export function createLocalOperationProtocol(port: { request(input: LocalOperationInput): Promise<LocalOperationResult>; close?(): void }) {
    let initialized = false, count = 0, closed = false, busy = false;
    const error = (id: number | null, code = -32602) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: LOCAL_OPERATION_ERROR } });
    return Object.freeze({
        close() { closed = true; port.close?.(); },
        async receive(line: string): Promise<string | null> {
            if (closed) return null;
            if (++count > 64 || Buffer.byteLength(line) > 4096) { closed = true; port.close?.(); return error(null); }
            let value: unknown;
            try { value = JSON.parse(line); } catch { return error(null, -32700); }
            const parsed = frameSchema.safeParse(value);
            if (!parsed.success) return error(null);
            const frame = parsed.data;
            if (frame.id === undefined) {
                return frame.method === 'notifications/initialized' && initialized && empty.safeParse(frame.params ?? {}).success ? null : error(null);
            }
            const id = frame.id;
            const reply = (result: unknown) => JSON.stringify({ jsonrpc: '2.0', id, result });
            if (frame.method === 'initialize') {
                if (initialized || !initializeSchema.safeParse(frame.params).success) return error(id);
                initialized = true;
                return reply({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'mediflow-local-operation', version: '0.1.0' } });
            }
            if (!initialized) return error(id);
            if (frame.method === 'ping' && empty.safeParse(frame.params ?? {}).success) return reply({});
            if (frame.method === 'tools/list' && empty.safeParse(frame.params ?? {}).success) return reply({ tools: [LOCAL_OPERATION_TOOL_DESCRIPTOR] });
            if (frame.method !== 'tools/call') return error(id, -32601);
            const input = callSchema.safeParse(frame.params);
            if (!input.success) return error(id);
            let result = unavailable;
            if (!busy) {
                busy = true;
                try {
                    const response = localOperationResultSchema.safeParse(await port.request(input.data.arguments));
                    if (!closed && response.success) result = response.data;
                } catch { /* Only the fixed result crosses this boundary. */ }
                finally { busy = false; }
            }
            return closed ? null : reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
        },
    });
}
