'use client';

import { useState, useEffect, useRef } from 'react';
import {
    AI_INSIGHT_MODE_OPTIONS,
    type AIInsightManualConfig,
} from '@/lib/ai-insight-settings';
import { Upload, Database, Bot, Save, RefreshCw, AlertTriangle, CheckCircle, Server, User, Cpu, Building2, Download, Check } from 'lucide-react';
import BackupRestoreUI from '@/components/backup-restore-ui';
import DataSeeder from '@/components/data-seeder';
import { importAifaCsv, getDrugStats, clearDrugDatabase } from '@/lib/aifa-importer';
/* @Codex */
import ExemptionDbManager from '@/components/settings/exemption-db-manager';
import { cn } from '@/lib/utils';
import { useSecurity } from '@/components/security-provider';
import DiagnosticHub from '@/components/diagnostic-hub';
import ServiceArchitecturePanel from '@/components/service-architecture-panel';
/* @Codex */
import { useAiSettingsController } from '@/lib/hooks/use-ai-settings-controller';

// --- Model Selector Component ---
interface ModelSelectorProps {
    label: string;
    description: string;
    icon: React.ReactNode;
    color: 'emerald' | 'purple' | 'blue';
    value: string;
    onChange: (val: string) => void;
    recommended: { name: string; desc: string }[];
    provider: string;
}

function ModelSelector({ label, description, icon, color, value, onChange, recommended, provider }: ModelSelectorProps) {
    const [installedModels, setInstalledModels] = useState<string[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [loading, setLoading] = useState(false);
    const [isPulling, setIsPulling] = useState(false);
    const [pullProgress, setPullProgress] = useState(0);
    const [pullStatus, setPullStatus] = useState("");
    const [showCustom, setShowCustom] = useState(false);

    // Initial check
    useEffect(() => {
        if (provider === 'ollama') {
            checkInstalled();
        }
    }, [provider]);

    const checkInstalled = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/ai/models');
            if (res.ok) {
                const data = await res.json();
                if (data.models) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    setInstalledModels(data.models.map((m: any) => m.name));
                }
            }
        } catch (e) {
            console.error("Failed to list models", e);
        } finally {
            setLoading(false);
        }
    };

    const handlePull = async (modelName: string) => {
        if (!confirm(`Vuoi scaricare il modello '${modelName}'? \nPotrebbe richiedere diversi GB e tempo a seconda della connessione.`)) return;

        setIsPulling(true);
        setPullProgress(0);
        setPullStatus("Inizializzazione download...");

        try {
            const response = await fetch('/api/ai/pull', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: modelName })
            });

            if (!response.ok) throw new Error("Download failed to start");
            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);

                        if (data.status) setPullStatus(data.status);
                        if (data.total && data.completed) {
                            const p = Math.round((data.completed / data.total) * 100);
                            setPullProgress(p);
                        }
                        if (data.error) throw new Error(data.error);
                    } catch (e) {
                        // ignore partial
                        console.warn("Parse error", e);
                    }
                }
            }

            alert(`Modello ${modelName} installato con successo!`);
            await checkInstalled();
            onChange(modelName); // Auto select

        } catch (e) {
            console.error(e);
            alert(`Errore durante il download: ${e instanceof Error ? e.message : 'Unknown error'}`);
        } finally {
            setIsPulling(false);
            setPullProgress(0);
            setPullStatus("");
        }
    };

    const isInstalled = (name: string) => installedModels.some(m => m.startsWith(name) || name.startsWith(m));

    const colorClasses = {
        emerald: { bg: 'bg-emerald-50/50', border: 'border-emerald-100', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', title: 'text-emerald-900' },
        purple: { bg: 'bg-purple-50/50', border: 'border-purple-100', iconBg: 'bg-purple-100', iconText: 'text-purple-600', title: 'text-purple-900' },
        blue: { bg: 'bg-blue-50/50', border: 'border-blue-100', iconBg: 'bg-blue-100', iconText: 'text-blue-600', title: 'text-blue-900' }
    };
    const c = colorClasses[color];

    return (
        <div className={`p-4 rounded-xl border ${c.bg} ${c.border}`}>
            <div className="flex items-start gap-3 mb-3">
                <div className={`p-2 rounded-lg ${c.iconBg} ${c.iconText}`}>
                    {icon}
                </div>
                <div>
                    <h4 className={`text-sm font-bold ${c.title}`}>{label}</h4>
                    <p className="text-[10px] text-gray-500">{description}</p>
                </div>
            </div>

            <div className="space-y-2">
                {!showCustom ? (
                    <div className="grid gap-2">
                        {recommended.map((model) => {
                            const installed = isInstalled(model.name);
                            const selected = value === model.name;

                            return (
                                <div
                                    key={model.name}
                                    onClick={() => onChange(model.name)}
                                    className={`
                                        relative group flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all
                                        ${selected
                                            ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500 z-10'
                                            : 'bg-white/60 border-gray-200 hover:border-gray-300 hover:bg-white'
                                        }
                                    `}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selected ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300'}`}>
                                            {selected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-gray-800">{model.name}</span>
                                            <span className="text-[10px] text-gray-500">{model.desc}</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {installed ? (
                                            <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-100">
                                                <Check className="w-3 h-3" /> Installato
                                            </span>
                                        ) : (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePull(model.name);
                                                }}
                                                disabled={isPulling}
                                                className="flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full border border-blue-100 hover:bg-blue-100 transition-colors"
                                            >
                                                {isPulling && value === model.name ? ( // Only show spinner if this specific one is related? Or just global blocking
                                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                                ) : <Download className="w-3 h-3" />}
                                                Scarica
                                            </button>
                                        )}
                                    </div>

                                    {/* Pull Progress Overlay */}
                                    {isPulling && !installed && ( // Just show global overlay or specific?
                                        // Actually we handle one pull at a time globally for simplicity
                                        null
                                    )}
                                </div>
                            );
                        })}

                        <button
                            onClick={() => setShowCustom(true)}
                            className="text-xs text-gray-400 hover:text-gray-600 underline text-center mt-1"
                        >
                            Usa un modello personalizzato
                        </button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <input
                            type="text"
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            className="w-full text-xs border-gray-300 dark:border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 py-2"
                            placeholder="es. llama3"
                            autoFocus
                        />
                        <button
                            onClick={() => setShowCustom(false)}
                            className="text-xs text-gray-400 hover:text-gray-600 underline"
                        >
                            Torna ai consigliati
                        </button>
                    </div>
                )}
            </div>

            {/* Global Pull Status */}
            {isPulling && (
                <div className="mt-3 p-3 bg-white rounded-lg border border-indigo-100 shadow-sm animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-bold text-indigo-700 flex items-center gap-2">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Scaricamento in corso...
                        </span>
                        <span className="text-xs font-mono text-indigo-600">{pullProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div
                            className="bg-indigo-500 h-full transition-all duration-300"
                            style={{ width: `${pullProgress}%` }}
                        />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 truncate">{pullStatus}</p>
                </div>
            )}
        </div>
    );
}


export default function SettingsPage() {
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- AIFA State ---
    const [drugStats, setDrugStats] = useState<number | null>(null);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(0);

    // --- Profile State ---
    const { user, updateUser } = useSecurity();
    const [profile, setProfile] = useState({
        doctorName: '',
        clinicName: ''
    });
    const [isSavingProfile, setIsSavingProfile] = useState(false);

    const {
        hardwareProfile,
        aiConfig,
        setAiConfig,
        aiInsightSettings,
        setAiInsightSettings,
        isSavingAi,
        aiTestStatus,
        aiHealth,
        selectedInsightMode,
        insightRuntimePreview,
        applyHardwareProfile,
        updateManualInsightConfig,
        saveAiConfig,
        testAiConnection,
    } = useAiSettingsController();

    const [showAdvanced, setShowAdvanced] = useState(false);
    const [isDockerApp, setIsDockerApp] = useState(false);
    // @Codex
    const [nativeLaunchState, setNativeLaunchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    // Load initial data
    useEffect(() => {
        loadStats();
    }, []);

    // @Codex
    const openNativeApp = async () => {
        if (nativeLaunchState === 'loading') return;
        setNativeLaunchState('loading');
        try {
            const res = await fetch('/api/system/native', { method: 'POST' });
            if (!res.ok) throw new Error('Launch failed');
            setNativeLaunchState('success');
            window.setTimeout(() => setNativeLaunchState('idle'), 2000);
        } catch (e) {
            console.error("Native app launch failed", e);
            setNativeLaunchState('error');
        }
    };

    // Sync profile with user context
    useEffect(() => {
        if (user) {
            setProfile({
                doctorName: user.displayName || '',
                clinicName: user.ambulatoryName || ''
            });
        }
    }, [user]);

    const saveProfile = async () => {
        if (!user) return;
        setIsSavingProfile(true);
        try {
            const res = await fetch('/api/auth/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: user.id,
                    displayName: profile.doctorName,
                    ambulatoryName: profile.clinicName
                })
            });

            if (!res.ok) throw new Error("Update failed");

            updateUser({
                displayName: profile.doctorName,
                ambulatoryName: profile.clinicName
            });

            alert("Profilo aggiornato con successo!");
        } catch (e) {
            console.error(e);
            alert("Errore durante il salvataggio del profilo.");
        } finally {
            setIsSavingProfile(false);
        }
    };

    const loadStats = async () => {
        try {
            const count = await getDrugStats();
            setDrugStats(count);
        } catch (e) {
            console.error(e);
        }
    };

    // --- AIFA Handlers ---
    const handleAifaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!confirm("Questa operazione potrebbe richiedere del tempo. Vuoi procedere con l'importazione?")) {
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
        }

        setImporting(true);
        setProgress(0);

        try {
            // Optional: Clear old DB? existing behavior seems to be additive or overwrite by key?
            // Usually simpler to clear for a fresh import if it's a full list replacement
            // await clearDrugDatabase(); 

            await importAifaCsv(file, (count, total) => {
                const perc = Math.round((count / total) * 100);
                setProgress(perc);
            });
            alert("Importazione completata con successo!");
            loadStats();
        } catch (err) {
            console.error(err);
            alert("Errore durante l'importazione.");
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleClearDrugs = async () => {
        if (confirm("Sei sicuro di voler cancellare l'intero database farmaci?")) {
            await clearDrugDatabase();
            loadStats();
        }
    };

    return (
        <div className="space-y-8 pb-10">
            <div>
                <h1 className="text-3xl font-bold text-gray-800 dark:text-white tracking-tight">Impostazioni</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                    Configura database, intelligenza artificiale e backup.
                </p>
            </div>

            {/* Service Architecture Panel - Visual Overview */}
            <ServiceArchitecturePanel />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* --- Profile Section --- */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                            <User className="w-6 h-6" /> {/* reusing Bot icon or maybe User, let's use check-circle or similar if available, or just reuse consistent styling */}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Profilo Medico</h2>
                            <p className="text-xs text-gray-500">Personalizza le informazioni visualizzate.</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Nome Medico
                            </label>
                            <input
                                type="text"
                                value={profile.doctorName}
                                onChange={(e) => setProfile({ ...profile, doctorName: e.target.value })}
                                placeholder="es. Dr. Mario Rossi"
                                className="w-full rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-50 p-2.5 text-sm"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Nome Ambulatorio
                            </label>
                            <input
                                type="text"
                                value={profile.clinicName}
                                onChange={(e) => setProfile({ ...profile, clinicName: e.target.value })}
                                placeholder="es. Studio Medico Centro"
                                className="w-full rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-50 p-2.5 text-sm"
                            />
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={saveProfile}
                                disabled={isSavingProfile}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 text-sm font-medium"
                            >
                                <Save className="w-4 h-4" />
                                {isSavingProfile ? 'Salvataggio...' : 'Salva Profilo'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* --- AI Config Section --- */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                            <Bot className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Configurazione AI</h2>
                            <p className="text-xs text-gray-500">Gestisci i modelli del &ldquo;Team Clinico Virtuale&rdquo;.</p>
                        </div>
                    </div>

                    <div className="space-y-6">
                        {/* 1. Hardware Profile Selector */}
                        <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                                <Cpu className="w-4 h-4" />
                                Profilo Hardware
                            </label>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div
                                    onClick={() => applyHardwareProfile('low')}
                                    className={cn(
                                        "p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md",
                                        hardwareProfile === 'low'
                                            ? "bg-white border-green-500 ring-2 ring-green-100 shadow-sm"
                                            : "bg-white border-gray-200 opacity-60 hover:opacity-100"
                                    )}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-bold uppercase text-green-700">Light</span>
                                        {hardwareProfile === 'low' && <CheckCircle className="w-3 h-3 text-green-600" />}
                                    </div>
                                    <p className="text-xs font-bold text-gray-800">&lt; 16GB RAM</p>
                                    <p className="text-[10px] text-gray-500 mt-1">Usa solo modelli molto compressi (Q4_K_M).</p>
                                </div>
                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                    Per utilizzare questa funzione è necessaria una connessione Internet attiva e una chiave API configurata se non si usano modelli locali.
                                </p>
                                <p className="text-xs text-gray-400 mt-2">
                                    Nota: Il &quot;Profilo Hardware&quot; sovrascrive i modelli selezionati. Imposta su &quot;Personalizzato&quot; per scegliere manualmente.
                                </p>

                                <div
                                    onClick={() => applyHardwareProfile('medium')}
                                    className={cn(
                                        "p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md",
                                        hardwareProfile === 'medium'
                                            ? "bg-white border-indigo-500 ring-2 ring-indigo-100 shadow-sm"
                                            : "bg-white border-gray-200 opacity-60 hover:opacity-100"
                                    )}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-bold uppercase text-indigo-700">Balanced</span>
                                        {hardwareProfile === 'medium' && <CheckCircle className="w-3 h-3 text-indigo-600" />}
                                    </div>
                                    <p className="text-xs font-bold text-gray-800">16-32GB RAM</p>
                                    <p className="text-[10px] text-gray-500 mt-1">Qwen 14B per sintesi e reasoning.</p>
                                </div>

                                <div
                                    onClick={() => applyHardwareProfile('high')}
                                    className={cn(
                                        "p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md",
                                        hardwareProfile === 'high'
                                            ? "bg-white border-purple-500 ring-2 ring-purple-100 shadow-sm"
                                            : "bg-white border-gray-200 opacity-60 hover:opacity-100"
                                    )}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-bold uppercase text-purple-700">Pro</span>
                                        {hardwareProfile === 'high' && <CheckCircle className="w-3 h-3 text-purple-600" />}
                                    </div>
                                    <p className="text-xs font-bold text-gray-800">&gt; 32GB RAM</p>
                                    <p className="text-[10px] text-gray-500 mt-1">Qwen 3.5 35B A3B per tutte le superfici text-only.</p>
                                </div>
                            </div>
                        </div>

                        {/* 2. Task Assignment with Model Selector */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
                                <Bot className="w-4 h-4" />
                                Ruoli del Team AI
                            </h3>

                            <ModelSelector
                                label="Radiologo & Clinico"
                                description="Per sintesi cliniche, insight e strutturazione testuale dopo OCR."
                                icon={<Bot className="w-5 h-5" />}
                                color="emerald"
                                value={aiConfig.model_clinical}
                                onChange={(val) => setAiConfig({ ...aiConfig, model_clinical: val })}
                                recommended={[
                                    { name: "qwen3.5:35b-a3b", desc: "Qwen 3.5 35B A3B (Default consigliato)" },
                                    { name: "qwen2.5:32b", desc: "Qwen 2.5 32B (Compatibilita legacy)" },
                                    { name: "qwen2.5:14b", desc: "Qwen 2.5 14B (Bilanciato)" },
                                    { name: "qwen2.5:7b", desc: "Qwen 2.5 7B (Leggero)" },
                                    { name: "hf.co/unsloth/medgemma-1.5-4b-it-GGUF", desc: "MedGemma 4B (Specialistico medico, non default)" }
                                ]}
                                provider={aiConfig.provider}
                            />

                            <ModelSelector
                                label="Internista (Reasoning)"
                                description="Per riassunti narrativi, chat complesse e “Second Opinion”."
                                icon={<Cpu className="w-5 h-5" />}
                                color="purple"
                                value={aiConfig.model_reasoning}
                                onChange={(val) => setAiConfig({ ...aiConfig, model_reasoning: val })}
                                recommended={[
                                    { name: "qwen3.5:35b-a3b", desc: "Qwen 3.5 35B A3B (Potente, default)" },
                                    { name: "qwen2.5:32b", desc: "Qwen 2.5 32B (Compatibilita legacy)" },
                                    { name: "qwen2.5:14b", desc: "Qwen 2.5 14B (Ottimo, 16GB RAM)" },
                                    { name: "qwen2.5:7b", desc: "Qwen 2.5 7B (Leggero)" },
                                    { name: "deepseek-r1:14b", desc: "DeepSeek R1 14B (Reasoning)" }
                                ]}
                                provider={aiConfig.provider}
                            />

                            <ModelSelector
                                label="Segreteria (OCR)"
                                description="Per importare documenti cartacei, referti scannerizzati e note."
                                icon={<Upload className="w-5 h-5" />}
                                color="blue"
                                value={aiConfig.model_ocr}
                                onChange={(val) => setAiConfig({ ...aiConfig, model_ocr: val })}
                                recommended={[
                                    { name: "deepseek-ocr", desc: "DeepSeek OCR 2 (Consigliato)" },
                                    { name: "minicpm-v:8b-2.6", desc: "MiniCPM-V 8B (Alternativo)" },
                                    { name: "llava:13b", desc: "LLaVA 13B (Vision Generalista)" }
                                ]}
                                provider={aiConfig.provider}
                            />
                        </div>

                        {/* @Codex */}
                        <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-bold text-indigo-900">AI Patient Insight</h3>
                                    <p className="text-[11px] text-indigo-800/80">
                                        Budget del contesto e dell&apos;output per l&apos;insight clinico sintetico.
                                    </p>
                                </div>
                                <span className="rounded-full border border-indigo-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                                    {selectedInsightMode.title}
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {AI_INSIGHT_MODE_OPTIONS.map((option) => {
                                    const selected = aiInsightSettings.mode === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setAiInsightSettings((prev) => ({ ...prev, mode: option.value }))}
                                            className={cn(
                                                "rounded-lg border px-3 py-3 text-left transition-colors",
                                                selected
                                                    ? "border-indigo-500 bg-white shadow-sm"
                                                    : "border-indigo-100 bg-white/70 hover:border-indigo-200"
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-bold text-gray-900">{option.title}</span>
                                                {selected ? <CheckCircle className="h-4 w-4 text-indigo-600" /> : null}
                                            </div>
                                            <p className="mt-1 text-[11px] text-gray-600">{option.description}</p>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="rounded-lg border border-indigo-100 bg-white/80 px-3 py-2 text-[11px] text-gray-600">
                                {aiInsightSettings.mode === 'full_auto'
                                    ? 'Full auto usa il profilo hardware corrente e la complessita del caso per scegliere il budget.'
                                    : selectedInsightMode.description}
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600">
                                <div className="rounded-lg bg-white px-3 py-2 border border-indigo-100">
                                    <span className="block text-[10px] uppercase tracking-wide text-gray-400">Profilo hardware</span>
                                    <span className="font-semibold text-gray-800">{hardwareProfile}</span>
                                </div>
                                <div className="rounded-lg bg-white px-3 py-2 border border-indigo-100">
                                    <span className="block text-[10px] uppercase tracking-wide text-gray-400">Budget runtime</span>
                                    <span className="font-semibold text-gray-800">{insightRuntimePreview}</span>
                                </div>
                            </div>

                            {aiInsightSettings.mode === 'manual' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label className="text-xs font-medium text-gray-700">
                                        Documenti massimi
                                        <input
                                            type="number"
                                            min={2}
                                            max={12}
                                            value={aiInsightSettings.manualConfig.maxDocuments}
                                            onChange={(e) => updateManualInsightConfig('maxDocuments', Number.parseInt(e.target.value, 10))}
                                            className="mt-1 w-full rounded-lg border-gray-300 bg-white text-sm"
                                        />
                                    </label>
                                    <label className="text-xs font-medium text-gray-700">
                                        Caratteri per documento
                                        <input
                                            type="number"
                                            min={120}
                                            max={480}
                                            value={aiInsightSettings.manualConfig.maxDocumentSummaryChars}
                                            onChange={(e) => updateManualInsightConfig('maxDocumentSummaryChars', Number.parseInt(e.target.value, 10))}
                                            className="mt-1 w-full rounded-lg border-gray-300 bg-white text-sm"
                                        />
                                    </label>
                                    <label className="text-xs font-medium text-gray-700">
                                        Budget contesto documenti
                                        <input
                                            type="number"
                                            min={800}
                                            max={5000}
                                            value={aiInsightSettings.manualConfig.maxDocumentContextChars}
                                            onChange={(e) => updateManualInsightConfig('maxDocumentContextChars', Number.parseInt(e.target.value, 10))}
                                            className="mt-1 w-full rounded-lg border-gray-300 bg-white text-sm"
                                        />
                                    </label>
                                    <label className="text-xs font-medium text-gray-700">
                                        Output max token
                                        <input
                                            type="number"
                                            min={256}
                                            max={1200}
                                            value={aiInsightSettings.manualConfig.outputMaxTokens}
                                            onChange={(e) => updateManualInsightConfig('outputMaxTokens', Number.parseInt(e.target.value, 10))}
                                            className="mt-1 w-full rounded-lg border-gray-300 bg-white text-sm"
                                        />
                                    </label>
                                </div>
                            )}
                        </div>

                        {/* 3. Provider & Infrastructure */}
                        <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                            {/* ... infrastructure settings remain similar ... */}
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-xs font-medium text-gray-500 uppercase">
                                    Infrastruttura
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="advancedFit"
                                        checked={showAdvanced}
                                        onChange={(e) => setShowAdvanced(e.target.checked)}
                                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-3 w-3"
                                    />
                                    <label htmlFor="advancedFit" className="text-[10px] font-medium text-gray-400 cursor-pointer select-none">
                                        Avanzate
                                    </label>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                                    Provider AI: <span className="ml-2 font-semibold text-gray-800">Ollama (Locale)</span>
                                </div>
                                <input
                                    type="text"
                                    value={aiConfig.url}
                                    onChange={(e) => setAiConfig({ ...aiConfig, url: e.target.value })}
                                    placeholder="http://127.0.0.1:11434/v1"
                                    className="w-full text-sm rounded-lg border-gray-300 py-2 font-mono text-xs"
                                />
                            </div>

                            {showAdvanced && (
                                <div className="mt-3 pt-2 border-t border-dashed border-gray-200">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id="dockerMode"
                                            checked={isDockerApp}
                                            onChange={(e) => {
                                                const newVal = e.target.checked;
                                                setIsDockerApp(newVal);
                                                setAiConfig(prev => ({
                                                    ...prev,
                                                    url: newVal
                                                        ? "http://host.docker.internal:11434/v1"
                                                        : "http://127.0.0.1:11434/v1"
                                                }));
                                            }}
                                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-3 w-3"
                                        />
                                        <label htmlFor="dockerMode" className="text-xs text-gray-500 cursor-pointer">
                                            Docker Internal Host (se l&apos;app è in container)
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="pt-2 flex items-center gap-3">
                            <button
                                onClick={saveAiConfig}
                                disabled={isSavingAi}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 text-sm font-medium"
                            >
                                <Save className="w-4 h-4" />
                                {isSavingAi ? 'Salvataggio...' : 'Salva Configurazione'}
                            </button>

                            <button
                                onClick={testAiConnection}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 rounded-lg transition-colors text-sm font-medium"
                            >
                                <RefreshCw className={cn("w-4 h-4", aiTestStatus === 'testing' && "animate-spin")} />
                                Test Connessione
                            </button>
                        </div>
                        <p className="text-[10px] text-gray-400 italic">
                            Se l&apos;AI consuma troppa CPU: riavvia Ollama (`docker restart ollama`).
                        </p>

                        {/* Detailed Diagnostic Panel */}
                        {aiHealth && (
                            <div className={cn(
                                "rounded-xl p-4 border text-sm space-y-2 animate-in slide-in-from-top-2 fade-in",
                                aiHealth.status === 'ok' ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"
                            )}>
                                <div className="flex items-start gap-2 font-bold">
                                    {aiHealth.status === 'ok' ? <CheckCircle className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
                                    <div>
                                        <p>{aiHealth.status === 'ok' ? "Sistema AI Operativo" : "Problema rilevato"}</p>
                                    </div>
                                </div>

                                <div className="pl-7 space-y-1 text-xs">
                                    <p className="opacity-90">{aiHealth.message}</p>
                                </div>
                            </div>
                        )}

                        {/* Test Status Indicator */}
                        {aiTestStatus === 'success' && (
                            <div className="flex items-center gap-2 text-green-600 text-xs bg-green-50 p-2 rounded-lg border border-green-100">
                                <CheckCircle className="w-4 h-4" />
                                Connessione a Ollama riuscita!
                            </div>
                        )}
                        {aiTestStatus === 'error' && (
                            <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 p-2 rounded-lg border border-red-100">
                                <AlertTriangle className="w-4 h-4" />
                                Impossibile connettersi. Controlla che Ollama sia attivo.
                            </div>
                        )}
                    </div>
                </div>

                {/* --- AIFA Database Section --- */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <Database className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Database Farmaci (AIFA)</h2>
                            <div className="flex flex-col">
                                <p className="text-xs text-gray-500">Gestisci l&apos;elenco farmaci offline</p>
                                <a
                                    href="https://www.aifa.gov.it/web/guest/liste-dei-farmaci"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-blue-500 hover:underline mt-0.5"
                                >
                                    Fonte Dati: AIFA Open Data (Liste di Trasparenza)
                                </a>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl flex items-center justify-between">
                            <div>
                                <p className="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider">Farmaci Indicizzati</p>
                                <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">
                                    {drugStats !== null ? drugStats.toLocaleString() : '-'}
                                </p>
                            </div>
                            <Server className="w-8 h-8 text-blue-200 dark:text-blue-800" />
                        </div>

                        <div className="space-y-3">
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleAifaUpload}
                                accept=".csv"
                                className="hidden"
                                disabled={importing}
                                aria-label="Carica file CSV AIFA"
                            />

                            {!importing ? (
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all cursor-pointer"
                                >
                                    <Upload className="w-5 h-5" />
                                    <span className="font-medium">Carica File AIFA (.csv)</span>
                                </button>
                            ) : (
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs text-gray-500">
                                        <span>Importazione in corso...</span>
                                        <span>{progress}%</span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                                        <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 progress-bar-width" data-progress={progress}></div>
                                    </div>
                                    <p className="text-[10px] text-gray-400 text-center">Non chiudere la pagina.</p>
                                </div>
                            )}

                            {drugStats !== null && drugStats > 0 && (
                                <div className="pt-2">
                                    <button
                                        onClick={handleClearDrugs}
                                        className="text-xs text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                                    >
                                        <AlertTriangle className="w-3 h-3" />
                                        Svuota database farmaci
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* @Codex */}
                <ExemptionDbManager />

                {/* --- System & Maintenance Section --- */}
                <div className="md:col-span-2 space-y-6">
                    <DiagnosticHub />

                    <h3 className="text-xl font-bold text-gray-800 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-2">Sistema & Manutenzione</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Ambulatory Management */}
                        <div className="bg-blue-50/50 dark:bg-blue-900/10 rounded-2xl p-6 border border-blue-100 dark:border-blue-800/30 flex flex-col justify-between">
                            <div className="flex items-start gap-4 mb-4">
                                <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl shrink-0">
                                    <Building2 className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-800 dark:text-gray-100">Ambulatori</h3>
                                    <p className="text-xs text-gray-500 mt-1">Gestisci sedi e cambi contesto.</p>
                                </div>
                            </div>
                            <div className="flex items-center justify-end">
                                <a href="/settings/ambulatories" className="text-sm font-medium text-blue-600 hover:underline">
                                    Apri Gestione &rarr;
                                </a>
                            </div>
                        </div>

                        {/* Developer Tools */}
                        <div className="bg-amber-50/50 dark:bg-amber-900/10 rounded-2xl p-6 border border-amber-100 dark:border-amber-800/30 flex flex-col justify-between">
                            <div className="flex items-start gap-4 mb-4">
                                <div className="p-2.5 bg-amber-100 text-amber-600 rounded-xl shrink-0">
                                    <Server className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-800 dark:text-gray-100">Strumenti di Sviluppo</h3>
                                    <p className="text-xs text-gray-500 mt-1">Genera dati fittizi per testare l&apos;applicazione.</p>
                                </div>
                            </div>
                            <div className="flex items-center justify-end">
                                <DataSeeder />
                            </div>
                        </div>

                        {/* @Codex: Native app launcher */}
                        <div className="bg-slate-50/50 dark:bg-slate-900/10 rounded-2xl p-6 border border-slate-100 dark:border-slate-800/30 flex flex-col justify-between">
                            <div className="flex items-start gap-4 mb-4">
                                <div className="p-2.5 bg-slate-100 text-slate-600 rounded-xl shrink-0">
                                    <Cpu className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-800 dark:text-gray-100">App nativa</h3>
                                    <p className="text-xs text-gray-500 mt-1">Apri rapidamente MediFlow su macOS.</p>
                                </div>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <button
                                    onClick={openNativeApp}
                                    disabled={nativeLaunchState === 'loading'}
                                    className="text-sm font-medium text-slate-700 hover:text-slate-900 disabled:text-slate-400"
                                >
                                    {nativeLaunchState === 'loading' ? 'Avvio in corso...' : 'Apri app nativa'}
                                </button>
                                {nativeLaunchState === 'success' && (
                                    <span className="text-xs text-green-600">Aperta</span>
                                )}
                                {nativeLaunchState === 'error' && (
                                    <span className="text-xs text-red-600">Errore</span>
                                )}
                            </div>
                        </div>

                        {/* Danger Zone */}
                        <div className="bg-red-50/50 dark:bg-red-900/10 rounded-2xl p-6 border border-red-100 dark:border-red-800/30">
                            <div className="flex items-start gap-4 mb-6">
                                <div className="p-2.5 bg-red-100 text-red-600 rounded-xl shrink-0">
                                    <AlertTriangle className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-800 dark:text-gray-100">Zona Pericolo</h3>
                                    <p className="text-xs text-gray-500 mt-1">Azioni irreversibili che influenzano l&apos;account.</p>
                                </div>
                            </div>

                            <div className="bg-yellow-50 dark:bg-yellow-900/10 border-l-4 border-yellow-400 p-4 mb-6">
                                <div className="flex">
                                    <div className="flex-shrink-0">
                                        <AlertTriangle className="h-5 w-5 text-yellow-400" />
                                    </div>
                                    <div className="ml-3">
                                        <p className="text-xs text-gray-500 mt-1">
                                            Provider locale consigliato: Ollama.
                                        </p>
                                        <p className="text-sm text-yellow-700 dark:text-yellow-200">
                                            Modificando queste impostazioni potresti interrompere il collegamento con l&apos;AI.
                                            Assicurati che il server Ollama sia attivo su <code>{aiConfig.url || "localhost:11434"}</code>.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-white dark:bg-red-950/20 rounded-xl border border-red-100 dark:border-red-900/50 shadow-sm">
                                <div>
                                    <p className="text-sm font-bold text-gray-700 dark:text-red-200">Reset Onboarding</p>
                                    <p className="text-[10px] text-gray-400">Cancella profilo utente e chiavi. (I pazienti restano)</p>
                                </div>
                                <button
                                    onClick={async () => {
                                        if (confirm("Sei sicuro? Questo cancellerà il tuo profilo utente e ti riporterà alla configurazione iniziale.\n\nI dati dei pazienti NON verranno persi, ma dovrai riconfigurare l'accesso.")) {
                                            try {
                                                const res = await fetch('/api/auth/reset', { method: 'POST' });
                                                if (res.ok) {
                                                    window.location.href = '/';
                                                } else {
                                                    alert("Errore durante il reset.");
                                                }
                                            } catch (e) {
                                                console.error(e);
                                                alert("Errore di connessione.");
                                            }
                                        }
                                    }}
                                    className="text-xs bg-white border border-red-200 text-red-600 hover:bg-red-600 hover:text-white px-3 py-2 rounded-lg font-bold transition-all shadow-sm"
                                >
                                    Reset Completo
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
                <BackupRestoreUI />
            </div>
        </div >
    );
}
