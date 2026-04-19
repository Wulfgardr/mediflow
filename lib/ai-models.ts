/* @Codex */
import { db } from '@/lib/db';

export const DEFAULT_TEXT_MODEL = 'qwen3.5:35b-a3b';
export const DEFAULT_OCR_MODEL = 'deepseek-ocr';
export const LEGACY_QWEN_TEXT_MODEL = 'qwen2.5:32b';
export const LEGACY_MEDGEMMA_TEXT_MODEL = 'hf.co/unsloth/medgemma-1.5-4b-it-GGUF';

const TEXT_MODEL_MIGRATION_VERSION = 'qwen35-default-v1';
const STALE_TEXT_MODELS = new Set([
    LEGACY_QWEN_TEXT_MODEL,
    LEGACY_MEDGEMMA_TEXT_MODEL,
]);

let migrationComplete = false;
let migrationPromise: Promise<void> | null = null;

function normalizeModelName(model?: string | null): string | null {
    const value = model?.trim();
    return value ? value : null;
}

export function resolveTextModel(specificModel?: string | null, legacyModel?: string | null): string {
    const specific = normalizeModelName(specificModel);
    if (specific) return specific;

    const legacy = normalizeModelName(legacyModel);
    if (!legacy || STALE_TEXT_MODELS.has(legacy)) {
        return DEFAULT_TEXT_MODEL;
    }

    return legacy;
}

async function migrateSettingIfNeeded(key: string, nextValue: string): Promise<void> {
    const current = await db.settings.get(key);
    if (!current?.value || !STALE_TEXT_MODELS.has(current.value)) return;
    await db.settings.put({ key, value: nextValue });
}

export async function ensureTextModelDefaultsUpgraded(): Promise<void> {
    if (migrationComplete) return;
    if (migrationPromise) return migrationPromise;

    migrationPromise = (async () => {
        const version = await db.settings.get('aiModelDefaultVersion');
        if (version?.value === TEXT_MODEL_MIGRATION_VERSION) {
            migrationComplete = true;
            return;
        }

        const provider = await db.settings.get('aiProvider');
        const effectiveProvider = provider?.value || 'ollama';

        if (effectiveProvider !== 'ollama') return;

        await Promise.all([
            migrateSettingIfNeeded('aiModel_clinical', DEFAULT_TEXT_MODEL),
            migrateSettingIfNeeded('aiModel_reasoning', DEFAULT_TEXT_MODEL),
            migrateSettingIfNeeded('aiModel', DEFAULT_TEXT_MODEL),
        ]);

        await db.settings.put({
            key: 'aiModelDefaultVersion',
            value: TEXT_MODEL_MIGRATION_VERSION,
        });
        migrationComplete = true;
    })().finally(() => {
        migrationPromise = null;
    });

    return migrationPromise;
}
