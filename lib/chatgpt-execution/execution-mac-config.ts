/* @Codex — fixed source provenance and structural projection validation, never an issuer. */
import 'server-only';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExecutionError } from './execution-contract';

export const MAC_CONTEXT_SHA256 = '25374bcdc057575c57018f3379e2d3e9245e0258ea3fad679f85f6716548dc00';
export const MAC_POLICY_REVISION = 'mac-nofork-custodian-v1';
export const MAC_CONFIG_SOURCE = Object.freeze({
    schema: 'mediflow.config-input-source.v1', state: 'input_schema_source_available',
    commit: '3d2ee51ca2d5db578f328aa75e20aa22c0197c9a',
    url: 'https://raw.githubusercontent.com/openai/codex/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/config.schema.json',
    bytes: 200401, sha256: '692da7699367f6f4fbbd46c0021278c1311440bcebf0bcb9b836690c05e56196',
    receipt: Object.freeze({ bytes: 572, sha256: '216fc490e6b2df23e01dbc729da65651d6622ab8a272d4feafc2685064448584' }),
    loader: Object.freeze({ bytes: 76594, sha256: '6fc44b60c64065994c9aa18df248eb521dba6b0e9917a8cf69fc60e0035ac56a',
        url: 'https://raw.githubusercontent.com/openai/codex/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/config/src/loader/mod.rs',
        receiptBytes: 415, receiptSha256: 'e2f902e74eae01e297466be3d0a49110e82b219b797ae255cdd4e97b96085ca2' }),
    binaryBuildBinding: 'unqualified', runtimeReadback: 'not_observed',
} as const);
export const MAC_C1_RECEIPT = Object.freeze({ bytes: 8330,
    sha256: '2b07b00c3f0473acf5caafb706e07265db55c189e61e14259800e628e1d205ae' });
export const macDigest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export function readPinnedMacFile(path: string, pin: Readonly<{ bytes: number; sha256: string }>): Buffer {
    try {
        const before = lstatSync(path);
        if (!before.isFile() || before.isSymbolicLink() || before.size !== pin.bytes) throw new Error();
        const bytes = readFileSync(path), after = lstatSync(path);
        if (after.dev !== before.dev || after.ino !== before.ino || after.ctimeMs !== before.ctimeMs
            || bytes.length !== pin.bytes || macDigest(bytes) !== pin.sha256) throw new Error();
        return bytes;
    } catch { throw new ExecutionError('unqualified_boundary'); }
}

type RecordValue = Record<string, unknown>;
const rec = (value: unknown): RecordValue => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExecutionError('unqualified_boundary');
    return value as RecordValue;
};
/** Small validator for the fixed ConfigToml projection, NOT a general JSON-schema
 * library or a normalizer. No runtime permissions derive from source properties.
 * Unsupported validation constructs on a consumed node fail closed. */
export function assertMacInputProjection(schemaBytes: Buffer, projection: unknown): void {
    if (schemaBytes.length !== MAC_CONFIG_SOURCE.bytes || macDigest(schemaBytes) !== MAC_CONFIG_SOURCE.sha256)
        throw new ExecutionError('unqualified_boundary');
    const schema = rec(JSON.parse(schemaBytes.toString('utf8')));
    function accepts(node: unknown, value: unknown, depth = 0): boolean {
        if (depth > 32 || node === false) return false;
        if (node === true) return true;
        const rule = rec(node);
        // These constructs do not occur on the admitted projection. Do not silently
        // ignore future constraints if a reviewed source pin is later changed.
        for (const key of ['not', 'if', 'then', 'else', 'patternProperties', 'dependencies', 'dependentSchemas', 'contains', 'unevaluatedProperties'])
            if (Object.hasOwn(rule, key)) return false;
        if (typeof rule.$ref === 'string') {
            const prefix = '#/definitions/';
            if (!rule.$ref.startsWith(prefix)) return false;
            const target = rec(schema.definitions)[rule.$ref.slice(prefix.length)];
            if (!target || !accepts(target, value, depth + 1)) return false;
        }
        for (const op of ['allOf', 'anyOf', 'oneOf'] as const) if (rule[op]) {
            if (!Array.isArray(rule[op])) return false;
            const count = rule[op].filter(n => accepts(n, value, depth + 1)).length;
            if (op === 'allOf' ? count !== rule[op].length : op === 'oneOf' ? count !== 1 : count < 1) return false;
        }
        if (Array.isArray(rule.enum) && !rule.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) return false;
        if (Object.hasOwn(rule, 'const') && JSON.stringify(rule.const) !== JSON.stringify(value)) return false;
        const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        if (rule.type) {
            const types = Array.isArray(rule.type) ? rule.type : [rule.type];
            if (!types.some(t => t === actual || t === 'integer' && typeof value === 'number' && Number.isSafeInteger(value))) return false;
        }
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || typeof rule.minimum === 'number' && value < rule.minimum
                || typeof rule.maximum === 'number' && value > rule.maximum) return false;
        }
        if (typeof value === 'string') {
            if (typeof rule.minLength === 'number' && value.length < rule.minLength
                || typeof rule.maxLength === 'number' && value.length > rule.maxLength
                || typeof rule.pattern === 'string' && !new RegExp(rule.pattern, 'u').test(value)) return false;
        }
        if (Array.isArray(value)) return false; // The fixed input contains no arrays.
        if (actual === 'object') {
            const object = rec(value), properties = rule.properties ? rec(rule.properties) : {};
            if (Array.isArray(rule.required) && rule.required.some(k => typeof k !== 'string' || !Object.hasOwn(object, k))) return false;
            for (const [key, v] of Object.entries(object)) {
                if (Object.hasOwn(properties, key)) { if (!accepts(properties[key], v, depth + 1)) return false; }
                else if (rule.additionalProperties === false) return false;
                else if (rule.additionalProperties && typeof rule.additionalProperties === 'object'
                    && !accepts(rule.additionalProperties, v, depth + 1)) return false;
                else if (!Object.hasOwn(rule, '$ref') && !rule.allOf && !rule.anyOf && !rule.oneOf && !rule.additionalProperties) return false;
            }
        }
        return true;
    }
    if (!accepts(schema, projection)) throw new ExecutionError('unqualified_boundary');
}
export function verifyMacSourceSet(directory: string, c1ReceiptPath: string, projection: unknown) {
    const schema = readPinnedMacFile(join(directory, 'config.schema.json'), MAC_CONFIG_SOURCE);
    readPinnedMacFile(join(directory, 'RECEIPT.json'), MAC_CONFIG_SOURCE.receipt);
    readPinnedMacFile(join(directory, 'config-loader-mod.rs'), MAC_CONFIG_SOURCE.loader);
    readPinnedMacFile(join(directory, 'LOADER-RECEIPT.json'), {
        bytes: MAC_CONFIG_SOURCE.loader.receiptBytes, sha256: MAC_CONFIG_SOURCE.loader.receiptSha256 });
    const c1 = rec(JSON.parse(readPinnedMacFile(c1ReceiptPath, MAC_C1_RECEIPT).toString('utf8')));
    assertMacInputProjection(schema, projection);
    const comparison = c1.comparison;
    if (!Array.isArray(comparison) || comparison.length !== 24) throw new ExecutionError('unqualified_boundary');
    const pins = comparison.map(raw => {
        const value = rec(raw);
        if (typeof value.path !== 'string' || !/^v[12]\/[A-Za-z]+\.json$/u.test(value.path)
            || typeof value.expected_sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.expected_sha256)) throw new ExecutionError('unqualified_boundary');
        return Object.freeze({ path: value.path, sha256: value.expected_sha256 });
    });
    if (new Set(pins.map(pin => pin.path)).size !== pins.length) throw new ExecutionError('unqualified_boundary');
    return Object.freeze(pins);
}
