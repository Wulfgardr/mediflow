export const UI_REDUCE_MOTION_SETTING_KEY = 'uiReduceMotion';
export const UI_REDUCE_TRANSPARENCY_SETTING_KEY = 'uiReduceTransparency';
export const UI_REDUCE_MOTION_STORAGE_KEY = 'mediflow-ui-reduce-motion';
export const UI_REDUCE_TRANSPARENCY_STORAGE_KEY = 'mediflow-ui-reduce-transparency';

export function normalizeAccessibilityPreference(value: unknown, fallback = false): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return fallback;
}
