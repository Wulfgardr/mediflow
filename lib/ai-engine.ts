import OpenAI from 'openai';

// Confguration for local Ollama instance
// Users should run `ollama pull medgemma` (or their preferred model)
// and ensure `ollama serve` is running.
export const DEFAULT_MODEL = "hf.co/unsloth/medgemma-1.5-4b-it-GGUF";

// We can allow env var override if needed, but for now strict local default
export const OLLAMA_BASE_URL = process.env.NEXT_PUBLIC_OLLAMA_URL || "http://localhost:11434/v1";

let openaiInstance: OpenAI | null = null;

export async function getAiEngine(): Promise<OpenAI> {
    if (openaiInstance) {
        return openaiInstance;
    }

    // Initialize OpenAI client pointing to Ollama
    // browser: true is needed because we are calling this from client components
    // dangeriouslyAllowBrowser: true is required for local dev usage in client components
    const client = new OpenAI({
        baseURL: OLLAMA_BASE_URL,
        apiKey: "ollama", // Required but ignored by Ollama
        dangerouslyAllowBrowser: true
    });

    // Optional: Quick health check
    try {
        await fetch(`${OLLAMA_BASE_URL.replace('/v1', '')}/api/tags`);
    } catch (e) {
        console.error("Ollama connection failed", e);
        throw new Error("Impossibile connettersi a Ollama. Assicurati che 'ollama serve' sia in esecuzione.");
    }

    openaiInstance = client;
    return client;
}
