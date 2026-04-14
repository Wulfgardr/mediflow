import { db } from '@/lib/db';
import { DEFAULT_OCR_MODEL, ensureTextModelDefaultsUpgraded, resolveTextModel } from '@/lib/ai-models';

export type AIProvider = 'ollama';

export interface AIStats {
    latency: number;
    tokensIn: number;
    tokensOut: number;
}

export interface ChatMessage {
    role: string;
    content: string | ChatMessageContent[];
}

// Multimodal content support (for vision models like DeepSeek-OCR)
export interface ChatMessageContent {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string }; // base64 data URL or http URL
}

function normalizeOllamaImage(url: string): string {
    if (url.startsWith('data:')) {
        const [, data] = url.split(',', 2);
        return data || url;
    }
    return url;
}

function toOllamaMessages(messages: ChatMessage[]) {
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
            ...(images.length > 0 ? { images } : {})
        };
    });
}

export class AIService {
    public provider: AIProvider;
    private baseUrl: string;
    private model: string;
    private disableThinking: boolean;

    constructor(provider: AIProvider, baseUrl: string, model: string, disableThinking = false) {
        // Clean URL: Handle /v1, /v (typo), and trailing slash
        this.baseUrl = baseUrl.replace(/\/v1?\/?$/, '').replace(/\/$/, '');
        this.provider = provider;
        this.model = model;
        this.disableThinking = disableThinking;
    }

    /* @Codex */
    getModelInfo() {
        return {
            provider: this.provider,
            model: this.model,
            baseUrl: this.baseUrl
        };
    }

    /* @Codex */
    private isBrowserRuntime(): boolean {
        return typeof window !== 'undefined';
    }

    static async create(task: 'clinical' | 'reasoning' | 'ocr' = 'clinical'): Promise<AIService> {
        /* @Codex */
        const provider: AIProvider = 'ollama';
        await ensureTextModelDefaultsUpgraded();

        const defaultUrl = "http://127.0.0.1:11434";

        // Try reading generic 'aiUrl' first, then 'ollamaUrl' as fallback
        const genericUrl = await db.settings.get('aiUrl');
        const legacyUrl = await db.settings.get('ollamaUrl');

        let url = genericUrl?.value;
        if (!url && provider === 'ollama') url = legacyUrl?.value;
        if (!url) {
            url = defaultUrl;
        }
        /* @Codex */
        if (provider === 'ollama' && url.includes(":8080")) {
            url = legacyUrl?.value || "http://127.0.0.1:11434";
        }

        // --- Task-Based Model Selection ---
        // 1. Try to get specific model for the task
        const modelClinical = await db.settings.get('aiModel_clinical');
        const modelReasoning = await db.settings.get('aiModel_reasoning');
        const modelOcr = await db.settings.get('aiModel_ocr');
        // 2. Fallback to legacy 'aiModel' (which was serving as global previously)
        const modelLegacy = await db.settings.get('aiModel');

        let model = "";

        if (task === 'clinical') {
            model = resolveTextModel(modelClinical?.value, modelLegacy?.value);
        } else if (task === 'ocr') {
            // OCR task: DeepSeek-OCR for document understanding
            model = modelOcr?.value || DEFAULT_OCR_MODEL;
        } else { // reasoning
            model = resolveTextModel(modelReasoning?.value, modelLegacy?.value);
        }

        console.log(`[AIService] Initialized for task '${task}' with model: ${model} (${provider})`);

        return new AIService(provider, url, model, task === 'clinical');
    }

    /**
     * Unified chat entrypoint backed by the native Ollama chat API.
     */
    async chat(messages: ChatMessage[], signal?: AbortSignal, maxTokens?: number): Promise<{ content: string; stats: AIStats }> {
        const start = Date.now();
        const body = {
            model: this.model,
            messages: toOllamaMessages(messages),
            stream: false,
            options: {
                temperature: 0.4,
                num_predict: maxTokens || 4096,
            },
            ...(this.disableThinking ? { think: false } : {}),
        };
        const endpoint = this.isBrowserRuntime()
            ? '/api/proxy/ollama/chat'
            : `${this.baseUrl}/api/chat`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.isBrowserRuntime()) {
            headers['x-target-url'] = this.baseUrl;
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal // Allow cancellation
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`AI Provider Error (${response.status}): ${errText}`);
            }

            const data = await response.json();
            const content = data.message?.content || data.choices?.[0]?.message?.content || "";
            const usage = data.usage || {};
            const tokensIn = data.prompt_eval_count || usage.prompt_tokens || 0;
            const tokensOut = data.eval_count || usage.completion_tokens || 0;

            return {
                content,
                stats: {
                    latency: Date.now() - start,
                    tokensIn,
                    tokensOut,
                }
            };

        } catch (e: unknown) {
            console.error("AI Service Chat Error:", e);
            throw e;
        }
    }

    /**
     * Compatibility wrapper for simple generation
     */
    async generate(prompt: string, signal?: AbortSignal, maxTokens?: number): Promise<string> {
        const messages = [{ role: 'user', content: prompt }];
        const result = await this.chat(messages, signal, maxTokens);
        return result.content;
    }

    async getHealth(): Promise<{ status: 'ok' | 'error'; message: string; models: string[] }> {
        // Simple ping to check connectivity
        try {
            // Hack/Efficiency: use chat with empty/short prompt to test connectivity
            // await this.chat([{ role: 'user', content: 'ping' }]);
            // Better: use the new models endpoint to verify connectivity AND get models
            const models = await this.listModels();
            return { status: 'ok', message: `${this.provider.toUpperCase()} Ready`, models: models.map(m => m.name) };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Unknown error';
            return { status: 'error', message: `Connessione fallita: ${message}`, models: [] };
        }
    }

    async ping(): Promise<boolean> {
        const health = await this.getHealth();
        return health.status === 'ok';
    }

    /**
     * List installed models via API proxy
     */
    async listModels(): Promise<{ name: string; size: number; details: Record<string, unknown> }[]> {
        if (this.provider !== 'ollama') return [];

        const targetUrl = this.baseUrl; // already cleaned
        try {
            const res = await fetch(
                this.isBrowserRuntime() ? '/api/ai/models' : `${targetUrl}/api/tags`,
                this.isBrowserRuntime()
                    ? { headers: { 'x-target-url': targetUrl } }
                    : undefined,
            );
            if (!res.ok) throw new Error("Failed to fetch models");
            const data = await res.json();
            return data.models || [];
        } catch (e) {
            console.error("List Models Error:", e);
            throw e;
        }
    }

    /**
     * Pull a model via API proxy with progress callback
     */
    async pullModel(modelName: string, onProgress?: (status: string, progress: number) => void): Promise<void> {
        if (this.provider !== 'ollama') throw new Error("Pulling models only supported for Ollama");

        const targetUrl = this.baseUrl;

        const response = await fetch(this.isBrowserRuntime() ? '/api/ai/pull' : `${targetUrl}/api/pull`, { // Use proxy in browser, direct Ollama on server
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.isBrowserRuntime() ? { 'x-target-url': targetUrl } : {})
            },
            body: JSON.stringify({ model: modelName })
        });

        if (!response.ok || !response.body) {
            throw new Error("Failed to start model pull");
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

                // Process all complete lines
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);

                        // Calculate percentage if available
                        let percent = 0;
                        if (data.total && data.completed) {
                            percent = Math.round((data.completed / data.total) * 100);
                        }

                        if (onProgress) {
                            onProgress(data.status, percent);
                        }

                        if (data.error) throw new Error(data.error);
                    } catch (e) {
                        // ignore parse errors for partial chunks
                        console.warn("Parse error chunk", e);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}
