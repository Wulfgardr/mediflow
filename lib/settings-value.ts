/* @Codex */
export function normalizeSettingValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}
