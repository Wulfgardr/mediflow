/* @Codex — named setting, default OFF; no bearer capabilities are persisted. */
import 'server-only';
import * as owner from '../security/web-auth-lifecycle-owner-adapter';
import { createHash } from 'node:crypto';
import { FUNCTION_MODEL_IDS, FUNCTION_SWITCH_KEYS, isFunctionModelId, type FunctionModelId } from '../ai-providers/fabric/function-model-preferences';
import { ProductError } from './product-contract';
import type { ModelEffort } from '../chatgpt-execution/execution-contract';
export const ORDINARY_CLOUD_SETTINGS_KEY = 'ai.fabric.chatgptOrdinary';
export type OrdinaryPreference = Readonly<{ use: 'local' | 'chatgpt_subscription'; model: string | null; effort: ModelEffort | null }>;
type Stored = Readonly<{ schema: 'mediflow.chatgpt-ordinary-settings.v1'; enabled: boolean; retention: 'chatgpt_service_terms_apply';
    preferences: Readonly<Record<FunctionModelId, OrdinaryPreference>> }>;
export type OrdinaryCloudSettings = Stored & Readonly<{ revision: string; lanes: Readonly<Record<FunctionModelId, string | undefined>> }>;
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const hash = (text: string) => 'sha256_' + createHash('sha256').update(text, 'utf8').digest('hex');
function exact(v: unknown, keys: string[]): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype || Object.keys(v).length !== keys.length
        || keys.some(k => !Object.hasOwn(v, k) || !('value' in Object.getOwnPropertyDescriptor(v, k)!))) throw new ProductError('invalid_request');
    return v as Record<string, unknown>;
}
export function parseOrdinaryStoredSettings(raw?: string): Stored {
    if (raw === undefined) return Object.freeze({ schema: 'mediflow.chatgpt-ordinary-settings.v1', enabled: false, retention: 'chatgpt_service_terms_apply',
        preferences: Object.freeze(Object.fromEntries(FUNCTION_MODEL_IDS.map(id => [id, Object.freeze({ use: 'local', model: null, effort: null })]))) as Stored['preferences'] });
    if (raw.length > 8192) throw new ProductError('invalid_request');
    const value = exact(JSON.parse(raw), ['schema', 'enabled', 'retention', 'preferences']);
    if (value.schema !== 'mediflow.chatgpt-ordinary-settings.v1' || typeof value.enabled !== 'boolean' || value.retention !== 'chatgpt_service_terms_apply') throw new ProductError('invalid_request');
    const prefs = exact(value.preferences, [...FUNCTION_MODEL_IDS]);
    const preferences = Object.fromEntries(FUNCTION_MODEL_IDS.map(id => {
        const p = exact(prefs[id], ['use', 'model', 'effort']);
        if (!['local', 'chatgpt_subscription'].includes(String(p.use)) || (p.model !== null && (typeof p.model !== 'string' || !p.model.trim() || p.model.length > 160 || /[\x00-\x1f]/u.test(p.model)))
            || (p.effort !== null && !efforts.includes(String(p.effort))) || (p.model === null) !== (p.effort === null)) throw new ProductError('invalid_request');
        return [id, Object.freeze(p)];
    })) as Stored['preferences'];
    return Object.freeze({ schema: value.schema, enabled: value.enabled, retention: value.retention, preferences });
}
async function database() {
    const [{ dbServer, runDbServerImmediateTransaction }, { settings }, orm] = await Promise.all([import('../db-server'), import('../schema'), import('drizzle-orm')]);
    return { dbServer, runDbServerImmediateTransaction, settings, ...orm };
}
export async function readOrdinaryCloudSettings(): Promise<OrdinaryCloudSettings> {
    const { dbServer, settings, inArray } = await database();
    const rows = dbServer.select({ key: settings.key, value: settings.value }).from(settings)
        .where(inArray(settings.key, [ORDINARY_CLOUD_SETTINGS_KEY, ...Object.values(FUNCTION_SWITCH_KEYS)])).all();
    const values = Object.fromEntries(rows.map((row: { key: string; value: string }) => [row.key, row.value]));
    const stored = parseOrdinaryStoredSettings(values[ORDINARY_CLOUD_SETTINGS_KEY]);
    return Object.freeze({ ...stored, revision: hash(JSON.stringify(stored)),
        lanes: Object.freeze(Object.fromEntries(FUNCTION_MODEL_IDS.map(id => [id, values[FUNCTION_SWITCH_KEYS[id]]]))) as OrdinaryCloudSettings['lanes'] });
}
/** Caller is the authenticated named HTTP controller. It must retain the original
 * resource use across this await, then commit its response. No generic settings writer. */
export async function writeOrdinaryCloudSettings(session: owner.WebSessionProjection, expectedRevision: string, change: Readonly<{ enabled?: boolean; preference?: Readonly<{ functionId: FunctionModelId; value: OrdinaryPreference }> }>, signal?: AbortSignal): Promise<void> {
    const port = owner.mintResourcePort(session);
    if (!port) throw new ProductError('session_expired');
    try {
    if (signal?.aborted) throw new ProductError('revoked');
    const { dbServer, settings, eq, runDbServerImmediateTransaction } = await database();
    if (signal?.aborted) throw new ProductError('revoked');
    runDbServerImmediateTransaction(() => {
        const use = owner.beginResourceUse(port);
        if (!use) throw new ProductError('session_expired');
        try {
        const row = dbServer.select({ value: settings.value }).from(settings).where(eq(settings.key, ORDINARY_CLOUD_SETTINGS_KEY)).get();
        const before = parseOrdinaryStoredSettings(row?.value);
        if (hash(JSON.stringify(before)) !== expectedRevision) throw new ProductError('consent_stale');
        if (change.preference && !isFunctionModelId(change.preference.functionId)) throw new ProductError('invalid_request');
        const after = parseOrdinaryStoredSettings(JSON.stringify({ ...before, ...(change.enabled === undefined ? {} : { enabled: change.enabled }),
            preferences: change.preference ? { ...before.preferences, [change.preference.functionId]: change.preference.value } : before.preferences }));
        let valid = false;
        if (signal?.aborted || !owner.withCurrentResourceBinding(use, () => { valid = !signal?.aborted; }) || !valid || !owner.commitResourceUse(use)) throw new ProductError('session_expired');
        // No await from the authenticated commit through the immediate transaction.
        dbServer.insert(settings).values({ key: ORDINARY_CLOUD_SETTINGS_KEY, value: JSON.stringify(after) })
            .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(after) } }).run();
        } finally { owner.abortResourceUse(use); }
    });
    } finally { owner.releaseResourcePort(port); }
}
