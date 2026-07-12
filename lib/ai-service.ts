import { db } from '@/lib/db';
import { DEFAULT_OCR_MODEL, ensureTextModelDefaultsUpgraded, resolveTextModel } from '@/lib/ai-models';
import {
    DEFAULT_OLLAMA_BASE_URL,
    resolveOllamaBaseUrl,
} from '@/lib/ai-providers/base-url';
import { OllamaProviderAdapter } from '@/lib/ai-providers/ollama';
import type {
    AIChatOptions,
    AIModel,
    AIProvider,
    AIStats,
    ChatMessage,
    ChatMessageContent,
    ProviderAdapter,
} from '@/lib/ai-providers/provider';

export type {
    AIChatOptions,
    AIModel,
    AIProvider,
    AIStats,
    ChatMessage,
    ChatMessageContent,
    ProviderAdapter,
} from '@/lib/ai-providers/provider';

const TEXT_CHAT_TIMEOUT_MS = 300_000;
const OCR_CHAT_TIMEOUT_MS = 180_000;

/* @Codex */
export class AIService {
    public provider: AIProvider;
    private readonly adapter: ProviderAdapter;
    private readonly baseUrl: string;
    private readonly model: string;

    constructor(provider: AIProvider, baseUrl: string, model: string, disableThinking = false, chatTimeoutMs = TEXT_CHAT_TIMEOUT_MS) {
        this.provider = provider;

        const adapter = new OllamaProviderAdapter({
            baseUrl,
            model,
            disableThinking,
            chatTimeoutMs,
        });
        this.adapter = adapter;
        this.baseUrl = adapter.getBaseUrl();
        this.model = adapter.getModel();
    }

    static fromOllama(baseUrl: string, model: string, disableThinking = false, chatTimeoutMs = TEXT_CHAT_TIMEOUT_MS): AIService {
        return new AIService('ollama', baseUrl, model, disableThinking, chatTimeoutMs);
    }

    getModelInfo() {
        return {
            provider: this.provider,
            model: this.model,
            baseUrl: this.baseUrl,
        };
    }

    static async create(task: 'clinical' | 'reasoning' | 'ocr' = 'clinical'): Promise<AIService> {
        const provider: AIProvider = 'ollama';
        await ensureTextModelDefaultsUpgraded();

        const genericUrl = await db.settings.get('aiUrl');
        const legacyUrl = await db.settings.get('ollamaUrl');
        const baseUrl = resolveOllamaBaseUrl(genericUrl?.value, legacyUrl?.value, DEFAULT_OLLAMA_BASE_URL);

        const modelClinical = await db.settings.get('aiModel_clinical');
        const modelReasoning = await db.settings.get('aiModel_reasoning');
        const modelOcr = await db.settings.get('aiModel_ocr');
        const modelLegacy = await db.settings.get('aiModel');

        let model = '';
        if (task === 'clinical') {
            model = resolveTextModel(modelClinical?.value, modelLegacy?.value);
        } else if (task === 'ocr') {
            model = modelOcr?.value || DEFAULT_OCR_MODEL;
        } else {
            model = resolveTextModel(modelReasoning?.value, modelLegacy?.value);
        }

        console.log(`[AIService] Initialized for task '${task}' with model: ${model} (${provider})`);

        const disableThinking = task !== 'ocr';
        const chatTimeoutMs = task === 'ocr' ? OCR_CHAT_TIMEOUT_MS : TEXT_CHAT_TIMEOUT_MS;
        return AIService.fromOllama(baseUrl, model, disableThinking, chatTimeoutMs);
    }

    async chat(messages: ChatMessage[], signal?: AbortSignal, maxTokens?: number, options?: AIChatOptions): Promise<{ content: string; stats: AIStats }> {
        return this.adapter.chat(messages, signal, maxTokens, options);
    }

    async generate(prompt: string, signal?: AbortSignal, maxTokens?: number): Promise<string> {
        const result = await this.chat([{ role: 'user', content: prompt }], signal, maxTokens);
        return result.content;
    }

    async getHealth(): Promise<{ status: 'ok' | 'error'; message: string; models: string[] }> {
        try {
            const models = await this.listModels();
            return { status: 'ok', message: `${this.provider.toUpperCase()} Ready`, models: models.map((model) => model.name) };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Unknown error';
            return { status: 'error', message: `Connessione fallita: ${message}`, models: [] };
        }
    }

    async ping(): Promise<boolean> {
        const health = await this.getHealth();
        return health.status === 'ok';
    }

    async listModels(): Promise<AIModel[]> {
        return this.adapter.listModels();
    }

    async pullModel(modelName: string, onProgress?: (status: string, progress: number) => void): Promise<void> {
        if (!this.adapter.pullModel) throw new Error('Pulling models only supported for Ollama');
        return this.adapter.pullModel(modelName, onProgress);
    }
}
