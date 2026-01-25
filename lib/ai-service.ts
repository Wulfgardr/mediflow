import { db } from '@/lib/db';

export type AIProvider = 'ollama' | 'mlx';

export interface AIStats {
    latency: number;
    tokensIn: number;
    tokensOut: number;
}

export interface ChatMessage {
    role: string;
    content: string;
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

    static async create(): Promise<AIService> {
        const providerSetting = await db.settings.get('aiProvider');
        const urlSetting = await db.settings.get('aiUrl'); // Generalized setting name? Or keep separate?
        // Let's keep separate logic or try to migrate.
        // For simplicity, let's read distinct keys for now to avoid migration headache, 
        // OR better: use one key 'aiUrl' but fallback to 'ollamaUrl' if missing.

        const provider = (providerSetting?.value as AIProvider) || 'ollama';

        let defaultUrl = "http://127.0.0.1:11434";
        if (provider === 'mlx') defaultUrl = "http://127.0.0.1:8080";

        // Try reading generic 'aiUrl' first, then 'ollamaUrl' as fallback
        const genericUrl = await db.settings.get('aiUrl');
        const legacyUrl = await db.settings.get('ollamaUrl');

        // Logic: if generic set, use it. If not, if ollama provider, use legacy. Else default.
        let url = genericUrl?.value;
        if (!url && provider === 'ollama') url = legacyUrl?.value;

        // IMPORTANT: If MLX is selected but no URL saved, default to port 8080.
        // If URL IS saved (e.g. user saved "http://localhost:8080"), use that.
        // IMPORTANT: If URL is missing, default to Ollama (Plan A) unless explicitly MLX
        if (!url) {
            url = defaultUrl;
        }

        const modelSetting = await db.settings.get('aiModel');
        const model = modelSetting?.value || (provider === 'mlx' ? "mlx-community/MedGemma-2-9b-IT-4bit" : "medgemma");

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
            // formatted options for OpenAI / MLX
            temperature: 0.4,
            max_tokens: maxTokens || 4096
        };

        // Target Endpoint: /v1/chat/completions (Standard for Ollama and MLX)
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

        } catch (e: any) {
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
            await this.chat([{ role: 'user', content: 'ping' }]);
            return { status: 'ok', message: `${this.provider.toUpperCase()} Ready`, models: [] };
        } catch (e: any) {
            return { status: 'error', message: `Connessione fallita: ${e.message}`, models: [] };
        }
    }

    async ping(): Promise<boolean> {
        const health = await this.getHealth();
        return health.status === 'ok';
    }
}
