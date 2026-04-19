/* @Codex */
export function normalizeOllamaBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/v1\/?$/, '').replace(/\/$/, '');
}
