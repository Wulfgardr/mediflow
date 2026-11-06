import { performance } from 'node:perf_hooks';
import { normalizeOllamaBaseUrl } from './ollama-base-url.ts';

export type LocalChatRuntime = 'ollama_chat';

export type LocalChatTarget = {
    runtime: LocalChatRuntime;
    model: string;
};

export type LocalChatBaseUrls = {
    ollama: string;
};

const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

export function isLocalChatRuntime(value: string): value is LocalChatRuntime {
    return value === 'ollama_chat';
}

export function buildLocalChatTargetKey(target: LocalChatTarget) {
    return `${target.runtime}:${target.model}`;
}


export function resolveLocalChatBaseUrls(options: {
    baseUrl?: string;
    ollamaBaseUrl?: string;
} = {}): LocalChatBaseUrls {
    return {
        ollama: normalizeOllamaBaseUrl(options.ollamaBaseUrl || options.baseUrl || DEFAULT_OLLAMA_BASE_URL),
    };
}

export async function listInstalledLocalChatModels(runtime: LocalChatRuntime, baseUrl: string): Promise<string[]> {
    try {
        if (runtime === 'ollama_chat') {
            const response = await fetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/tags`);
            if (!response.ok) return [];
            const payload = await response.json() as { models?: Array<{ name?: string }> };
            return Array.isArray(payload.models)
                ? payload.models
                    .map((model) => (typeof model?.name === 'string' ? model.name : ''))
                    .filter(Boolean)
                : [];
        }

        return [];
    } catch {
        return [];
    }
}

export async function generateLocalChatCompletion(
    target: LocalChatTarget,
    baseUrls: LocalChatBaseUrls,
    prompt: string,
    maxTokens: number,
    temperature: number,
): Promise<{ content: string; latencyMs: number }> {
    const start = performance.now();

    if (target.runtime === 'ollama_chat') {
        const response = await fetch(`${baseUrls.ollama}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: target.model,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
                think: false,
                options: {
                    temperature,
                    num_predict: maxTokens,
                },
            }),
        });

        const latencyMs = Number((performance.now() - start).toFixed(1));
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const payload = await response.json() as {
            message?: { content?: string };
            choices?: Array<{ message?: { content?: string } }>;
        };

        return {
            content: payload.message?.content || payload.choices?.[0]?.message?.content || '',
            latencyMs,
        };
    }

    throw new Error('Unsupported local chat transport');
}
