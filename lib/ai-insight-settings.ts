/* @Codex */
export type AIInsightMode = 'full_auto' | 'balanced' | 'complete' | 'manual';

/* @Codex */
export interface AIInsightManualConfig {
    maxDocuments: number;
    maxDocumentSummaryChars: number;
    maxDocumentContextChars: number;
    outputMaxTokens: number;
}

/* @Codex */
export interface AIInsightStoredSettings {
    mode: AIInsightMode;
    manualConfig: AIInsightManualConfig;
    hardwareProfile: 'low' | 'medium' | 'high' | 'custom';
}

/* @Codex */
export interface AIInsightRuntimeSettings extends AIInsightManualConfig {
    mode: AIInsightMode;
    resolvedProfile: 'light' | 'balanced' | 'complete' | 'manual';
}

/* @Codex */
export interface AIInsightComplexityInput {
    diagnoses: number;
    entries: number;
    documents: number;
}

/* @Codex */
export const AI_INSIGHT_MODE_OPTIONS: Array<{
    value: AIInsightMode;
    title: string;
    description: string;
}> = [
    {
        value: 'full_auto',
        title: 'Full auto',
        description: 'Adatta i budget in base a complessita del caso e profilo macchina.',
    },
    {
        value: 'balanced',
        title: 'Bilanciata',
        description: 'Mantiene il comportamento standard, rapido e stabile.',
    },
    {
        value: 'complete',
        title: 'Completa',
        description: 'Allarga il contesto documentale quando serve piu copertura.',
    },
    {
        value: 'manual',
        title: 'Manuale Pro',
        description: 'Espone i budget principali dell insight per un tuning esplicito.',
    },
];

/* @Codex */
export const DEFAULT_AI_INSIGHT_MANUAL_CONFIG: AIInsightManualConfig = {
    maxDocuments: 6,
    maxDocumentSummaryChars: 260,
    maxDocumentContextChars: 2200,
    outputMaxTokens: 512,
};

const LIGHT_AI_INSIGHT_CONFIG: AIInsightManualConfig = {
    maxDocuments: 4,
    maxDocumentSummaryChars: 180,
    maxDocumentContextChars: 1200,
    outputMaxTokens: 384,
};

const COMPLETE_AI_INSIGHT_CONFIG: AIInsightManualConfig = {
    maxDocuments: 8,
    maxDocumentSummaryChars: 320,
    maxDocumentContextChars: 3200,
    outputMaxTokens: 768,
};

const AI_INSIGHT_MODE_KEY = 'aiInsightMode';
const AI_INSIGHT_MANUAL_CONFIG_KEY = 'aiInsightManualConfig';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function coerceNumber(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number.parseInt(value, 10)
            : Number.NaN;
    if (!Number.isFinite(parsed)) return fallback;
    return clamp(Math.round(parsed), min, max);
}

function cloneConfig(config: AIInsightManualConfig): AIInsightManualConfig {
    return { ...config };
}

function parseMode(value: unknown): AIInsightMode {
    if (value === 'balanced' || value === 'complete' || value === 'manual' || value === 'full_auto') {
        return value;
    }

    return 'full_auto';
}

function parseHardwareProfile(value: unknown): AIInsightStoredSettings['hardwareProfile'] {
    if (value === 'low' || value === 'medium' || value === 'high' || value === 'custom') {
        return value;
    }

    return 'custom';
}

function parseManualConfigSetting(value: string | null | undefined): AIInsightManualConfig {
    if (!value) return cloneConfig(DEFAULT_AI_INSIGHT_MANUAL_CONFIG);

    try {
        return sanitizeAIInsightManualConfig(JSON.parse(value));
    } catch {
        return cloneConfig(DEFAULT_AI_INSIGHT_MANUAL_CONFIG);
    }
}

function configForProfile(profile: 'light' | 'balanced' | 'complete'): AIInsightManualConfig {
    if (profile === 'light') return cloneConfig(LIGHT_AI_INSIGHT_CONFIG);
    if (profile === 'complete') return cloneConfig(COMPLETE_AI_INSIGHT_CONFIG);
    return cloneConfig(DEFAULT_AI_INSIGHT_MANUAL_CONFIG);
}

function resolveAutoProfile(
    hardwareProfile: AIInsightStoredSettings['hardwareProfile'],
    patientComplexityScore: number,
): 'light' | 'balanced' | 'complete' {
    if (patientComplexityScore >= 12) return 'complete';
    if (patientComplexityScore <= 3) return 'light';
    if (hardwareProfile === 'low') return 'light';
    if (hardwareProfile === 'high') return 'complete';
    return 'balanced';
}

/* @Codex */
export function sanitizeAIInsightManualConfig(value: unknown): AIInsightManualConfig {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};

    return {
        maxDocuments: coerceNumber(record.maxDocuments, DEFAULT_AI_INSIGHT_MANUAL_CONFIG.maxDocuments, 2, 12),
        maxDocumentSummaryChars: coerceNumber(record.maxDocumentSummaryChars, DEFAULT_AI_INSIGHT_MANUAL_CONFIG.maxDocumentSummaryChars, 120, 480),
        maxDocumentContextChars: coerceNumber(record.maxDocumentContextChars, DEFAULT_AI_INSIGHT_MANUAL_CONFIG.maxDocumentContextChars, 800, 5000),
        outputMaxTokens: coerceNumber(record.outputMaxTokens, DEFAULT_AI_INSIGHT_MANUAL_CONFIG.outputMaxTokens, 256, 1200),
    };
}

/* @Codex */
export function estimateAIInsightComplexityScore(input: AIInsightComplexityInput): number {
    return input.diagnoses + input.entries + (input.documents * 2);
}

/* @Codex */
export function resolveAIInsightRuntimeSettings(input: AIInsightStoredSettings & {
    patientComplexityScore?: number;
}): AIInsightRuntimeSettings {
    if (input.mode === 'manual') {
        return {
            ...sanitizeAIInsightManualConfig(input.manualConfig),
            mode: 'manual',
            resolvedProfile: 'manual',
        };
    }

    if (input.mode === 'balanced') {
        return {
            ...configForProfile('balanced'),
            mode: 'balanced',
            resolvedProfile: 'balanced',
        };
    }

    if (input.mode === 'complete') {
        return {
            ...configForProfile('complete'),
            mode: 'complete',
            resolvedProfile: 'complete',
        };
    }

    const autoProfile = resolveAutoProfile(input.hardwareProfile, input.patientComplexityScore ?? 0);
    return {
        ...configForProfile(autoProfile),
        mode: 'full_auto',
        resolvedProfile: autoProfile,
    };
}

/* @Codex */
export async function loadAIInsightStoredSettings(): Promise<AIInsightStoredSettings> {
    const { db } = await import('./db');
    const [modeSetting, manualConfigSetting, hardwareSetting] = await Promise.all([
        db.settings.get(AI_INSIGHT_MODE_KEY),
        db.settings.get(AI_INSIGHT_MANUAL_CONFIG_KEY),
        db.settings.get('hardwareProfile'),
    ]);

    return {
        mode: parseMode(modeSetting?.value),
        manualConfig: parseManualConfigSetting(manualConfigSetting?.value),
        hardwareProfile: parseHardwareProfile(hardwareSetting?.value),
    };
}

/* @Codex */
export async function getAIInsightRuntimeSettings(options: {
    patientComplexityScore?: number;
} = {}): Promise<AIInsightRuntimeSettings> {
    const stored = await loadAIInsightStoredSettings();
    return resolveAIInsightRuntimeSettings({
        ...stored,
        patientComplexityScore: options.patientComplexityScore,
    });
}

/* @Codex */
export async function saveAIInsightStoredSettings(settings: {
    mode: AIInsightMode;
    manualConfig: AIInsightManualConfig;
}): Promise<void> {
    const { db } = await import('./db');
    const sanitizedManualConfig = sanitizeAIInsightManualConfig(settings.manualConfig);

    await db.settings.put({ key: AI_INSIGHT_MODE_KEY, value: settings.mode });
    await db.settings.put({
        key: AI_INSIGHT_MANUAL_CONFIG_KEY,
        value: JSON.stringify(sanitizedManualConfig),
    });
}
