import { db } from '@/lib/db';

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

export class AIService {
    public provider: AIProvider;
    private baseUrl: string;
    private model: string;

    constructor(provider: AIProvider, baseUrl: string, model: string) {
        // Clean URL: Handle /v1, /v (typo), and trailing slash
        this.baseUrl = baseUrl.replace(/\/v1?\/?$/, '').replace(/\/$/, '');
        this.provider = provider;
        this.model = model;
    }

    /* @Codex */
    getModelInfo() {
        return {
            provider: this.provider,
            model: this.model,
            baseUrl: this.baseUrl
        };
    }

    static async create(task: 'clinical' | 'reasoning' | 'ocr' = 'clinical'): Promise<AIService> {
        /* @Codex */
        const provider: AIProvider = 'ollama';

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

        // Defaults if DB is empty
        /* @Codex */
        const defaultClinical = "hf.co/unsloth/medgemma-1.5-4b-it-GGUF";
        const defaultOcr = "deepseek-ocr"; // DeepSeek-OCR 3B via Ollama
        /* @Codex */
        const defaultReasoning = "qwen2.5:32b"; // Assuming Qwen is generally available or user will configure

        let model = "";

        if (task === 'clinical') {
            model = modelClinical?.value || modelLegacy?.value || defaultClinical;
        } else if (task === 'ocr') {
            // OCR task: DeepSeek-OCR for document understanding
            model = modelOcr?.value || defaultOcr;
        } else { // reasoning
            model = modelReasoning?.value || defaultReasoning;
            // "Legacy Fallback": If no specific reasoning model is set, check if legacy model is set.
            if (!modelReasoning?.value && modelLegacy?.value) {
                model = modelLegacy.value;
            }
        }

        console.log(`[AIService] Initialized for task '${task}' with model: ${model} (${provider})`);

        return new AIService(provider, url, model);
    }

    /**
     * Unified Chat Completion (OpenAI Compatible)
     * Used for both chat and single-prompt generation (wrapped)
     */
    async chat(messages: ChatMessage[], signal?: AbortSignal, maxTokens?: number): Promise<{ content: string; stats: AIStats }> {
        const start = Date.now();

        // OpenAI Format
        const body = {
            model: this.model,
            messages: messages,
            stream: false,
            // formatted options for OpenAI-compatible providers
            temperature: 0.4,
            max_tokens: maxTokens || 4096
        };

        // Target Endpoint: /v1/chat/completions (OpenAI-compatible)
        // We use our Proxy to forward the request to the correct local URL
        const targetUrl = `${this.baseUrl}/v1/chat/completions`;

        try {
            const response = await fetch('/api/proxy/ai/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-target-url': targetUrl
                },
                body: JSON.stringify(body),
                signal // Allow cancellation
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`AI Provider Error (${response.status}): ${errText}`);
            }

            const data = await response.json();

            // OpenAI format response parsing
            const content = data.choices?.[0]?.message?.content || "";
            const usage = data.usage || {};

            return {
                content,
                stats: {
                    latency: Date.now() - start,
                    tokensIn: usage.prompt_tokens || 0,
                    tokensOut: usage.completion_tokens || 0
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
            const res = await fetch('/api/ai/models', {
                headers: { 'x-target-url': targetUrl }
            });
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

        const response = await fetch('/api/ai/pull', { // Use our new proxy route
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-target-url': targetUrl
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
