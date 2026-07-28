import { db } from '@/lib/db';
import { DEFAULT_OCR_MODEL, ensureTextModelDefaultsUpgraded, resolveTextModel } from '@/lib/ai-models';
import {
    DEFAULT_OLLAMA_BASE_URL,
    resolveOllamaBaseUrl,
} from '@/lib/ai-providers/base-url';
import {
    localProviderRegistry,
    type AIServiceTask,
    type LocalProviderResolution,
} from '@/lib/ai-providers/registry';
import type {
    AIChatOptions,
    AIModel,
    AIProvider,
    AIStats,
    ChatMessage,
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
    private readonly resolution: LocalProviderResolution;

    private constructor(resolution: LocalProviderResolution) {
        this.resolution = resolution;
        this.provider = resolution.receipt.provider;
        this.adapter = resolution.adapter;
        this.baseUrl = resolution.adapter.getBaseUrl();
        this.model = resolution.adapter.getModel();
    }

    static fromLocalTaskConfig(
        task: AIServiceTask,
        endpoint: string,
        models: Partial<Record<AIServiceTask, string>>,
        provider?: string | null,
        disableThinking = false,
        chatTimeoutMs = TEXT_CHAT_TIMEOUT_MS,
    ): AIService {
        return new AIService(localProviderRegistry.resolve({
            task,
            provider,
            endpoint,
            models,
            disableThinking,
            chatTimeoutMs,
        }));
    }

    getModelInfo() {
        return {
            provider: this.provider,
            model: this.model,
            baseUrl: this.baseUrl,
            readiness: this.resolution.receipt.runtimeReadiness,
            fallback: this.resolution.fallback,
            receipt: this.resolution.receipt,
        };
    }

    static async create(task: AIServiceTask = 'clinical'): Promise<AIService> {
        await ensureTextModelDefaultsUpgraded();

        const providerSetting = await db.settings.get('aiProvider');
        const genericUrl = await db.settings.get('aiUrl');
        const legacyUrl = await db.settings.get('ollamaUrl');
        const baseUrl = resolveOllamaBaseUrl(genericUrl?.value, legacyUrl?.value, DEFAULT_OLLAMA_BASE_URL);

        const modelClinical = await db.settings.get('aiModel_clinical');
        const modelReasoning = await db.settings.get('aiModel_reasoning');
        const modelOcr = await db.settings.get('aiModel_ocr');
        const modelLegacy = await db.settings.get('aiModel');

        const models: Record<AIServiceTask, string> = {
            clinical: resolveTextModel(modelClinical?.value, modelLegacy?.value),
            reasoning: resolveTextModel(modelReasoning?.value, modelLegacy?.value),
            ocr: modelOcr?.value || DEFAULT_OCR_MODEL,
        };

        const disableThinking = task !== 'ocr';
        const chatTimeoutMs = task === 'ocr' ? OCR_CHAT_TIMEOUT_MS : TEXT_CHAT_TIMEOUT_MS;
        return AIService.fromLocalTaskConfig(
            task,
            baseUrl,
            models,
            providerSetting?.value,
            disableThinking,
            chatTimeoutMs,
        );
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
        if (!this.adapter.pullModel) throw new Error('Model pull is disabled for this provider binding');
        return this.adapter.pullModel(modelName, onProgress);
    }
}
