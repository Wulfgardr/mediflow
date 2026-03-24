/* @Codex */
export const UI_STYLE_SETTING_KEY = 'uiStyleMode';
/* @Codex */
export const UI_STYLE_STORAGE_KEY = 'mediflow-ui-style';
/* @Codex */
export const UI_STYLE_MODES = ['clinical', 'liquid'] as const;

/* @Codex */
export type UIStyleMode = (typeof UI_STYLE_MODES)[number];

/* @Codex */
export function isUIStyleMode(value: unknown): value is UIStyleMode {
    return typeof value === 'string' && (UI_STYLE_MODES as readonly string[]).includes(value);
}

/* @Codex */
export function normalizeUIStyleMode(value: unknown, fallback: UIStyleMode = 'clinical'): UIStyleMode {
    return isUIStyleMode(value) ? value : fallback;
}
