/** Local preparation only. Handles grant neither patient-context nor egress authority. */
import 'server-only';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { createGlinerRedactionRunner, readGlinerRuntimeObservation } from '../gliner-redaction-runner';
import { createRedactionSession, type PreparedRedaction, type RedactionSessionInput } from '../ai-redaction-session';
import type { RedactionRuntimeIdentity } from '../redaction-runtime-identity';
import { renderEmissionPlan, type EmissionUnit, type EmissionPlan } from './emission-plan';

export type PreparationRunnerConfiguration = Parameters<typeof createGlinerRedactionRunner>[0];
export type PreparedContent = object;
export type PreparedContentRead = Readonly<{
    payloadSha256: string; payloadBytes: number; payload: string;
    content: Readonly<Record<string, unknown>>;
    entityCounts: Readonly<Record<string, number>>;
    redactionIdentity: RedactionRuntimeIdentity | null;
    restoreText(text: string): string;
}>;
type Slot = { unit: EmissionUnit; start: number; end: number };
type Batch = { text: string; slots: Slot[] };
const records = new WeakMap<object, { read: PreparedContentRead; close(): Promise<void> }>();
const RESERVED = /MF_PII/iu;
const TOKEN = /\{\{MF_PII_[a-f0-9]{32}_[1-9][0-9]{0,3}\}\}/gu;
const SEPARATOR = '\n\u241e\n';
const fail = (): never => { throw new Error('ai_preparation_invalid'); };
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
function freezeContent(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
    for (const child of Object.values(value)) if (child && typeof child === 'object') freezeContent(child as Record<string, unknown>);
    return Object.freeze(value);
}

/** close is available synchronously, before the first neural await. */
export function createContentPreparation(plan: EmissionPlan, configuration: PreparationRunnerConfiguration,
    buildContent: (text: string, expansion: number) => Readonly<Record<string, unknown>>,
    signal?: AbortSignal, knownIdentifiers?: RedactionSessionInput['knownIdentifiers']): Readonly<{ ready: Promise<PreparedContent>; close(): Promise<void> }> {
    const known = snapshotKnown(knownIdentifiers);
    const units = [...new Set(plan.flatMap(part => typeof part === 'string' ? [] : [part.kind === 'data' ? part : part.unit]))];
    const original = renderEmissionPlan(plan);
    if (original.match(RESERVED) || !original.isWellFormed()) return fail();
    const work = batches(units);
    const runner = createGlinerRedactionRunner(configuration);
    const session = createRedactionSession();
    const token = Object.freeze(Object.create(null));
    const tokenValues = new Map<string, { batch: PreparedRedaction }>();
    const replacements = new Map<EmissionUnit, string>();
    let closed = false;
    let closing: Promise<void> | undefined;
    function close(): Promise<void> {
        if (closing) return closing;
        closed = true; records.delete(token); tokenValues.clear(); replacements.clear(); session.close();
        signal?.removeEventListener('abort', abort);
        // Reject cleanup failures, never claim success merely from a timer.
        closing = Promise.resolve().then(() => runner.close()).catch(() => { throw new Error('ai_preparation_cleanup_unconfirmed'); });
        void closing.catch(() => {});
        return closing;
    }
    const abort = () => { void close(); };
    const guard = () => { if (closed || signal?.aborted) return fail(); };
    signal?.addEventListener('abort', abort, { once: true });
    function restoreText(text: string): string {
        guard();
        const used: string[] = [];
        const without = text.replace(TOKEN, value => { if (!tokenValues.has(value)) return fail(); used.push(value); return ''; });
        if (without.match(RESERVED) || used.length === 0) return fail();
        return text.replace(TOKEN, value => tokenValues.get(value)!.batch.rehydrate(value));
    }
    const ready = (async (): Promise<PreparedContent> => {
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
                    slotForSpan(batch, span);
                    tokenValues.set(span.replacement, { batch: prepared });
                    expansion = Math.max(expansion, span.replacement.length / (span.end - span.start));
                }
                for (const [key, count] of Object.entries(prepared.entityCounts)) {
                    entityCounts[key] = (entityCounts[key] ?? 0) + count;
                    if (entityCounts[key] > 4096) return fail();
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
            const payload = JSON.stringify(buildContent(renderEmissionPlan(plan, replacements), expansion));
            const content = freezeContent(JSON.parse(payload));
            const metadata = Object.freeze({ payloadSha256: sha256(payload), payloadBytes: Buffer.byteLength(payload, 'utf8'),
                payload, content, entityCounts: Object.freeze(entityCounts), redactionIdentity: readGlinerRuntimeObservation(runner), restoreText });
            await runner.close();
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
export function readPreparedContent(token: unknown): PreparedContentRead {
    if (!token || typeof token !== 'object' || types.isProxy(token)) return fail();
    const record = records.get(token);
    if (!record || JSON.stringify(record.read.content) !== record.read.payload || sha256(record.read.payload) !== record.read.payloadSha256) return fail();
    return record.read;
}
export function isPreparedContentCurrent(token: unknown): boolean {
    return !!token && typeof token === 'object' && !types.isProxy(token) && records.has(token);
}
export function closePreparedContent(token: unknown): Promise<void> {
    if (!token || typeof token !== 'object' || types.isProxy(token)) return Promise.reject(new Error('ai_preparation_invalid'));
    const record = records.get(token);
    return record ? record.close() : Promise.resolve();
}
