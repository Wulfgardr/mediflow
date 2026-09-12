/* @Codex */
import 'server-only';

export type JsonStringLiteral = Readonly<{ start: number; end: number; value: string; key: boolean; path: readonly (string | number)[] }>;
const parse = JSON.parse;
const freeze = Object.freeze;
const apply = Reflect.apply;
const slice = String.prototype.slice;
const SetType = Set;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const finite = Number.isFinite;

/** Validates the complete object before exposing lexical ranges. No repair or authority. */
export function scanJsonObject(text: unknown): readonly JsonStringLiteral[] | null {
    if (typeof text !== 'string' || text.length === 0 || text.length > 262_144) return null;
    let cursor = 0; let nodes = 0;
    const literals: JsonStringLiteral[] = [];
    const white = () => { while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\n' || text[cursor] === '\r' || text[cursor] === '\t')) cursor++; };
    const childPath = (path: readonly (string | number)[], child: string | number) => {
        const next: (string | number)[] = [];
        for (let index = 0; index < path.length; index++) next[index] = path[index]!;
        next[path.length] = child;
        return freeze(next);
    };
    const string = (path: readonly (string | number)[], key: boolean): string | null => {
        if (text[cursor] !== '"') return null;
        const start = cursor++; let escaped = false;
        while (cursor < text.length) {
            const character = text[cursor++]!;
            if (escaped) { escaped = false; continue; }
            if (character === '\\') { escaped = true; continue; }
            if (character !== '"') continue;
            try {
                const value: unknown = parse(apply(slice, text, [start, cursor]));
                if (typeof value !== 'string') return null;
                literals[literals.length] = freeze({ start, end: cursor, value, key, path: key ? childPath(path, value) : path });
                return value;
            } catch { return null; }
        }
        return null;
    };
    const value = (depth: number, path: readonly (string | number)[]): boolean => {
        if (depth > 64 || ++nodes > 16_384) return false;
        white(); const character = text[cursor];
        if (character === '"') return string(path, false) !== null;
        if (character === '{') {
            cursor++; white(); const keys = new SetType<string>();
            if (text[cursor] === '}') { cursor++; return true; }
            while (true) {
                const key = string(path, true);
                if (key === null || apply(setHas, keys, [key])) return false;
                apply(setAdd, keys, [key]); white();
                if (text[cursor++] !== ':' || !value(depth + 1, childPath(path, key))) return false;
                white(); if (text[cursor] === '}') { cursor++; return true; }
                if (text[cursor++] !== ',') return false;
                white();
            }
        }
        if (character === '[') {
            cursor++; white(); let index = 0;
            if (text[cursor] === ']') { cursor++; return true; }
            while (true) {
                if (!value(depth + 1, childPath(path, index++))) return false;
                white(); if (text[cursor] === ']') { cursor++; return true; }
                if (text[cursor++] !== ',') return false;
                white();
            }
        }
        const start = cursor;
        while (cursor < text.length && !(',]} \n\r\t'.includes(text[cursor]!))) cursor++;
        if (cursor === start) return false;
        try {
            const primitive: unknown = parse(apply(slice, text, [start, cursor]));
            return primitive === null || typeof primitive === 'boolean' || (typeof primitive === 'number' && finite(primitive));
        } catch { return false; }
    };
    try {
        white(); if (text[cursor] !== '{' || !value(0, freeze([]))) return null;
        white(); return cursor === text.length ? freeze(literals) : null;
    } catch { return null; }
}
