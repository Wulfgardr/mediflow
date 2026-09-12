/* @Codex — local content preparation, NEVER egress or patient-context authority. */
import 'server-only';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { createGlinerRedactionRunner } from '../gliner-redaction-runner';
import { createRedactionSession, type PreparedRedaction, type RedactionSessionInput } from '../ai-redaction-session';
import { scanJsonObject } from '../ai-json-lexical';
import { renderEmissionPlan, type EmissionUnit } from './ordinary-emission-plan';
import { readOrdinaryTaskProfile, ordinaryTextPath, ordinaryCanonicalTextBounds, type OrdinaryTaskProfile, type OrdinaryTaskOutput } from './ordinary-task-profile';

export type OrdinaryRunnerConfiguration = Parameters<typeof createGlinerRedactionRunner>[0];
export type PreparedOrdinaryProfile = object;
export type PreparedOrdinaryRead = Readonly<{
    functionId: ReturnType<typeof readOrdinaryTaskProfile>['functionId'];
    profileVersion: ReturnType<typeof readOrdinaryTaskProfile>['profileVersion'];
    sourceSha256: string; payloadSha256: string; payloadBytes: number;
    payload: string;
    content: Readonly<{ input: readonly Readonly<{ type: 'text'; text: string; text_elements: readonly [] }>[]; outputSchema: Readonly<Record<string, unknown>> }>;
    entityCounts: Readonly<Record<string, number>>;
    parseOutput(text: string): OrdinaryTaskOutput;
}>;
type Slot = { unit: EmissionUnit; start: number; end: number };
type Batch = { text: string; slots: Slot[] };
const records = new WeakMap<object, { read: PreparedOrdinaryRead; close(): Promise<void> }>();
const RESERVED = /MF_PII/iu;
const TOKEN = /\{\{MF_PII_[a-f0-9]{32}_[1-9][0-9]{0,3}\}\}/gu;
const SEPARATOR = '\n\u241e\n';
const fail = (): never => { throw new Error('ordinary_preparation_invalid'); };
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function snapshotKnown(input: RedactionSessionInput['knownIdentifiers']): RedactionSessionInput['knownIdentifiers'] {
    if (input === undefined) return undefined;
    if (!input || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) return fail();
    const output: { names?: readonly string[]; birthDates?: readonly string[] } = {};
    for (const key of Reflect.ownKeys(input)) {
        if (key !== 'names' && key !== 'birthDates') return fail();
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !('value' in descriptor)) return fail();
        const list: unknown = descriptor.value;
        if (list === undefined) continue;
        if (!Array.isArray(list) || types.isProxy(list) || Object.getPrototypeOf(list) !== Array.prototype || list.length > 64 || Reflect.ownKeys(list).length !== list.length + 1) return fail();
        const values: string[] = [];
        for (let index = 0; index < list.length; index++) {
            const item = Object.getOwnPropertyDescriptor(list, String(index));
            if (!item || !('value' in item) || typeof item.value !== 'string' || item.value.length > 256 || !item.value.isWellFormed() || item.value.match(RESERVED)) return fail();
            values.push(item.value);
        }
        output[key] = Object.freeze(values);
    }
    return Object.freeze(output);
}
function batches(units: readonly EmissionUnit[]): Batch[] {
    const output: Batch[] = [];
    for (const unit of units) {
        if (typeof unit.value !== 'string' || unit.value.length > 12_000 || !unit.value.isWellFormed() || unit.value.match(RESERVED)) return fail();
        if (!unit.value.length) continue;
        let batch = output[output.length - 1];
        if (!batch || batch.text.length + SEPARATOR.length + unit.value.length > 12_000) {
            if (output.length >= 64) return fail();
            batch = { text: '', slots: [] }; output.push(batch);
        }
        if (batch.slots.length) batch.text += SEPARATOR;
        const start = batch.text.length;
        batch.text += unit.value;
        batch.slots.push({ unit, start, end: batch.text.length });
    }
    return output;
}
function slotForSpan(batch: Batch, span: { start: number; end: number }): Slot {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start >= span.end) return fail();
    const slot = batch.slots.find(value => span.start >= value.start && span.end <= value.end);
    if (!slot || !batch.text.slice(0, span.start).isWellFormed() || !batch.text.slice(span.start, span.end).isWellFormed() || !batch.text.slice(span.end).isWellFormed()) return fail();
    return slot;
}
function expandSchema(profile: OrdinaryTaskProfile, schema: Readonly<Record<string, unknown>>, expansion: number, path: readonly (string | number)[] = []): Readonly<Record<string, unknown>> {
    const result = { ...schema };
    if (schema.type === 'object') result.properties = Object.freeze(Object.fromEntries(Object.entries(schema.properties as Record<string, Readonly<Record<string, unknown>>>).map(([key, child]) => [key, expandSchema(profile, child, expansion, [...path, key])])));
    if (schema.type === 'array') result.items = expandSchema(profile, schema.items as Readonly<Record<string, unknown>>, expansion, [...path, 0]);
    if (Array.isArray(schema.anyOf)) result.anyOf = Object.freeze(schema.anyOf.map(child => expandSchema(profile, child, expansion, path)));
    if (schema.type === 'string' && typeof schema.maxLength === 'number' && ordinaryTextPath(profile, path)) result.maxLength = Math.min(262_144, Math.ceil(schema.maxLength * expansion));
    return Object.freeze(result);
}

/** Synchronous ownership: close is available BEFORE the first neural await.
 * Configuration locates the already installed local worker, not a provider.
 * The signal only removes authority; this handle itself grants none. */
export function createOrdinaryPreparation(profile: OrdinaryTaskProfile, configuration: OrdinaryRunnerConfiguration,
    signal?: AbortSignal, knownIdentifiers?: RedactionSessionInput['knownIdentifiers']): Readonly<{ ready: Promise<PreparedOrdinaryProfile>; close(): Promise<void> }> {
    const read = readOrdinaryTaskProfile(profile);
    const known = snapshotKnown(knownIdentifiers);
    const units = [...new Set(read.emissionPlan.flatMap(part => typeof part === 'string' ? [] : [part.kind === 'data' ? part : part.unit]))];
    // This assertion also covers the static/structural portions of the plan.
    const original = renderEmissionPlan(read.emissionPlan);
    if (original !== read.prompt || original.match(RESERVED) || !original.isWellFormed()) return fail();
    const work = batches(units);
    const runner = createGlinerRedactionRunner(configuration);
    const session = createRedactionSession();
    const token = Object.freeze(Object.create(null));
    const tokenValues = new Map<string, { batch: PreparedRedaction; rawLength: number }>();
    const replacements = new Map<EmissionUnit, string>();
    let closed = false;
    let closing: Promise<void> | undefined;
    function close(): Promise<void> {
        if (closing) return closing;
        closed = true; records.delete(token); tokenValues.clear(); replacements.clear(); session.close();
        signal?.removeEventListener('abort', abort);
        // Reject cleanup failures, never claim success merely from a timer.
        closing = Promise.resolve().then(() => runner.close()).catch(() => { throw new Error('ordinary_cleanup_unconfirmed'); });
        void closing.catch(() => {});
        return closing;
    }
    const abort = () => { void close(); };
    const guard = () => { if (closed || signal?.aborted) return fail(); };
    signal?.addEventListener('abort', abort, { once: true });
    function rehydrateJson(text: string): OrdinaryTaskOutput {
        guard();
        const literals = scanJsonObject(text);
        if (!literals) return fail();
        let cursor = 0, restored = '';
        for (const literal of literals) {
            if (!literal.value.isWellFormed()) return fail();
            if (!literal.value.match(RESERVED)) continue;
            if (literal.key || !ordinaryTextPath(profile, literal.path)) return fail();
            // A single lexical pass: inserted plaintext is never rescanned.
            const used: string[] = [];
            const without = literal.value.replace(TOKEN, value => { if (!tokenValues.has(value)) return fail(); used.push(value); return ''; });
            if (without.match(RESERVED) || used.length === 0) return fail();
            const value = literal.value.replace(TOKEN, value => tokenValues.get(value)!.batch.rehydrate(value));
            restored += text.slice(cursor, literal.start) + JSON.stringify(value);
            cursor = literal.end;
            if (restored.length > 262_144) return fail();
        }
        restored += text.slice(cursor);
        guard();
        if (restored.length > 262_144 || !ordinaryCanonicalTextBounds(profile, JSON.parse(restored))) return fail();
        // Original parser/closure includes original DS source-set and locator checks.
        return read.parseOutput(restored);
    }
    const ready = (async (): Promise<PreparedOrdinaryProfile> => {
        try {
            guard();
            const entityCounts: Record<string, number> = {};
            let expansion = 1;
            for (const batch of work) {
                guard();
                const entities = await runner.extract(batch.text, signal);
                guard();
                for (const entity of entities) slotForSpan(batch, entity);
                const prepared = session.prepare({ text: batch.text, entities, knownIdentifiers: known });
                for (const span of prepared.spans) {
                    slotForSpan(batch, span); // Deterministic/merged spans obey the same partition.
                    tokenValues.set(span.replacement, { batch: prepared, rawLength: span.end - span.start });
                    expansion = Math.max(expansion, span.replacement.length / (span.end - span.start));
                }
                for (const [key, count] of Object.entries(prepared.entityCounts)) {
                    entityCounts[key] = (entityCounts[key] ?? 0) + count;
                    if (entityCounts[key] > 4096) return fail(); // Existing audit's count bound.
                }
                for (const slot of batch.slots) {
                    let value = '', position = slot.start;
                    for (const span of prepared.spans) if (span.start >= slot.start && span.end <= slot.end) {
                        value += batch.text.slice(position, span.start) + span.replacement; position = span.end;
                    }
                    replacements.set(slot.unit, value + batch.text.slice(position, slot.end));
                }
            }
            guard();
            const content = Object.freeze({ input: Object.freeze([Object.freeze({ type: 'text' as const,
                text: renderEmissionPlan(read.emissionPlan, replacements), text_elements: Object.freeze([]) as readonly [] })]),
                outputSchema: expandSchema(profile, read.outputSchema, expansion) });
            const payload = JSON.stringify(content);
            // All input growth is bounded by 64 batches * 512 spans and canonical
            // units; remote output retains the existing 262144 lexical cap.
            const metadata = Object.freeze({ functionId: read.functionId, profileVersion: read.profileVersion,
                sourceSha256: read.inputSha256, payloadSha256: sha256(payload), payloadBytes: Buffer.byteLength(payload, 'utf8'),
                payload, content, entityCounts: Object.freeze(entityCounts), parseOutput: rehydrateJson });
            await runner.close(); // No neural process need survive until remote login.
            guard();
            records.set(token, { read: metadata, close });
            return token;
        } catch {
            try { await close(); } catch { /* Cleanup remains unconfirmed to close() callers. */ }
            return fail();
        }
    })();
    void ready.catch(() => {});
    return Object.freeze({ ready, close });
}
export function readPreparedOrdinaryProfile(token: unknown): PreparedOrdinaryRead {
    if (!token || typeof token !== 'object' || types.isProxy(token)) return fail();
    const record = records.get(token);
    if (!record || JSON.stringify(record.read.content) !== record.read.payload || sha256(record.read.payload) !== record.read.payloadSha256) return fail();
    return record.read;
}
export function isPreparedOrdinaryProfileCurrent(token: unknown): boolean {
    return !!token && typeof token === 'object' && !types.isProxy(token) && records.has(token);
}
export function closePreparedOrdinaryProfile(token: unknown): Promise<void> {
    if (!token || typeof token !== 'object' || types.isProxy(token)) return Promise.reject(new Error('ordinary_preparation_invalid'));
    const record = records.get(token);
    return record ? record.close() : Promise.resolve();
}
