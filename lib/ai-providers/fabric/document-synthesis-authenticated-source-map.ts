import 'server-only';

/* @Codex */
import { types } from 'node:util';
import { createDocumentSynthesisSourceBindingOwner, type DocumentSynthesisSourceBindingResult } from './document-synthesis-source-binding';
import { createDocumentSynthesisSourceMapContract, type DocumentSynthesisSourceMapResult } from './document-synthesis-source-map-contract';

type SourceMap = Extract<DocumentSynthesisSourceMapResult, { status: 'available' }>['sourceMap'];
type Binding = Extract<DocumentSynthesisSourceBindingResult, { status: 'available' }>['binding'];
type Common = Readonly<{ reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;
type DenialCode = 'input_invalid' | Extract<DocumentSynthesisSourceBindingResult, { status: 'denied' }>['code'];
type Available = Readonly<{ status: 'available'; code: null; sourceMap: SourceMap; binding: Binding }> & Common;
type Denied = Readonly<{ status: 'denied'; code: DenialCode; sourceMap: null; binding: null }> & Common;
export type DocumentSynthesisAuthenticatedSourceMapResult = Available | Denied;

const COMMON = Object.freeze({ reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const });
const KEYS = ['documentHandle', 'revision', 'freshness', 'output', 'outputSha256', 'citations'] as const;
function nullRecord<T extends object>(value: Record<string, unknown>): T { return Object.freeze(Object.assign(Object.create(null), value)) as T; }
function record(value: unknown): Record<string, unknown> | null {
    try {
        if (types.isProxy(value) || typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const found = Reflect.ownKeys(value);
        if (found.length !== KEYS.length || found.some((key) => typeof key !== 'string' || !KEYS.includes(key as typeof KEYS[number]))) return null;
        const copied = Object.create(null) as Record<string, unknown>;
        for (const key of KEYS) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null; copied[key] = descriptor.value; }
        return copied;
    } catch { return null; }
}
function denied(code: DenialCode): Denied { return nullRecord<Denied>({ status: 'denied', code, sourceMap: null, binding: null, ...COMMON }); }

export function createDocumentSynthesisAuthenticatedSourceMap(configuration: unknown): Readonly<{
    map(value: unknown): DocumentSynthesisAuthenticatedSourceMapResult;
    dispose(): void;
}> {
    const owner = createDocumentSynthesisSourceBindingOwner(configuration); const sourceMapContract = createDocumentSynthesisSourceMapContract();
    return nullRecord({ map(value: unknown): DocumentSynthesisAuthenticatedSourceMapResult {
        const input = record(value); if (!input) return denied('input_invalid');
        const mapped = sourceMapContract.map({ output: input.output, outputSha256: input.outputSha256, citations: input.citations });
        if (mapped.status !== 'available') return denied('input_invalid');
        const ids: string[] = []; const seen = new Set<string>();
        for (const claim of mapped.sourceMap.claims) for (const sourceId of claim.sourceIds) if (!seen.has(sourceId)) { seen.add(sourceId); ids.push(sourceId); }
        const resolved = owner.resolve(owner.token, { documentHandle: input.documentHandle, revision: input.revision, freshness: input.freshness, sourceIds: ids });
        if (resolved.status !== 'available') return denied(resolved.code);
        return nullRecord<Available>({ status: 'available', code: null, sourceMap: mapped.sourceMap, binding: resolved.binding, ...COMMON });
    }, dispose() { owner.dispose(); } });
}
