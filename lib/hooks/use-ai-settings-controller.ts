'use client';

import { formatCountLabel } from '../format-count';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isInstalledOllamaModel } from '@/lib/installed-ollama-models';
import { db } from '@/lib/db';
import { AI_CONFIGURATION_KEYS, type AiConfigurationSnapshot } from '@/lib/ai-settings-configuration';
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
    sanitizeAIInsightManualConfig,
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

type AISettingsStore = Pick<typeof db.settings, 'put'>;

/* the ordinary clinical-functions save persists the fixed local binding required by ADR 0136. */
export async function saveLocalOllamaBinding(
    configuration: Pick<AIConfigState, 'model_clinical' | 'model_reasoning' | 'url'>,
    settings: AISettingsStore = db.settings,
) {
    await settings.put({ key: 'aiProvider', value: 'ollama' });
    await settings.put({ key: 'aiModel_clinical', value: configuration.model_clinical });
    await settings.put({ key: 'aiModel_reasoning', value: configuration.model_reasoning });
    await settings.put({ key: 'aiModel', value: configuration.model_clinical });
    await settings.put({ key: 'aiUrl', value: configuration.url });
    await settings.put({ key: 'ollamaUrl', value: configuration.url });
}

type AIHealthState = {
    status: 'ok' | 'error';
    message: string;
    models: string[];
};

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
    const expectedValues = useRef<AiConfigurationSnapshot | null>(null);
    const saving = useRef(false);
    const mounted = useRef(true);
    const [aiSettingsConflict, setAiSettingsConflict] = useState<'conflict' | 'review' | null>(null);
    const [aiSettingsReadback, setAiSettingsReadback] = useState<AiConfigurationSnapshot | null>(null);
    const [savedConfigurationRevision, setSavedConfigurationRevision] = useState(0);
    const [aiSettingsLoadState, setAiSettingsLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
    const [aiTestStatus, setAiTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [aiHealth, setAiHealth] = useState<AIHealthState | null>(null);
    const [patientInsightEnabled, setPatientInsightEnabled] = useState(true);
    const [documentSynthesisEnabled, setDocumentSynthesisEnabled] = useState(true);
    const [smartImportEnabled, setSmartImportEnabled] = useState(true);
    const [treatmentReasoningEnabled, setTreatmentReasoningEnabled] = useState(false);
    const [documentRouterControlFlowMode, setDocumentRouterControlFlowMode] = useState<DocumentRouterControlFlowMode>(
        DEFAULT_DOCUMENT_ROUTER_CONTROL_FLOW_MODE,
    );

    // connection observations belong to one configuration and mounted instance.
    const connectionGeneration = useRef({ value: 0 });
    useLayoutEffect(() => {
        const generation = connectionGeneration.current;
        generation.value++;
        setAiTestStatus('idle');
        setAiHealth(null);
        return () => { generation.value++; };
    }, [aiConfig]);

    async function loadAiConfig(isCurrent: () => boolean, preserveDraft = false) {
        try {
            await ensureTextModelDefaultsUpgraded();
            const observed = new Map<string, { value?: string } | undefined>();
            const readSetting = async (key: string) => {
                if (!observed.has(key)) observed.set(key, await db.settings.get(key));
                return observed.get(key);
            };
            // Capture exactly the raw values used to build this draft, including missing keys.
            const hardware = await readSetting('hardwareProfile');
            const modelClinical = await readSetting('aiModel_clinical');
            const modelReasoning = await readSetting('aiModel_reasoning');
            const legacyModel = await readSetting('aiModel');
            const genericUrl = await readSetting('aiUrl');
            const legacyUrl = await readSetting('ollamaUrl');
            await readSetting('aiProvider');
            const patientInsightKillSwitch = await readSetting(AI_PATIENT_INSIGHT_KILL_SWITCH_KEY);
            const documentSynthesisKillSwitch = await readSetting(AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY);
            const smartImportKillSwitch = await readSetting(AI_SMART_IMPORT_KILL_SWITCH_KEY);
            const treatmentReasoningKillSwitch = await readSetting(AI_TREATMENT_REASONING_KILL_SWITCH_KEY);
            const documentRouterControlFlow = await readSetting(DOCUMENT_ROUTER_CONTROL_FLOW_SETTING_KEY);

            let currentUrl = genericUrl?.value;
            if (!currentUrl) currentUrl = legacyUrl?.value;
            if (!currentUrl || currentUrl.includes(':8080')) currentUrl = 'http://127.0.0.1:11434/v1';

            const insightSettings = await loadAIInsightStoredSettings({ get: readSetting });
            if (!isCurrent()) return;
            const snapshot = Object.fromEntries(AI_CONFIGURATION_KEYS.map(key => [key, observed.get(key)?.value ?? null])) as AiConfigurationSnapshot;
            expectedValues.current = snapshot;
            if (preserveDraft) {
                setAiSettingsReadback(snapshot);
                setAiSettingsConflict('review');
                setAiSettingsLoadState('ready');
                return;
            }
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
            setAiSettingsLoadState('ready');
        } catch (e) {
            if (!isCurrent()) return;
            console.error('Failed to load AI config:', e);
            setAiSettingsLoadState('failed');
        }
    }

    useEffect(() => {
        let current = true;
        mounted.current = true;
        void loadAiConfig(() => current);
        return () => { current = false; mounted.current = false; };
    }, []);

    const rereadAiConfig = async () => {
        if (saving.current) return;
        saving.current = true;
        setIsSavingAi(true);
        try { await loadAiConfig(() => mounted.current, true); }
        finally { saving.current = false; if (mounted.current) setIsSavingAi(false); }
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
        if (aiSettingsLoadState !== 'ready' || aiSettingsConflict === 'conflict' || saving.current || !expectedValues.current || !mounted.current) return;
        saving.current = true;
        setIsSavingAi(true);
        try {
            const values = {
                hardwareProfile, aiProvider: 'ollama', aiModel_clinical: aiConfig.model_clinical,
                aiModel_reasoning: aiConfig.model_reasoning, aiModel: aiConfig.model_clinical,
                aiUrl: aiConfig.url, ollamaUrl: aiConfig.url,
                documentRouterControlFlow: documentRouterControlFlowMode,
                aiPatientInsightKillSwitch: serializeAiPatientInsightKillSwitchState(patientInsightEnabled),
                aiDocumentSynthesisKillSwitch: serializeAiDocumentSynthesisKillSwitchState(documentSynthesisEnabled),
                aiSmartImportKillSwitch: serializeAiSmartImportKillSwitchState(smartImportEnabled),
                aiInsightMode: aiInsightSettings.mode,
                aiInsightManualConfig: JSON.stringify(sanitizeAIInsightManualConfig(aiInsightSettings.manualConfig)),
            };
            const response = await fetch('/api/settings/ai/configuration', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expectedValues: expectedValues.current, values }),
            });
            if (response.status === 409) {
                if (mounted.current) {
                    setAiSettingsConflict('conflict');
                    setAiSettingsReadback(null);
                    showToast({ tone: 'error', title: 'Le impostazioni sono cambiate. Rileggi prima di confermare la bozza.' });
                }
                return;
            }
            if (!response.ok) throw new Error('Configuration save failed');
            if (!mounted.current) return;
            expectedValues.current = values;
            setAiSettingsConflict(null);
            setAiSettingsReadback(null);
            setAiTestStatus('idle');
            setSavedConfigurationRevision(previous => previous + 1);
            showToast({ tone: 'success', title: 'Configurazione IA salvata' });
        } catch (e) {
            console.error(e);
            showToast({ tone: 'error', title: 'Salvataggio non riuscito' });
        } finally {
            saving.current = false;
            if (mounted.current) setIsSavingAi(false);
        }
    };

    const testAiConnection = async () => {
        const generation = ++connectionGeneration.current.value;
        const isCurrent = () => generation === connectionGeneration.current.value;
        let timer: ReturnType<typeof setTimeout> | undefined;
        setAiTestStatus('testing');
        setAiHealth(null);
        try {
            const { AIService } = await import('@/lib/ai-service');
            if (!isCurrent()) return;
            const service = AIService.fromLocalTaskConfig(
                'clinical',
                aiConfig.url,
                { clinical: aiConfig.model_clinical },
                aiConfig.provider,
            );

            const timeoutPromise = new Promise<{ status: string; message?: string; models?: unknown[] }>((_, reject) =>
                timer = setTimeout(() => reject(new Error('Ollama non ha risposto entro 60 secondi. Riprova il test.')), 60000),
            );

            const health = await Promise.race([
                service.getHealth(),
                timeoutPromise,
            ]);

            if (!isCurrent()) return;
            const installedModels = (health.models as string[]) || [];
            const missingModels: string[] = [];

            const isMissing = (target: string) => {
                if (!target) return false;
                return !isInstalledOllamaModel(installedModels, target);
            };

            if (isMissing(aiConfig.model_clinical)) missingModels.push(aiConfig.model_clinical);
            if (isMissing(aiConfig.model_reasoning)) missingModels.push(aiConfig.model_reasoning);

            if (health.status === 'ok' && missingModels.length > 0) {
                setAiHealth({
                    status: 'error',
                    message: `Ollama è attivo, ma mancano i modelli configurati: ${missingModels.join(', ')}. Scegli un modello installato o consulta i consigli qui sotto.`,
                    models: installedModels,
                });
                setAiTestStatus('error');
                return;
            }

            setAiHealth({
                ...health,
                status: health.status === 'ok' && installedModels.length > 0 ? 'ok' : 'error',
                message: health.status === 'ok'
                    ? installedModels.length > 0
                        ? `Ollama è raggiungibile: ${formatCountLabel(installedModels.length, 'modello presente', 'modelli presenti')}. Questo test non abilita le funzioni cliniche.`
                        : 'Ollama è raggiungibile, ma non contiene modelli. Consulta i consigli qui sotto.'
                    : 'Ollama non è raggiungibile. Controlla indirizzo e servizio locale, poi riprova.',
                models: installedModels,
            });
            setAiTestStatus(health.status === 'ok' && installedModels.length > 0 ? 'success' : 'error');
        } catch (e) {
            if (!isCurrent()) return;
            setAiTestStatus('error');
            setAiHealth({
                status: 'error',
                message: e instanceof Error ? e.message : 'Errore imprevisto',
                models: [],
            });
        } finally {
            if (timer) clearTimeout(timer);
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
        aiSettingsLoadState,
        aiSettingsConflict,
        aiSettingsReadback,
        rereadAiConfig,
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
        savedConfigurationRevision,
        testAiConnection,
    };
}
