// DEPRECATED: This file is no longer used.
// Please use @/lib/ai-service.ts instead.

import OpenAI from 'openai';

export const DEFAULT_MODEL = "hf.co/unsloth/medgemma-1.5-4b-it-GGUF";

export async function getAiEngine(): Promise<OpenAI> {
    throw new Error("Legacy AI Engine is deprecated. Use AIService.");
}

export async function getConfiguredModelName(): Promise<string> {
    return DEFAULT_MODEL;
}
