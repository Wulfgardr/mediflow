/* @Codex — content representation only; no server/session/provider authority. */
export type EmissionUnit = Readonly<{ kind: 'data'; value: string; encoding: 'text' | 'json-string' }>;
export type EmissionPart = string | EmissionUnit | Readonly<{ kind: 'utf8-length'; unit: EmissionUnit }>;
export type EmissionPlan = readonly EmissionPart[];
// Captured once: the existing Document Synthesis builder remains valid under
// post-import mutation of global intrinsics and Array iteration hooks.
const freeze = Object.freeze;
const apply = Reflect.apply;
const stringify = JSON.stringify;
const jsonObject = JSON;
const stringValue = String;
const Encoder = TextEncoder;
const encode = TextEncoder.prototype.encode;
const encoder = new Encoder();
const mapHas = Map.prototype.has;
const mapGet = Map.prototype.get;
export const emissionUnit = (value: string, encoding: EmissionUnit['encoding'] = 'text'): EmissionUnit => freeze({ kind: 'data', value, encoding });
export function emissionPlan(parts: readonly EmissionPart[]): EmissionPlan {
    const result: EmissionPart[] = [];
    for (let index = 0; index < parts.length; index++) result[index] = parts[index];
    return freeze(result);
}
export const utf8Length = (unit: EmissionUnit): EmissionPart => freeze({ kind: 'utf8-length', unit });
export function renderEmissionPlan(plan: EmissionPlan, replacements?: ReadonlyMap<EmissionUnit, string>): string {
    let result = '';
    for (let index = 0; index < plan.length; index++) {
        const part = plan[index];
        if (typeof part === 'string') { result += part; continue; }
        const unit = part.kind === 'data' ? part : part.unit;
        const value = replacements && apply(mapHas, replacements, [unit]) ? apply(mapGet, replacements, [unit]) as string : unit.value;
        if (part.kind === 'utf8-length') result += stringValue((apply(encode, encoder, [value]) as Uint8Array).length);
        else result += part.encoding === 'json-string' ? apply(stringify, jsonObject, [value]) : value;
    }
    return result;
}
/** Builds canonical JSON slots, not substring matches against a rendered prompt.
 * Snapshot via JSON serialization has the same input semantics as the old builder.
 * Only named builders call this; classification carries no admission. */
export function jsonEmissionPlan(value: unknown, structural: (path: readonly (string | number)[]) => boolean): EmissionPlan {
    const snapshot: unknown = JSON.parse(JSON.stringify(value));
    const parts: EmissionPart[] = [];
    function write(value: unknown, path: readonly (string | number)[], depth: number) {
        if (depth > 16) throw new Error('ordinary_emission_invalid');
        if (typeof value === 'string') { parts.push(structural(path) ? JSON.stringify(value) : emissionUnit(value, 'json-string')); return; }
        if (value === null || typeof value !== 'object') { parts.push(JSON.stringify(value)); return; }
        const array = Array.isArray(value);
        const entries = array ? value.map((item, index) => [index, item] as const) : Object.entries(value);
        parts.push(array ? '[' : '{');
        entries.forEach(([key, item], index) => {
            parts.push(`${index ? ',' : ''}\n${'  '.repeat(depth + 1)}`);
            if (!array) parts.push(`${JSON.stringify(key)}: `);
            write(item, [...path, key], depth + 1);
        });
        if (entries.length) parts.push(`\n${'  '.repeat(depth)}`);
        parts.push(array ? ']' : '}');
    }
    write(snapshot, [], 0);
    return emissionPlan(parts);
}
