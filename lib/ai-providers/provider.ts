/* @Codex */
export type AIProvider = 'ollama';

export type AiLane =
    | 'patient_insight'
    | 'smart_import'
    | 'document_synthesis'
    | 'ocr'
    | 'treatment_reasoning';

export type AuthorityPlane = 'clinical_application' | 'engineering_operator';

export interface AIStats {
    latency: number;
    tokensIn: number;
    tokensOut: number;
}

export interface AIChatOptions {
    responseFormat?: 'json';
    numCtx?: number;
}

export interface ChatMessage {
    role: string;
    content: string | ChatMessageContent[];
}

export interface ChatMessageContent {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
}

export interface AIModel {
    name: string;
    size: number;
    details: Record<string, unknown>;
}

export interface ProviderAdapter {
    readonly id: string;
    readonly kind: 'local' | 'lan' | 'cloud';
    readonly capabilities: {
        vision: boolean;
        jsonMode: boolean;
        pull: boolean;
        thinkingToggle: boolean;
    };
    getBaseUrl(): string;
    getModel(): string;
    chat(
        messages: ChatMessage[],
        signal?: AbortSignal,
        maxTokens?: number,
        options?: AIChatOptions,
    ): Promise<{ content: string; stats: AIStats }>;
    listModels(): Promise<AIModel[]>;
    pullModel?(modelName: string, onProgress?: (status: string, progress: number) => void): Promise<void>;
}
