// DEPRECATED: This file is no longer used.
// Please use @/lib/ai-service.ts instead.

import OpenAI from 'openai';

export const DEFAULT_MODEL = "qwen2.5:32b";

export async function getAiEngine(): Promise<OpenAI> {
    throw new Error("Legacy AI Engine is deprecated. Use AIService.");
}

export async function getConfiguredModelName(): Promise<string> {
    return DEFAULT_MODEL;
}
