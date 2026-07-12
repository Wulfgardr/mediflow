import {
    type AIChatOptions,
    type AIModel,
    type AIStats,
    type ChatMessage,
    type ProviderAdapter,
} from './provider';
import { normalizeOllamaBaseUrl } from './base-url';

/* @Codex */
const MODEL_KEEP_ALIVE = '30m';

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
        keep_alive: MODEL_KEEP_ALIVE,
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
        pull: true,
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
        const endpoint = this.isBrowserRuntime()
            ? '/api/proxy/ollama/chat'
            : `${this.baseUrl}/api/chat`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.isBrowserRuntime()) {
            headers['x-target-url'] = this.baseUrl;
        }

        const timeoutSignal = AbortSignal.timeout(this.chatTimeoutMs);
        const effectiveSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(buildOllamaChatPayload(
                    this.model,
                    messages,
                    maxTokens,
                    options,
                    this.disableThinking,
                )),
                signal: effectiveSignal,
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`AI Provider Error (${response.status}): ${errText}`);
            }

            const data = await response.json();
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
        const targetUrl = this.baseUrl;
        try {
            const response = await fetch(
                this.isBrowserRuntime() ? '/api/ai/models' : `${targetUrl}/api/tags`,
                this.isBrowserRuntime()
                    ? { headers: { 'x-target-url': targetUrl } }
                    : undefined,
            );
            if (!response.ok) throw new Error('Failed to fetch models');
            const data = await response.json();
            return data.models || [];
        } catch (e) {
            console.error('List Models Error:', e);
            throw e;
        }
    }

    async pullModel(modelName: string, onProgress?: (status: string, progress: number) => void): Promise<void> {
        const targetUrl = this.baseUrl;
        const response = await fetch(this.isBrowserRuntime() ? '/api/ai/pull' : `${targetUrl}/api/pull`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.isBrowserRuntime() ? { 'x-target-url': targetUrl } : {}),
            },
            body: JSON.stringify({ model: modelName }),
        });

        if (!response.ok || !response.body) {
            throw new Error('Failed to start model pull');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        let percent = 0;
                        if (data.total && data.completed) {
                            percent = Math.round((data.completed / data.total) * 100);
                        }

                        if (onProgress) {
                            onProgress(data.status, percent);
                        }

                        if (data.error) throw new Error(data.error);
                    } catch (e) {
                        console.warn('Parse error chunk', e);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}
