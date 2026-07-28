import {
    type AIChatOptions,
    type AIModel,
    type AIStats,
    type ChatMessage,
    type ProviderAdapter,
} from './provider';
import { normalizeOllamaBaseUrl } from './base-url';
import {
    assertLocalOllamaResponse,
    attestLocalOllamaModel,
    isLocalOllamaModelDescriptor,
    OLLAMA_LOCAL_KEEP_ALIVE,
    strictOllamaLoopbackBaseUrl,
} from './ollama-locality';

export interface OllamaProviderAdapterOptions {
    baseUrl: string;
    model: string;
    disableThinking?: boolean;
    chatTimeoutMs: number;
}

function normalizeOllamaImage(url: string): string {
    if (url.startsWith('data:')) {
        const [, data] = url.split(',', 2);
        return data || url;
    }
    return url;
}

export function toOllamaMessages(messages: ChatMessage[]) {
    return messages.map((message) => {
        if (typeof message.content === 'string') {
            return {
                role: message.role,
                content: message.content,
            };
        }

        const textParts: string[] = [];
        const images: string[] = [];

        for (const item of message.content) {
            if (item.type === 'text' && item.text) {
                textParts.push(item.text);
            } else if (item.type === 'image_url' && item.image_url?.url) {
                images.push(normalizeOllamaImage(item.image_url.url));
            }
        }

        return {
            role: message.role,
            content: textParts.join('\n\n').trim(),
            ...(images.length > 0 ? { images } : {}),
        };
    });
}

export function buildOllamaChatPayload(
    model: string,
    messages: ChatMessage[],
    maxTokens?: number,
    options?: AIChatOptions,
    disableThinking = false,
) {
    return {
        model,
        messages: toOllamaMessages(messages),
        stream: false,
        ...(options?.responseFormat === 'json' ? { format: 'json' } : {}),
        keep_alive: OLLAMA_LOCAL_KEEP_ALIVE,
        options: {
            temperature: 0.4,
            num_predict: maxTokens || 4096,
            ...(options?.numCtx ? { num_ctx: options.numCtx } : {}),
        },
        ...(disableThinking ? { think: false } : {}),
    };
}

export class OllamaProviderAdapter implements ProviderAdapter {
    public readonly id = 'ollama';
    public readonly kind = 'local' as const;
    public readonly capabilities = {
        vision: true,
        jsonMode: true,
        pull: false,
        thinkingToggle: true,
    };

    private readonly baseUrl: string;
    private readonly model: string;
    private readonly disableThinking: boolean;
    private readonly chatTimeoutMs: number;

    constructor({ baseUrl, model, disableThinking = false, chatTimeoutMs }: OllamaProviderAdapterOptions) {
        this.baseUrl = normalizeOllamaBaseUrl(baseUrl);
        this.model = model;
        this.disableThinking = disableThinking;
        this.chatTimeoutMs = chatTimeoutMs;
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    getModel(): string {
        return this.model;
    }

    private isBrowserRuntime(): boolean {
        return typeof window !== 'undefined';
    }

    async chat(messages: ChatMessage[], signal?: AbortSignal, maxTokens?: number, options?: AIChatOptions): Promise<{ content: string; stats: AIStats }> {
        const start = Date.now();
        const browserRuntime = this.isBrowserRuntime();
        const providerBaseUrl = browserRuntime
            ? this.baseUrl
            : strictOllamaLoopbackBaseUrl(this.baseUrl);
        const endpoint = browserRuntime
            ? '/api/proxy/ollama/chat'
            : `${providerBaseUrl}/api/chat`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (browserRuntime) {
            headers['x-target-url'] = this.baseUrl;
        }

        const timeoutSignal = AbortSignal.timeout(this.chatTimeoutMs);
        const effectiveSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

        try {
            const attestation = browserRuntime
                ? null
                : await attestLocalOllamaModel(providerBaseUrl, this.model, effectiveSignal);
            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(buildOllamaChatPayload(
                    attestation?.canonicalModel ?? this.model,
                    messages,
                    maxTokens,
                    options,
                    this.disableThinking,
                )),
                signal: effectiveSignal,
                redirect: 'error',
            });

            if (!response.ok) {
                throw new Error(`AI Provider Error (${response.status})`);
            }

            const data = await response.json();
            if (attestation) assertLocalOllamaResponse(data, attestation);
            const content = data.message?.content || data.choices?.[0]?.message?.content || '';
            const usage = data.usage || {};
            const tokensIn = data.prompt_eval_count || usage.prompt_tokens || 0;
            const tokensOut = data.eval_count || usage.completion_tokens || 0;

            return {
                content,
                stats: {
                    latency: Date.now() - start,
                    tokensIn,
                    tokensOut,
                },
            };
        } catch (e: unknown) {
            if (e instanceof DOMException && e.name === 'TimeoutError' && !signal?.aborted) {
                console.error(`AI Service Chat Timeout dopo ${this.chatTimeoutMs} ms`);
                throw new Error(`Timeout del provider AI dopo ${Math.round(this.chatTimeoutMs / 1000)}s. Verifica che il modello sia caricato e riprova.`);
            }
            console.error('AI Service Chat Error:', e);
            throw e;
        }
    }

    async listModels(): Promise<AIModel[]> {
        const browserRuntime = this.isBrowserRuntime();
        const targetUrl = browserRuntime
            ? this.baseUrl
            : strictOllamaLoopbackBaseUrl(this.baseUrl);
        try {
            const response = await fetch(
                browserRuntime ? '/api/ai/models' : `${targetUrl}/api/tags`,
                browserRuntime
                    ? { headers: { 'x-target-url': targetUrl }, redirect: 'error' }
                    : { redirect: 'error' },
            );
            if (!response.ok) throw new Error('Failed to fetch models');
            const data = await response.json();
            const models = Array.isArray(data.models) ? data.models : [];
            return browserRuntime
                ? models
                : models.filter(isLocalOllamaModelDescriptor);
        } catch (e) {
            console.error('List Models Error:', e);
            throw e;
        }
    }

}
