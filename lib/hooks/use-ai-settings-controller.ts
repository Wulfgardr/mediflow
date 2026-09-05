'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/db';
import { useToast } from '@/components/ui/toast-provider';
import {
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
import {
    AI_TREATMENT_REASONING_KILL_SWITCH_KEY,
    isAiTreatmentReasoningEnabledValue,
    serializeAiTreatmentReasoningKillSwitchState,
} from '@/lib/ai-treatment-reasoning-kill-switch';
import {
    DEFAULT_DOCUMENT_ROUTER_CONTROL_FLOW_MODE,
    DOCUMENT_ROUTER_CONTROL_FLOW_SETTING_KEY,
    parseDocumentRouterControlFlowMode,
    type DocumentRouterControlFlowMode,
} from '@/lib/domain/documents/document-router-control-flow';

type HardwareProfile = 'low' | 'medium' | 'high' | 'custom';

type AIConfigState = {
    provider: string;
    model_clinical: string;
    model_reasoning: string;
    url: string;
};

type AIHealthState = {
    status: 'ok' | 'error';
    message: string;
    models: string[];
};

/* @Codex */
export function useAiSettingsController() {
    const { showToast } = useToast();
    const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile>('custom');
    const [aiConfig, setAiConfig] = useState<AIConfigState>({
        provider: 'ollama',
        model_clinical: '',
        model_reasoning: '',
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
    const [treatmentReasoningEnabled, setTreatmentReasoningEnabled] = useState(false);
    const [documentRouterControlFlowMode, setDocumentRouterControlFlowMode] = useState<DocumentRouterControlFlowMode>(
        DEFAULT_DOCUMENT_ROUTER_CONTROL_FLOW_MODE,
    );

    useEffect(() => {
        const checkOllama = async () => {
            try {
                // Placeholder for future lightweight health check
            } catch { }
        };
        void checkOllama();
    }, []);

    async function loadAiConfig() {
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
            const legacyModel = await safeGet('aiModel');
            const genericUrl = await safeGet('aiUrl');
            const legacyUrl = await safeGet('ollamaUrl');
            const patientInsightKillSwitch = await safeGet(AI_PATIENT_INSIGHT_KILL_SWITCH_KEY);
            const documentSynthesisKillSwitch = await safeGet(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY);
            const smartImportKillSwitch = await safeGet(AI_SMART_IMPORT_KILL_SWITCH_KEY);
            const treatmentReasoningKillSwitch = await safeGet(AI_TREATMENT_REASONING_KILL_SWITCH_KEY);
            const documentRouterControlFlow = await safeGet(DOCUMENT_ROUTER_CONTROL_FLOW_SETTING_KEY);

            let currentUrl = genericUrl?.value;
            if (!currentUrl) currentUrl = legacyUrl?.value;
            if (!currentUrl || currentUrl.includes(':8080')) currentUrl = 'http://127.0.0.1:11434/v1';

            const insightSettings = await loadAIInsightStoredSettings();
            setHardwareProfile((hardware?.value as HardwareProfile) || 'custom');
            setAiConfig({
                provider: 'ollama',
                model_clinical: resolveTextModel(modelClinical?.value, legacyModel?.value),
                model_reasoning: resolveTextModel(modelReasoning?.value, legacyModel?.value),
                url: currentUrl,
            });
            setAiInsightSettings({
                mode: insightSettings.mode,
                manualConfig: insightSettings.manualConfig,
            });
            setPatientInsightEnabled(isAiPatientInsightEnabledValue(patientInsightKillSwitch?.value));
            setDocumentSynthesisEnabled(isAiDocumentSynthesisEnabledValue(documentSynthesisKillSwitch?.value));
            setSmartImportEnabled(isAiSmartImportEnabledValue(smartImportKillSwitch?.value));
            setTreatmentReasoningEnabled(isAiTreatmentReasoningEnabledValue(treatmentReasoningKillSwitch?.value));
            setDocumentRouterControlFlowMode(parseDocumentRouterControlFlowMode(documentRouterControlFlow?.value));
        } catch (e) {
            console.error('Failed to load AI config:', e);
        }
    }

    useEffect(() => {
        void loadAiConfig();
    }, []);

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
            await db.settings.put({ key: 'aiModel', value: aiConfig.model_clinical });
            await db.settings.put({ key: 'aiUrl', value: aiConfig.url });
            await db.settings.put({ key: 'ollamaUrl', value: aiConfig.url });
            await db.settings.put({
                key: DOCUMENT_ROUTER_CONTROL_FLOW_SETTING_KEY,
                value: documentRouterControlFlowMode,
            });
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
            await db.settings.put({
                key: AI_TREATMENT_REASONING_KILL_SWITCH_KEY,
                value: serializeAiTreatmentReasoningKillSwitchState(treatmentReasoningEnabled),
            });
            await saveAIInsightStoredSettings(aiInsightSettings);
            setAiTestStatus('idle');
            showToast({ tone: 'success', title: 'Configurazione AI salvata' });
        } catch (e) {
            console.error(e);
            showToast({ tone: 'error', title: 'Salvataggio non riuscito' });
        } finally {
            setIsSavingAi(false);
        }
    };

    const testAiConnection = async () => {
        setAiTestStatus('testing');
        setAiHealth(null);
        try {
            const { AIService } = await import('@/lib/ai-service');
            const service = AIService.fromLocalTaskConfig(
                'clinical',
                aiConfig.url,
                { clinical: aiConfig.model_clinical },
                aiConfig.provider,
            );

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
        treatmentReasoningEnabled,
        setTreatmentReasoningEnabled,
        documentRouterControlFlowMode,
        setDocumentRouterControlFlowMode,
        selectedInsightMode,
        insightRuntimePreview,
        applyHardwareProfile,
        updateManualInsightConfig,
        saveAiConfig,
        testAiConnection,
    };
}
