/* @Codex */
export const DEFAULT_TEXT_MODEL = 'qwen3.5:35b-a3b';
export const DEFAULT_OCR_MODEL = 'deepseek-ocr';
export const LEGACY_QWEN_TEXT_MODEL = 'qwen2.5:32b';
export const LEGACY_MEDGEMMA_TEXT_MODEL = 'hf.co/unsloth/medgemma-1.5-4b-it-GGUF';

const STALE_TEXT_MODELS: ReadonlySet<string> = new Set([
    LEGACY_QWEN_TEXT_MODEL,
    LEGACY_MEDGEMMA_TEXT_MODEL,
]);

function normalizeModelName(model?: string | null): string | null {
    const value = model?.trim();
    return value ? value : null;
}

export function isStaleTextModel(model: string): boolean {
    return STALE_TEXT_MODELS.has(model);
}

export function resolveTextModel(specificModel?: string | null, legacyModel?: string | null): string {
    const specific = normalizeModelName(specificModel);
    if (specific) return specific;

    const legacy = normalizeModelName(legacyModel);
    if (!legacy || isStaleTextModel(legacy)) {
        return DEFAULT_TEXT_MODEL;
    }

    return legacy;
}
