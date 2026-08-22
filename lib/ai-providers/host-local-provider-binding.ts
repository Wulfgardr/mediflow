/* @Codex */
import 'server-only';
import { inArray } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { resolveTextModel } from '@/lib/ai-model-selection';
import { settings } from '@/lib/schema';
import { DEFAULT_OLLAMA_BASE_URL, resolveOllamaBaseUrl } from './base-url';
import {
    localProviderRegistry,
    ProviderRegistryError,
    type LocalProviderResolution,
    type ProviderRegistryErrorCode,
} from './registry';

const HOST_LOCAL_PROVIDER_SETTING_KEYS = [
    'aiProvider',
    'aiModel_clinical',
    'aiModel',
    'aiUrl',
    'ollamaUrl',
] as const;
const CLINICAL_CHAT_TIMEOUT_MS = 300_000;

type HostLocalProviderSettingKey = typeof HOST_LOCAL_PROVIDER_SETTING_KEYS[number];
export type HostLocalProviderSettingsSnapshot = Readonly<Partial<Record<HostLocalProviderSettingKey, string>>>;
type HostLocalProviderSettingsReader = () => Promise<HostLocalProviderSettingsSnapshot>;

export type HostLocalProviderBindingDenialCode =
    | 'settings_unavailable'
    | 'settings_corrupt'
    | 'provider_invalid'
    | 'model_invalid'
    | 'endpoint_invalid';

export type HostLocalProviderBindingResult =
    | Readonly<{ status: 'available'; resolution: LocalProviderResolution }>
    | Readonly<{ status: 'denied'; code: HostLocalProviderBindingDenialCode; resolution: null }>;

function isSettingKey(value: PropertyKey): value is HostLocalProviderSettingKey {
    return typeof value === 'string'
        && HOST_LOCAL_PROVIDER_SETTING_KEYS.includes(value as HostLocalProviderSettingKey);
}

function snapshotSettings(value: unknown): HostLocalProviderSettingsSnapshot {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('invalid');

    const snapshot: Partial<Record<HostLocalProviderSettingKey, string>> = {};
    for (const key of Reflect.ownKeys(value)) {
        if (!isSettingKey(key)) throw new Error('invalid');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') {
            throw new Error('invalid');
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

async function readProductionSettings(): Promise<HostLocalProviderSettingsSnapshot> {
    const rows = await dbServer
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(inArray(settings.key, [...HOST_LOCAL_PROVIDER_SETTING_KEYS]));

    return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
}

function deny(code: HostLocalProviderBindingDenialCode): HostLocalProviderBindingResult {
    return Object.freeze({ status: 'denied', code, resolution: null });
}

function mapRegistryDenial(code: ProviderRegistryErrorCode): HostLocalProviderBindingDenialCode {
    switch (code) {
        case 'provider_not_registered':
        case 'provider_not_local':
            return 'provider_invalid';
        case 'invalid_model':
            return 'model_invalid';
        case 'endpoint_not_local':
            return 'endpoint_invalid';
        case 'invalid_task':
            return 'settings_corrupt';
    }
}

export function createHostLocalProviderBindingService(options: Readonly<{
    readSettings?: HostLocalProviderSettingsReader;
}> = {}) {
    const readSettings = options.readSettings ?? readProductionSettings;
    return Object.freeze({
        async readClinical(): Promise<HostLocalProviderBindingResult> {
            let rawSnapshot: unknown;
            try {
                rawSnapshot = await readSettings();
            } catch {
                return deny('settings_unavailable');
            }

            let snapshot: HostLocalProviderSettingsSnapshot;
            try {
                snapshot = snapshotSettings(rawSnapshot);
            } catch {
                return deny('settings_corrupt');
            }

            try {
                const resolution = localProviderRegistry.resolve({
                    task: 'clinical',
                    provider: snapshot.aiProvider ?? 'ollama',
                    models: { clinical: resolveTextModel(snapshot.aiModel_clinical, snapshot.aiModel) },
                    endpoint: resolveOllamaBaseUrl(snapshot.aiUrl, snapshot.ollamaUrl, DEFAULT_OLLAMA_BASE_URL),
                    disableThinking: true,
                    chatTimeoutMs: CLINICAL_CHAT_TIMEOUT_MS,
                });
                return Object.freeze({ status: 'available', resolution });
            } catch (error) {
                return error instanceof ProviderRegistryError
                    ? deny(mapRegistryDenial(error.code))
                    : deny('settings_corrupt');
            }
        },
    });
}
