'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/db';
import {
    DEFAULT_OCR_MODEL,
    DEFAULT_TEXT_MODEL,
    ensureTextModelDefaultsUpgraded,
    resolveTextModel,
} from '@/lib/ai-models';
import {
    AI_INSIGHT_MODE_OPTIONS,
    DEFAULT_AI_INSIGHT_MANUAL_CONFIG,
    loadAIInsightStoredSettings,
    saveAIInsightStoredSettings,
    type AIInsightManualConfig,
    type AIInsightMode,
} from '@/lib/ai-insight-settings';
import {
    AI_PATIENT_INSIGHT_KILL_SWITCH_KEY,
    isAiPatientInsightEnabledValue,
    serializeAiPatientInsightKillSwitchState,
} from '@/lib/ai-patient-insight-kill-switch';
import {
    AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
    isAiDocumentSynthesisEnabledValue,
    serializeAiDocumentSynthesisKillSwitchState,
} from '@/lib/ai-document-synthesis-kill-switch';
import {
    AI_SMART_IMPORT_KILL_SWITCH_KEY,
    isAiSmartImportEnabledValue,
    serializeAiSmartImportKillSwitchState,
} from '@/lib/ai-smart-import-kill-switch';

type HardwareProfile = 'low' | 'medium' | 'high' | 'custom';

type AIConfigState = {
    provider: string;
    model_clinical: string;
    model_reasoning: string;
    model_ocr: string;
    url: string;
};

type AIHealthState = {
    status: 'ok' | 'error';
    message: string;
    models: string[];
};

/* @Codex */
export function useAiSettingsController() {
    const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile>('custom');
    const [aiConfig, setAiConfig] = useState<AIConfigState>({
        provider: 'ollama',
        model_clinical: '',
        model_reasoning: '',
        model_ocr: '',
        url: '',
    });
    const [aiInsightSettings, setAiInsightSettings] = useState<{
        mode: AIInsightMode;
        manualConfig: AIInsightManualConfig;
    }>({
        mode: 'full_auto',
        manualConfig: { ...DEFAULT_AI_INSIGHT_MANUAL_CONFIG },
    });
    const [isSavingAi, setIsSavingAi] = useState(false);
    const [aiTestStatus, setAiTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [aiHealth, setAiHealth] = useState<AIHealthState | null>(null);
    const [patientInsightEnabled, setPatientInsightEnabled] = useState(true);
    const [documentSynthesisEnabled, setDocumentSynthesisEnabled] = useState(true);
    const [smartImportEnabled, setSmartImportEnabled] = useState(true);

    useEffect(() => {
        void loadAiConfig();
    }, []);

    useEffect(() => {
        const checkOllama = async () => {
            try {
                // Placeholder for future lightweight health check
            } catch { }
        };
        void checkOllama();
    }, []);

    const loadAiConfig = async () => {
        try {
            await ensureTextModelDefaultsUpgraded();
            const safeGet = async (key: string) => {
                try {
                    return await db.settings.get(key);
                } catch {
                    return undefined;
                }
            };

            const hardware = await safeGet('hardwareProfile');
            const modelClinical = await safeGet('aiModel_clinical');
            const modelReasoning = await safeGet('aiModel_reasoning');
            const modelOcr = await safeGet('aiModel_ocr');
            const legacyModel = await safeGet('aiModel');
            const genericUrl = await safeGet('aiUrl');
            const legacyUrl = await safeGet('ollamaUrl');
            const patientInsightKillSwitch = await safeGet(AI_PATIENT_INSIGHT_KILL_SWITCH_KEY);
            const documentSynthesisKillSwitch = await safeGet(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY);
            const smartImportKillSwitch = await safeGet(AI_SMART_IMPORT_KILL_SWITCH_KEY);

            let currentUrl = genericUrl?.value;
            if (!currentUrl) currentUrl = legacyUrl?.value;
            if (!currentUrl || currentUrl.includes(':8080')) currentUrl = 'http://127.0.0.1:11434/v1';

            const insightSettings = await loadAIInsightStoredSettings();
            setHardwareProfile((hardware?.value as HardwareProfile) || 'custom');
            setAiConfig({
                provider: 'ollama',
                model_clinical: resolveTextModel(modelClinical?.value, legacyModel?.value),
                model_reasoning: resolveTextModel(modelReasoning?.value, legacyModel?.value),
                model_ocr: modelOcr?.value || DEFAULT_OCR_MODEL,
                url: currentUrl,
            });
            setAiInsightSettings({
                mode: insightSettings.mode,
                manualConfig: insightSettings.manualConfig,
            });
            setPatientInsightEnabled(isAiPatientInsightEnabledValue(patientInsightKillSwitch?.value));
            setDocumentSynthesisEnabled(isAiDocumentSynthesisEnabledValue(documentSynthesisKillSwitch?.value));
            setSmartImportEnabled(isAiSmartImportEnabledValue(smartImportKillSwitch?.value));
        } catch (e) {
            console.error('Failed to load AI config:', e);
        }
    };

    const applyHardwareProfile = (profile: Exclude<HardwareProfile, 'custom'>) => {
        setHardwareProfile(profile);
        if (profile === 'low') {
            setAiConfig((prev) => ({
                ...prev,
                model_clinical: 'qwen2.5:7b',
                model_reasoning: 'qwen2.5:7b',
            }));
        } else if (profile === 'medium') {
            setAiConfig((prev) => ({
                ...prev,
                model_clinical: 'qwen2.5:14b',
                model_reasoning: 'qwen2.5:14b',
            }));
        } else if (profile === 'high') {
            setAiConfig((prev) => ({
                ...prev,
                model_clinical: DEFAULT_TEXT_MODEL,
                model_reasoning: DEFAULT_TEXT_MODEL,
            }));
        }
    };

    const updateManualInsightConfig = (key: keyof AIInsightManualConfig, value: number) => {
        setAiInsightSettings((prev) => ({
            ...prev,
            manualConfig: {
                ...prev.manualConfig,
                [key]: Number.isFinite(value) ? value : prev.manualConfig[key],
            },
        }));
    };

    const saveAiConfig = async () => {
        setIsSavingAi(true);
        try {
            await db.settings.put({ key: 'hardwareProfile', value: hardwareProfile });
            await db.settings.put({ key: 'aiModel_clinical', value: aiConfig.model_clinical });
            await db.settings.put({ key: 'aiModel_reasoning', value: aiConfig.model_reasoning });
            await db.settings.put({ key: 'aiModel_ocr', value: aiConfig.model_ocr });
            await db.settings.put({ key: 'aiModel', value: aiConfig.model_clinical });
            await db.settings.put({ key: 'aiUrl', value: aiConfig.url });
            await db.settings.put({ key: 'ollamaUrl', value: aiConfig.url });
            await db.settings.put({
                key: AI_PATIENT_INSIGHT_KILL_SWITCH_KEY,
                value: serializeAiPatientInsightKillSwitchState(patientInsightEnabled),
            });
            await db.settings.put({
                key: AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
                value: serializeAiDocumentSynthesisKillSwitchState(documentSynthesisEnabled),
            });
            await db.settings.put({
                key: AI_SMART_IMPORT_KILL_SWITCH_KEY,
                value: serializeAiSmartImportKillSwitchState(smartImportEnabled),
            });
            await saveAIInsightStoredSettings(aiInsightSettings);
            setAiTestStatus('idle');
        } catch (e) {
            console.error(e);
            alert('Errore salvataggio.');
        } finally {
            setIsSavingAi(false);
        }
    };

    const testAiConnection = async () => {
        setAiTestStatus('testing');
        setAiHealth(null);
        try {
            const { AIService } = await import('@/lib/ai-service');
            const service = new AIService('ollama', aiConfig.url, aiConfig.model_clinical);

            const timeoutPromise = new Promise<{ status: string; message?: string; models?: unknown[] }>((_, reject) =>
                setTimeout(() => reject(new Error('Timeout connessione (60s) - Il modello potrebbe richiedere tempo per caricarsi')), 60000),
            );

            const health = await Promise.race([
                service.getHealth(),
                timeoutPromise,
            ]);

            const installedModels = (health.models as string[]) || [];
            const missingModels: string[] = [];

            const isMissing = (target: string) => {
                if (!target) return false;
                return !installedModels.some((model) => model === target || model.startsWith(`${target}:`));
            };

            if (isMissing(aiConfig.model_clinical)) missingModels.push(aiConfig.model_clinical);
            if (isMissing(aiConfig.model_reasoning)) missingModels.push(aiConfig.model_reasoning);
            if (isMissing(aiConfig.model_ocr)) missingModels.push(aiConfig.model_ocr);

            if (missingModels.length > 0) {
                setAiHealth({
                    status: 'error',
                    message: `Ollama è attivo, ma mancano i modelli configurati: ${missingModels.join(', ')}. Scaricali utilizzando i pulsanti sopra.`,
                    models: installedModels,
                });
                setAiTestStatus('error');
                return;
            }

            setAiHealth({
                ...health,
                status: health.status as 'ok' | 'error',
                message: health.message || '',
                models: installedModels,
            });
            setAiTestStatus(health.status === 'ok' ? 'success' : 'error');
        } catch (e) {
            console.error(e);
            setAiTestStatus('error');
            setAiHealth({
                status: 'error',
                message: e instanceof Error ? e.message : 'Errore imprevisto',
                models: [],
            });
        }
    };

    const selectedInsightMode =
        AI_INSIGHT_MODE_OPTIONS.find((option) => option.value === aiInsightSettings.mode) ?? AI_INSIGHT_MODE_OPTIONS[0];

    const insightRuntimePreview = aiInsightSettings.mode === 'manual'
        ? `${aiInsightSettings.manualConfig.outputMaxTokens} token`
        : aiInsightSettings.mode === 'balanced'
            ? 'Preset bilanciato'
            : aiInsightSettings.mode === 'complete'
                ? 'Preset completo'
                : 'Dinamico per caso';

    return {
        hardwareProfile,
        aiConfig,
        setAiConfig,
        aiInsightSettings,
        setAiInsightSettings,
        isSavingAi,
        aiTestStatus,
        aiHealth,
        patientInsightEnabled,
        setPatientInsightEnabled,
        documentSynthesisEnabled,
        setDocumentSynthesisEnabled,
        smartImportEnabled,
        setSmartImportEnabled,
        selectedInsightMode,
        insightRuntimePreview,
        applyHardwareProfile,
        updateManualInsightConfig,
        saveAiConfig,
        testAiConnection,
    };
}
