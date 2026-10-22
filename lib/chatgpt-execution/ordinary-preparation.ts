/* local content preparation, NEVER egress or patient-context authority. */
import 'server-only';
import { types } from 'node:util';
import type { RedactionSessionInput } from '../ai-redaction-session';
import type { RedactionRuntimeIdentity } from '../redaction-runtime-identity';
import { scanJsonObject } from '../ai-json-lexical';
import { renderEmissionPlan } from '../ai-preparation/emission-plan';
import { createContentPreparation, readPreparedContent, isPreparedContentCurrent, type PreparationRunnerConfiguration, type PreparedContent } from '../ai-preparation/preparation-core';
import { readOrdinaryTaskProfile, ordinaryTextPath, ordinaryCanonicalTextBounds, type OrdinaryTaskProfile, type OrdinaryTaskOutput } from './ordinary-task-profile';

export type OrdinaryRunnerConfiguration = PreparationRunnerConfiguration;
export type PreparedOrdinaryProfile = object;
export type PreparedOrdinaryRead = Readonly<{
    functionId: ReturnType<typeof readOrdinaryTaskProfile>['functionId'];
    profileVersion: ReturnType<typeof readOrdinaryTaskProfile>['profileVersion'];
    sourceSha256: string; payloadSha256: string; payloadBytes: number;
    payload: string;
    content: Readonly<{ input: readonly Readonly<{ type: 'text'; text: string; text_elements: readonly [] }>[]; outputSchema: Readonly<Record<string, unknown>> }>;
    entityCounts: Readonly<Record<string, number>>;
    redactionIdentity: RedactionRuntimeIdentity | null;
    parseOutput(text: string): OrdinaryTaskOutput;
}>;
const records = new WeakMap<object, { core: PreparedContent; read: PreparedOrdinaryRead; close(): Promise<void> }>();
const RESERVED = /MF_PII/iu;
const fail = (): never => { throw new Error('ordinary_preparation_invalid'); };
function expandSchema(profile: OrdinaryTaskProfile, schema: Readonly<Record<string, unknown>>, expansion: number, path: readonly (string | number)[] = []): Readonly<Record<string, unknown>> {
    const result = { ...schema };
    if (schema.type === 'object') result.properties = Object.freeze(Object.fromEntries(Object.entries(schema.properties as Record<string, Readonly<Record<string, unknown>>>).map(([key, child]) => [key, expandSchema(profile, child, expansion, [...path, key])])));
    if (schema.type === 'array') result.items = expandSchema(profile, schema.items as Readonly<Record<string, unknown>>, expansion, [...path, 0]);
    if (Array.isArray(schema.anyOf)) result.anyOf = Object.freeze(schema.anyOf.map(child => expandSchema(profile, child, expansion, path)));
    if (schema.type === 'string' && typeof schema.maxLength === 'number' && ordinaryTextPath(profile, path)) result.maxLength = Math.min(262_144, Math.ceil(schema.maxLength * expansion));
    return Object.freeze(result);
}

export function createOrdinaryPreparation(profile: OrdinaryTaskProfile, configuration: OrdinaryRunnerConfiguration,
    signal?: AbortSignal, knownIdentifiers?: RedactionSessionInput['knownIdentifiers']): Readonly<{ ready: Promise<PreparedOrdinaryProfile>; close(): Promise<void> }> {
    const read = readOrdinaryTaskProfile(profile);
    if (renderEmissionPlan(read.emissionPlan) !== read.prompt) return fail();
    let job: ReturnType<typeof createContentPreparation>;
    try {
        job = createContentPreparation(read.emissionPlan, configuration, (text, expansion) => Object.freeze({
            input: Object.freeze([Object.freeze({ type: 'text' as const, text, text_elements: Object.freeze([]) as readonly [] })]),
            outputSchema: expandSchema(profile, read.outputSchema, expansion),
        }), signal, knownIdentifiers);
    } catch (error) {
        if (error instanceof Error && error.message === 'ai_preparation_invalid') return fail();
        throw error;
    }
    const token = Object.freeze(Object.create(null));
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
        records.delete(token);
        closing ??= job.close().catch(() => { throw new Error('ordinary_cleanup_unconfirmed'); });
        void closing.catch(() => {});
        return closing;
    };
    const ready = job.ready.then(core => {
        const prepared = readPreparedContent(core);
        const rehydrateJson = (text: string): OrdinaryTaskOutput => {
            const guard = () => { if (!isPreparedContentCurrent(core)) return fail(); };
            guard();
            const literals = scanJsonObject(text);
            if (!literals) return fail();
            let cursor = 0, restored = '';
            for (const literal of literals) {
                if (!literal.value.isWellFormed()) return fail();
                if (!literal.value.match(RESERVED)) continue;
                if (literal.key || !ordinaryTextPath(profile, literal.path)) return fail();
                let value: string;
                try { value = prepared.restoreText(literal.value); } catch { return fail(); }
                restored += text.slice(cursor, literal.start) + JSON.stringify(value);
                cursor = literal.end;
                if (restored.length > 262_144) return fail();
            }
            restored += text.slice(cursor);
            guard();
            if (restored.length > 262_144 || !ordinaryCanonicalTextBounds(profile, JSON.parse(restored))) return fail();
            return read.parseOutput(restored);
        };
        const metadata = Object.freeze({ functionId: read.functionId, profileVersion: read.profileVersion,
            sourceSha256: read.inputSha256, payloadSha256: prepared.payloadSha256, payloadBytes: prepared.payloadBytes,
            payload: prepared.payload, content: prepared.content as PreparedOrdinaryRead['content'], entityCounts: prepared.entityCounts,
            redactionIdentity: prepared.redactionIdentity, parseOutput: rehydrateJson });
        records.set(token, { core, read: metadata, close });
        return token;
    }).catch(() => fail());
    void ready.catch(() => {});
    return Object.freeze({ ready, close });
}
export function readPreparedOrdinaryProfile(token: unknown): PreparedOrdinaryRead {
    if (!token || typeof token !== 'object' || types.isProxy(token)) return fail();
    const record = records.get(token);
    if (!record) return fail();
    try { readPreparedContent(record.core); } catch { return fail(); }
    return record.read;
}
export function isPreparedOrdinaryProfileCurrent(token: unknown): boolean {
    if (!token || typeof token !== 'object' || types.isProxy(token)) return false;
    const record = records.get(token);
    return !!record && isPreparedContentCurrent(record.core);
}
export function closePreparedOrdinaryProfile(token: unknown): Promise<void> {
    if (!token || typeof token !== 'object' || types.isProxy(token)) return Promise.reject(new Error('ordinary_preparation_invalid'));
    const record = records.get(token);
    return record ? record.close() : Promise.resolve();
}
