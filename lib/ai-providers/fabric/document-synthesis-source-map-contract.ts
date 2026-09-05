import 'server-only';

/* @Codex */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { normalizeDocumentSynthesisOutput, type DocumentSynthesisOutput } from './document-synthesis-output-contract';

export const DOCUMENT_SYNTHESIS_SOURCE_MAP_SCHEMA_VERSION = 'mediflow.document-synthesis.source-map.v1' as const;

type ClaimSource = Readonly<{ claimPath: string; sourceIds: readonly string[] }>;
type SourceMap = Readonly<{ schemaVersion: typeof DOCUMENT_SYNTHESIS_SOURCE_MAP_SCHEMA_VERSION; outputSha256: string; claims: readonly ClaimSource[] }>;
type Common = Readonly<{ reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;
type Available = Readonly<{ status: 'available'; code: null; sourceMap: SourceMap }> & Common;
type Denied = Readonly<{ status: 'denied'; code: 'input_invalid'; sourceMap: null }> & Common;
export type DocumentSynthesisSourceMapResult = Available | Denied;

const COMMON = Object.freeze({ reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const });
const SOURCE_ID = /^source\.[a-z0-9][a-z0-9._:-]{2,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function nullRecord<T extends object>(value: Record<string, unknown>): T { return Object.freeze(Object.assign(Object.create(null), value)) as T; }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (types.isProxy(value) || typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const found = Reflect.ownKeys(value);
        if (found.length !== keys.length || found.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const result = Object.create(null) as Record<string, unknown>;
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            result[key] = descriptor.value;
        }
        return result;
    } catch { return null; }
}
function array(value: unknown, minimum: number, maximum: number): readonly unknown[] | null {
    try {
        if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) return null;
        const found = Reflect.ownKeys(value);
        if (found.length !== value.length + 1 || !found.includes('length')) return null;
        const result: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            result.push(descriptor.value);
        }
        return result;
    } catch { return null; }
}
function citation(value: unknown): ClaimSource | null {
    const item = record(value, ['claimPath', 'sourceIds']);
    const ids = item && array(item.sourceIds, 1, 32);
    if (!item || typeof item.claimPath !== 'string' || !ids || ids.some((id) => typeof id !== 'string' || !SOURCE_ID.test(id)) || new Set(ids).size !== ids.length) return null;
    return nullRecord<ClaimSource>({ claimPath: item.claimPath, sourceIds: Object.freeze([...ids] as string[]) });
}
function paths(output: DocumentSynthesisOutput): readonly string[] {
    const result = ['summary', 'data.qualityLevel'];
    if (output.data.qualityReason !== undefined) result.push('data.qualityReason');
    for (const [name, values] of [['medications', output.data.medications], ['diagnoses', output.data.diagnoses], ['problemStatements', output.data.problemStatements], ['therapyCandidates', output.data.therapyCandidates]] as const) values.forEach((_, index) => result.push(`data.${name}[${index}]`));
    output.data.servicePrescriptions.forEach((service, index) => {
        const path = `data.servicePrescriptions[${index}]`; result.push(path);
        service.items?.forEach((_, itemIndex) => result.push(`${path}.items[${itemIndex}]`));
    });
    return result;
}
function denied(): Denied { return nullRecord<Denied>({ status: 'denied', code: 'input_invalid', sourceMap: null, ...COMMON }); }

export function createDocumentSynthesisSourceMapContract(): Readonly<{ map(value: unknown): DocumentSynthesisSourceMapResult }> {
    return nullRecord({ map(value: unknown): DocumentSynthesisSourceMapResult {
        const input = record(value, ['output', 'outputSha256', 'citations']);
        const normalized = input && normalizeDocumentSynthesisOutput(input.output);
        const citations = input && array(input.citations, 2, 194)?.map(citation);
        if (!input || !normalized || normalized.status !== 'available' || typeof input.outputSha256 !== 'string' || !SHA256.test(input.outputSha256) || !citations || citations.some((item) => item === null)) return denied();
        const outputSha256 = createHash('sha256').update(JSON.stringify(normalized.value), 'utf8').digest('hex');
        const claimPaths = paths(normalized.value); const items = citations as ClaimSource[];
        if (input.outputSha256 !== outputSha256 || items.length !== claimPaths.length || new Set(items.map((item) => item.claimPath)).size !== items.length || items.some((item, index) => item.claimPath !== claimPaths[index])) return denied();
        const byPath = new Map(items.map((item) => [item.claimPath, item] as const));
        const claims = Object.freeze(claimPaths.map((claimPath) => nullRecord<ClaimSource>({ claimPath, sourceIds: Object.freeze([...(byPath.get(claimPath)!.sourceIds)] as string[]) })));
        return nullRecord<Available>({ status: 'available', code: null, sourceMap: nullRecord<SourceMap>({ schemaVersion: DOCUMENT_SYNTHESIS_SOURCE_MAP_SCHEMA_VERSION, outputSha256, claims }), ...COMMON });
    } });
}

const DEFAULT_CONTRACT = createDocumentSynthesisSourceMapContract();
export function mapDocumentSynthesisSources(value: unknown): DocumentSynthesisSourceMapResult { return DEFAULT_CONTRACT.map(value); }
