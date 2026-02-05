/* @Codex */
'use client';

import { db } from '@/lib/db';

export type SummaryStage = 'connect' | 'context' | 'generate' | 'save';

export interface SummaryModelInfo {
    provider: string;
    model: string;
    baseUrl: string;
}

interface SummaryOptions {
    signal?: AbortSignal;
    onStage?: (stage: SummaryStage, info?: SummaryModelInfo) => void;
}

const SUMMARY_PROMPT = `Sei un assistente medico. Analizza questi dati e rispondi in modo COMPLETO ma CONCISO.

FORMATO RICHIESTO:
**Riassunto clinico:** (max 2 righe)

**Punti di attenzione:**
1. [punto 1]
2. [punto 2]
3. [punto 3]

**Prossima mossa:** [azione specifica]

REGOLE IMPORTANTI:
- NON lasciare frasi incomplete o troncate
- Completa sempre ogni frase
- Sii breve ma esaustivo
- Niente introduzioni ("Ecco l'analisi...")

DATI PAZIENTE:
`;

const inflight = new Map<string, Promise<SummaryModelInfo | null>>();

/* @Codex */
export async function getAiModelLabels() {
    const modelClinical = await db.settings.get('aiModel_clinical');
    const legacyModel = await db.settings.get('aiModel');
    const modelOcr = await db.settings.get('aiModel_ocr');

    return {
        clinical: modelClinical?.value || legacyModel?.value || 'hf.co/unsloth/medgemma-1.5-4b-it-GGUF',
        ocr: modelOcr?.value || 'deepseek-ocr'
    };
}

/* @Codex */
export async function regeneratePatientSummary(
    patientId: string,
    options: SummaryOptions = {}
): Promise<SummaryModelInfo | null> {
    if (!patientId) return null;

    if (inflight.has(patientId)) {
        return inflight.get(patientId) ?? null;
    }

    const task = (async () => {
        const { AIService } = await import('@/lib/ai-service');
        const { buildPatientContext } = await import('@/lib/ai-context');

        const ai = await AIService.create('clinical');
        const info = ai.getModelInfo();
        options.onStage?.('connect', info);

        const contextData = await buildPatientContext(patientId);
        options.onStage?.('context', info);

        const prompt = SUMMARY_PROMPT + contextData;

        options.onStage?.('generate', info);
        const content = await ai.generate(prompt, options.signal, 1024);

        const cleaned = cleanAIResponse(content);
        if (!cleaned) {
            throw new Error("L'AI ha generato una risposta vuota o non valida.");
        }

        options.onStage?.('save', info);
        await db.patients.update(patientId, {
            aiSummary: cleaned,
            updatedAt: new Date()
        });

        return info;
    })();

    inflight.set(patientId, task);
    try {
        return await task;
    } finally {
        inflight.delete(patientId);
    }
}

/* @Codex */
function cleanAIResponse(content: string): string {
    let cleanContent = content.replace(/<unused94>[\s\S]*?(<unused95>|$)/, '').trim();
    cleanContent = cleanContent.replace(/^Plan:\s*/i, '');
    cleanContent = cleanContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    if (!cleanContent && content.length > 0) {
        cleanContent = `[⚠️ AI Output Raw]: ${content}`;
    }

    return cleanContent.trim();
}
