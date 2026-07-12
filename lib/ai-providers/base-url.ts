/* @Codex */
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export function normalizeOllamaBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/v1?\/?$/, '').replace(/\/$/, '');
}

export function resolveOllamaBaseUrl(
    genericUrl?: string | null,
    legacyUrl?: string | null,
    defaultUrl = DEFAULT_OLLAMA_BASE_URL,
): string {
    let baseUrl = genericUrl || legacyUrl || defaultUrl;

    if (baseUrl.includes(':8080')) {
        baseUrl = legacyUrl || defaultUrl;
    }

    return normalizeOllamaBaseUrl(baseUrl);
}

// TODO(provider-slice-2): sostituire le copie in lib/hooks/use-ai-settings-controller.ts
// e lib/network-ai-runtime.ts con queste funzioni, senza cambiare le rispettive superfici settings.
