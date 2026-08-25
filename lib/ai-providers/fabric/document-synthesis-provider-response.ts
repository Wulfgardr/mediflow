import 'server-only';

/* @Codex */
import { types } from 'node:util';

import {
    normalizeDocumentSynthesisOutput,
    type DocumentSynthesisOutput,
    type DocumentSynthesisOutputContractResult,
} from './document-synthesis-output-contract';

const MAX_CONTENT_CHARS = 262_144;
const OBJECT = Object.prototype;

function frozenRecord(entries: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const record = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries(entries)) record[key] = value;
    return Object.freeze(record);
}

function contentFrom(value: unknown): string | null {
    try {
        if (types.isProxy(value) || typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== OBJECT) return null;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== 1 || keys[0] !== 'content') return null;
        const descriptor = Object.getOwnPropertyDescriptor(value, 'content');
        return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value : null;
    } catch { return null; }
}

function duplicateJsonKeys(content: string): boolean {
    const containers: Array<{ object: boolean; keys: Set<string> }> = [];
    for (let index = 0; index < content.length; index += 1) {
        const character = content[index];
        if (character === '"') {
            const start = index; let escaped = false;
            for (index += 1; index < content.length; index += 1) {
                const current = content[index];
                if (escaped) { escaped = false; continue; }
                if (current === '\\') { escaped = true; continue; }
                if (current === '"') break;
            }
            if (index >= content.length) return true;
            let next = index + 1; while (/\s/u.test(content[next] ?? '')) next += 1;
            if (content[next] !== ':') continue;
            const container = containers.at(-1);
            if (!container?.object) return true;
            let key: string;
            try { key = JSON.parse(content.slice(start, index + 1)) as string; } catch { return true; }
            if (container.keys.has(key)) return true;
            container.keys.add(key);
        } else if (character === '{') {
            containers.push({ object: true, keys: new Set() });
        } else if (character === '[') {
            containers.push({ object: false, keys: new Set() });
        } else if (character === '}' || character === ']') {
            containers.pop();
        }
    }
    return false;
}

function parseOneJsonObject(content: string): unknown | null {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > MAX_CONTENT_CHARS || duplicateJsonKeys(trimmed)) return null;
    try {
        const parsed: unknown = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
}

function isolate(value: unknown): unknown {
    if (Array.isArray(value)) return Object.freeze(value.map(isolate));
    if (value && typeof value === 'object') {
        const copy = Object.create(null) as Record<string, unknown>;
        for (const [key, item] of Object.entries(value)) copy[key] = isolate(item);
        return Object.freeze(copy);
    }
    return value;
}

function seal(result: DocumentSynthesisOutputContractResult): DocumentSynthesisOutputContractResult {
    if (result.status === 'denied') return frozenRecord({ status: 'denied', code: result.code, value: null, reviewOnly: result.reviewOnly, writesPerformed: result.writesPerformed, applyPolicy: result.applyPolicy }) as DocumentSynthesisOutputContractResult;
    return frozenRecord({ status: 'available', code: null, value: isolate(result.value) as DocumentSynthesisOutput, reviewOnly: result.reviewOnly, writesPerformed: result.writesPerformed, applyPolicy: result.applyPolicy }) as DocumentSynthesisOutputContractResult;
}

/** Pure C3b0 boundary: exact provider content framing followed by canonical output normalization. */
export function normalizeDocumentSynthesisProviderResponse(value: unknown): DocumentSynthesisOutputContractResult {
    const content = contentFrom(value);
    const parsed = content === null ? null : parseOneJsonObject(content);
    return seal(parsed === null ? normalizeDocumentSynthesisOutput(null) : normalizeDocumentSynthesisOutput(parsed));
}
