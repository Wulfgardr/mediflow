/* @Codex */
export const UI_REDUCE_MOTION_SETTING_KEY = 'uiReduceMotion';
/* @Codex */
export const UI_REDUCE_TRANSPARENCY_SETTING_KEY = 'uiReduceTransparency';
/* @Codex */
export const UI_REDUCE_MOTION_STORAGE_KEY = 'mediflow-ui-reduce-motion';
/* @Codex */
export const UI_REDUCE_TRANSPARENCY_STORAGE_KEY = 'mediflow-ui-reduce-transparency';

/* @Codex */
export function normalizeAccessibilityPreference(value: unknown, fallback = false): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return fallback;
}
