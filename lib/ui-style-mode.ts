export const UI_STYLE_SETTING_KEY = 'uiStyleMode';
export const UI_STYLE_STORAGE_KEY = 'mediflow-ui-style';
/* redesign is the only official runtime; legacy modes have been retired */
export const UI_STYLE_MODES = ['redesign'] as const;

export type UIStyleMode = (typeof UI_STYLE_MODES)[number];

export function isUIStyleMode(value: unknown): value is UIStyleMode {
    return value === 'redesign';
}

export function normalizeUIStyleMode(_value: unknown, fallback: UIStyleMode = 'redesign'): UIStyleMode {
    return fallback;
}
