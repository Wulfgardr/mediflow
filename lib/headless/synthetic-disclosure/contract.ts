/* PROPOSED application-payload contract; no SDK framing or clinical admission. */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { PROFILE, projectionFor, type FixtureId, type Projection } from './fixture';

export type Channel = 'mcp_tool_result' | 'model_context';
export type Payload = Readonly<{
    content: readonly Readonly<{ type: 'text'; text: string }>[];
    structuredContent: Projection;
}>;
export const DESTINATION = 'in_process_synthetic_sink' as const;
export const TTL_MS = 60_000;
export const MAX_PAYLOAD_BYTES = 32_768;
const invalid = (): never => { throw new Error('synthetic_payload_invalid'); };

export function channelFor(value: unknown): Channel {
    if (value !== 'mcp_tool_result' && value !== 'model_context') return invalid();
    return value;
}
export function fixtureFor(value: unknown): FixtureId {
    if (value !== 'demo-a' && value !== 'demo-b') return invalid();
    return value;
}
/** Descriptor-only inspection: unknown properties/accessors/proxies never run. */
function fields(value: unknown, keys: readonly string[], array = false): Record<string, unknown> {
    if (!value || typeof value !== 'object' || types.isProxy(value)
        || Array.isArray(value) !== array
        || Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) return invalid();
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return invalid();
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) return invalid();
        result[key] = descriptor.value;
    }
    return result;
}
function textFor(projection: Projection): string {
    return 'INVENTED SYNTHETIC OPEN LOOPS; no clinical access.\n' + JSON.stringify(projection);
}
export function payloadFor(channel: Channel, fixtureId: FixtureId): Payload {
    channelFor(channel);
    const projection = projectionFor(fixtureFor(fixtureId));
    return Object.freeze({
        content: Object.freeze([Object.freeze({ type: 'text' as const, text: textFor(projection) })]),
        structuredContent: projection,
    });
}
/** Rebuild canonical bytes from the closed fixture contract. No arbitrary data,
 * metadata, error/progress payload, attachments, resources or hidden properties. */
export function encodePayload(channel: Channel, value: unknown): string {
    channelFor(channel);
    const outer = fields(value, ['content', 'structuredContent']);
    const projection = fields(outer.structuredContent,
        ['schemaVersion', 'synthetic', 'caseRef', 'snapshotRevision', 'truncated', 'items']);
    const id = fixtureFor(projection.caseRef), expected = projectionFor(id);
    if (projection.schemaVersion !== PROFILE || projection.synthetic !== true
        || projection.snapshotRevision !== expected.snapshotRevision || projection.truncated !== false) return invalid();
    const items = fields(projection.items, ['0', 'length'], true);
    if (items.length !== 1) return invalid();
    const item = fields(items['0'], ['loopRef', 'kind', 'temporalState', 'openedAt', 'dueAt', 'revision']);
    for (const key of Object.keys(item) as (keyof typeof expected.items[0])[]) {
        if (item[key] !== expected.items[0][key]) return invalid();
    }
    const content = fields(outer.content, ['0', 'length'], true);
    const text = fields(content['0'], ['type', 'text']);
    if (content.length !== 1 || text.type !== 'text' || text.text !== textFor(expected)) return invalid();
    const bytes = JSON.stringify(payloadFor(channel, id));
    if (Buffer.byteLength(bytes, 'utf8') > MAX_PAYLOAD_BYTES) return invalid();
    return bytes;
}
export const payloadHash = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');
