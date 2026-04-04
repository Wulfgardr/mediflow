/* @Codex */
import { inArray } from 'drizzle-orm';
/* @Codex */
import { dbServer } from './db-server.ts';
/* @Codex */
import type { NetworkAiRuntimeSummary, NetworkOperatingMode } from './api/v1/types.ts';
/* @Codex */
import { validateLocalTarget } from './local-target.ts';
/* @Codex */
import { settings } from './schema.ts';
/* @Codex */
import { NETWORK_MODE_KEY, normalizeNetworkOperatingMode } from './network-contract.ts';
/* @Codex */
import { deriveNetworkAiRuntimeSummary } from './network-ai-runtime-model.ts';

const NETWORK_AI_RUNTIME_SETTINGS_KEYS = [
    NETWORK_MODE_KEY,
    'aiProvider',
    'aiUrl',
    'ollamaUrl',
    'aiModel',
    'aiModel_clinical',
    'aiModel_reasoning',
    'aiModel_ocr',
    'hardwareProfile',
] as const;

type NetworkAiRuntimeSettingsSnapshot = Partial<Record<(typeof NETWORK_AI_RUNTIME_SETTINGS_KEYS)[number], string>>;

function normalizeSetting(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function resolveAiTarget(snapshot: NetworkAiRuntimeSettingsSnapshot): string {
    const genericUrl = normalizeSetting(snapshot.aiUrl);
    const legacyUrl = normalizeSetting(snapshot.ollamaUrl);

    if (!genericUrl && !legacyUrl) {
        return 'http://127.0.0.1:11434/v1';
    }

    if (genericUrl && !genericUrl.includes(':8080')) {
        return genericUrl;
    }

    if (legacyUrl && !legacyUrl.includes(':8080')) {
        return legacyUrl;
    }

    return 'http://127.0.0.1:11434/v1';
}

async function loadNetworkAiRuntimeSettingsSnapshot(): Promise<NetworkAiRuntimeSettingsSnapshot> {
    const rows = await dbServer
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(inArray(settings.key, [...NETWORK_AI_RUNTIME_SETTINGS_KEYS]));

    return rows.reduce<NetworkAiRuntimeSettingsSnapshot>((accumulator, row) => {
        accumulator[row.key as keyof NetworkAiRuntimeSettingsSnapshot] = row.value;
        return accumulator;
    }, {});
}

export async function getNetworkAiRuntimeSummary(
    operatingMode?: NetworkOperatingMode
): Promise<NetworkAiRuntimeSummary> {
    const snapshot = await loadNetworkAiRuntimeSettingsSnapshot();
    const resolvedOperatingMode = operatingMode
        ?? normalizeNetworkOperatingMode(snapshot[NETWORK_MODE_KEY]);
    const localTarget = validateLocalTarget(resolveAiTarget(snapshot));

    return deriveNetworkAiRuntimeSummary({
        operatingMode: resolvedOperatingMode,
        provider: normalizeSetting(snapshot.aiProvider) ?? 'ollama',
        localTargetValid: localTarget.ok,
        hardwareProfile: normalizeSetting(snapshot.hardwareProfile),
        clinicalModel: normalizeSetting(snapshot.aiModel_clinical)
            ?? normalizeSetting(snapshot.aiModel),
        reasoningModel: normalizeSetting(snapshot.aiModel_reasoning)
            ?? normalizeSetting(snapshot.aiModel),
        ocrModel: normalizeSetting(snapshot.aiModel_ocr),
    });
}
