/* @Codex */
import { db } from '@/lib/db';
import { DEFAULT_TEXT_MODEL, isStaleTextModel } from './ai-model-selection';
export {
    DEFAULT_TEXT_MODEL,
    LEGACY_MEDGEMMA_TEXT_MODEL,
    LEGACY_QWEN_TEXT_MODEL,
    resolveTextModel,
} from './ai-model-selection';

const TEXT_MODEL_MIGRATION_VERSION = 'qwen35-default-v1';

let migrationComplete = false;
let migrationPromise: Promise<void> | null = null;

async function migrateSettingIfNeeded(key: string, nextValue: string): Promise<void> {
    const current = await db.settings.get(key);
    if (!current?.value || !isStaleTextModel(current.value)) return;
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
