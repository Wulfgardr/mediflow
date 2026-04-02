'use client';

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import {
    AI_INSIGHT_MODE_OPTIONS,
} from '@/lib/ai-insight-settings';
import { Upload, Database, Bot, Save, RefreshCw, AlertTriangle, CheckCircle, Server, User, Cpu, Building2, Download, Check, Shield, Sparkles } from 'lucide-react';
import BackupRestoreUI from '@/components/backup-restore-ui';
import BackupSchedulerUI from '@/components/backup-scheduler-ui';
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
/* @Codex */
import AiModelParliamentPanel from '@/components/settings/ai-model-parliament-panel';
/* @Codex */
import AiRolloutReadinessPanel from '@/components/settings/ai-rollout-readiness-panel';
/* @Codex */
import AiRolloutGuardNotice from '@/components/settings/ai-rollout-guard-notice';
/* @Codex */
import { usePreviewProfileState } from '@/components/preview-profile-chrome';
/* @Codex */
import {
    getPreviewProfileById,
    PREVIEW_PROFILE_FLAG_LABELS,
    type PreviewProfileId,
} from '@/lib/preview-profiles';
import { useUIStyle } from '@/components/ui-style-provider';

// --- Model Selector Component ---
interface ModelSelectorProps {
    selectorId: 'clinical' | 'reasoning' | 'ocr';
    label: string;
    description: string;
    icon: ReactNode;
    color: 'emerald' | 'purple' | 'blue';
    value: string;
    onChange: (val: string) => void;
    recommended: { name: string; desc: string }[];
    provider: string;
    targetUrl: string;
}

function ModelSelector({ selectorId, label, description, icon, color, value, onChange, recommended, provider, targetUrl }: ModelSelectorProps) {
    const [installedModels, setInstalledModels] = useState<string[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [loading, setLoading] = useState(false);
    const [isPulling, setIsPulling] = useState(false);
    const [pullProgress, setPullProgress] = useState(0);
    const [pullStatus, setPullStatus] = useState("");
    const [showCustom, setShowCustom] = useState(false);
    const [pullingModel, setPullingModel] = useState<string | null>(null);

    const checkInstalled = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/ai/models', {
                headers: { 'x-target-url': targetUrl }
            });
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
    }, [targetUrl]);

    // Initial check
    useEffect(() => {
        if (provider === 'ollama') {
            void checkInstalled();
        }
    }, [provider, checkInstalled]);

    const handlePull = async (modelName: string) => {
        if (!confirm(`Vuoi scaricare il modello '${modelName}'? \nPotrebbe richiedere diversi GB e tempo a seconda della connessione.`)) return;

        setIsPulling(true);
        setPullingModel(modelName);
        setPullProgress(0);
        setPullStatus("Inizializzazione download...");

        try {
            const response = await fetch('/api/ai/pull', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-target-url': targetUrl,
                },
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
            setPullingModel(null);
            setPullProgress(0);
            setPullStatus("");
        }
    };

    const isInstalled = (name: string) => installedModels.some(m => m.startsWith(name) || name.startsWith(m));

    const colorClasses = {
        emerald: {
            iconBg: 'bg-emerald-100/90 dark:bg-emerald-500/15',
            iconText: 'text-emerald-600 dark:text-emerald-200',
            title: 'text-emerald-950 dark:text-emerald-100',
            description: 'text-emerald-900/65 dark:text-emerald-100/70',
            selectedCard: 'border-emerald-300/80 bg-emerald-50/70 shadow-[0_14px_28px_rgba(16,185,129,0.12)] dark:border-emerald-500/20 dark:bg-emerald-900/10',
            selectedRadio: 'border-emerald-600 bg-emerald-600 dark:border-emerald-300 dark:bg-emerald-300',
            selectedDot: 'bg-white dark:bg-emerald-950',
            installedBadge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-900/10 dark:text-emerald-200',
            downloadBadge: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-500/20 dark:bg-sky-900/10 dark:text-sky-200 dark:hover:bg-sky-900/20',
            progress: 'from-emerald-500 to-sky-500',
        },
        purple: {
            iconBg: 'bg-violet-100/90 dark:bg-violet-500/15',
            iconText: 'text-violet-600 dark:text-violet-200',
            title: 'text-violet-950 dark:text-violet-100',
            description: 'text-violet-900/65 dark:text-violet-100/70',
            selectedCard: 'border-violet-300/80 bg-violet-50/70 shadow-[0_14px_28px_rgba(139,92,246,0.12)] dark:border-violet-500/20 dark:bg-violet-900/10',
            selectedRadio: 'border-violet-600 bg-violet-600 dark:border-violet-300 dark:bg-violet-300',
            selectedDot: 'bg-white dark:bg-violet-950',
            installedBadge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-900/10 dark:text-emerald-200',
            downloadBadge: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/20 dark:bg-violet-900/10 dark:text-violet-200 dark:hover:bg-violet-900/20',
            progress: 'from-violet-500 to-indigo-500',
        },
        blue: {
            iconBg: 'bg-sky-100/90 dark:bg-sky-500/15',
            iconText: 'text-sky-600 dark:text-sky-200',
            title: 'text-sky-950 dark:text-sky-100',
            description: 'text-sky-900/65 dark:text-sky-100/70',
            selectedCard: 'border-sky-300/80 bg-sky-50/70 shadow-[0_14px_28px_rgba(14,165,233,0.12)] dark:border-sky-500/20 dark:bg-sky-900/10',
            selectedRadio: 'border-sky-600 bg-sky-600 dark:border-sky-300 dark:bg-sky-300',
            selectedDot: 'bg-white dark:bg-sky-950',
            installedBadge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-900/10 dark:text-emerald-200',
            downloadBadge: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-500/20 dark:bg-sky-900/10 dark:text-sky-200 dark:hover:bg-sky-900/20',
            progress: 'from-sky-500 to-blue-500',
        }
    };
    const c = colorClasses[color];

    return (
        <div className="apple-subsection space-y-4" data-testid={`ai-model-selector-${selectorId}`}>
            <div className="flex items-start gap-3">
                <div className={`rounded-2xl p-2.5 ${c.iconBg} ${c.iconText}`}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <h4 className={`text-sm font-semibold ${c.title}`}>{label}</h4>
                    <p className={`mt-1 text-[11px] leading-5 ${c.description}`}>{description}</p>
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
                                        relative flex items-center justify-between gap-3 rounded-[20px] border px-3.5 py-3 cursor-pointer transition-[border-color,background-color,box-shadow,transform]
                                        ${selected
                                            ? `${c.selectedCard} z-10`
                                            : 'border-white/70 bg-white/76 shadow-[0_10px_22px_rgba(15,23,42,0.04)] hover:-translate-y-0.5 hover:border-white hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20'
                                        }
                                    `}
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? c.selectedRadio : 'border-slate-300 dark:border-white/20'}`}>
                                            {selected && <div className={`h-1.5 w-1.5 rounded-full ${c.selectedDot}`} />}
                                        </div>
                                        <div className="min-w-0">
                                            <span className="block truncate text-xs font-semibold text-slate-900 dark:text-white">{model.name}</span>
                                            <span className="mt-0.5 block text-[11px] leading-5 text-slate-500 dark:text-slate-400">{model.desc}</span>
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        {installed ? (
                                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${c.installedBadge}`}>
                                                <Check className="w-3 h-3" /> Installato
                                            </span>
                                        ) : (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePull(model.name);
                                                }}
                                                disabled={isPulling}
                                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:opacity-60 ${c.downloadBadge}`}
                                            >
                                                {isPulling && pullingModel === model.name ? (
                                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                                ) : <Download className="w-3 h-3" />}
                                                Scarica
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        <button
                            onClick={() => setShowCustom(true)}
                            className="inline-flex items-center justify-center rounded-full border border-dashed border-slate-200/70 bg-white/58 px-4 py-2 text-xs font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-slate-200"
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
                            className={SETTINGS_INPUT_CLASS}
                            placeholder="es. llama3"
                            autoFocus
                        />
                        <button
                            onClick={() => setShowCustom(false)}
                            className="inline-flex items-center rounded-full border border-slate-200/70 bg-white/70 px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:text-slate-200"
                        >
                            Torna ai consigliati
                        </button>
                    </div>
                )}
            </div>

            {/* Global Pull Status */}
            {isPulling && (
                <div className="animate-in fade-in slide-in-from-bottom-2 rounded-[22px] border border-white/70 bg-white/78 p-4 shadow-[0_12px_26px_rgba(15,23,42,0.05)] backdrop-blur-md dark:border-white/10 dark:bg-white/5">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-white">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Scaricamento {pullingModel ? `di ${pullingModel}` : 'in corso'}
                        </span>
                        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{pullProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
                        <div
                            className={`h-full bg-gradient-to-r ${c.progress} transition-[width] duration-300`}
                            style={{ width: `${pullProgress}%` }}
                        />
                    </div>
                    <p className="mt-2 truncate text-[11px] text-slate-500 dark:text-slate-400">{pullStatus}</p>
                </div>
            )}
        </div>
    );
}

/* @Codex */
const SETTINGS_CARD_CLASS = 'glass-panel p-6 md:p-7';
/* @Codex */
const SETTINGS_SECTION_CARD_CLASS = 'apple-subsection p-5 md:p-6';
/* @Codex */
const SETTINGS_INPUT_CLASS = 'w-full rounded-2xl border border-white/70 bg-white/76 px-4 py-3 text-sm text-slate-800 shadow-[0_12px_26px_rgba(15,23,42,0.05)] outline-none backdrop-blur-md transition-[border-color,background-color,box-shadow] placeholder:text-slate-400 focus:border-white focus:ring-2 focus:ring-sky-500/20 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500/30';
/* @Codex */
const SETTINGS_LABEL_CLASS = 'mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300';
/* @Codex */
const SETTINGS_PRIMARY_BUTTON_CLASS = 'inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#0A84FF,#5AC8FA)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(10,132,255,0.28)] transition-[box-shadow,transform,opacity] hover:-translate-y-0.5 hover:shadow-[0_22px_40px_rgba(10,132,255,0.34)] disabled:cursor-not-allowed disabled:opacity-50';
/* @Codex */
const SETTINGS_TONED_BUTTON_CLASS: Record<'emerald' | 'amber' | 'indigo', string> = {
    emerald: 'inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(5,150,105,0.22)] transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50',
    amber: 'inline-flex items-center gap-2 rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(217,119,6,0.22)] transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50',
    indigo: 'inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(79,70,229,0.22)] transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50',
};
/* @Codex */
const SETTINGS_SECONDARY_BUTTON_CLASS = 'inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/76 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-[0_12px_26px_rgba(15,23,42,0.05)] backdrop-blur-md transition-[border-color,background-color,box-shadow,transform,color] hover:-translate-y-0.5 hover:border-white hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-white/20';

/* @Codex */
function SettingsSectionIntro({
    kicker,
    title,
    description,
}: {
    kicker: string;
    title: string;
    description: string;
}) {
    return (
        <div className="space-y-1">
            <p className="section-kicker">{kicker}</p>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
        </div>
    );
}

/* @Codex */
function SettingsRailLink({
    href,
    icon,
    label,
    description,
    compact = false,
}: {
    href: string;
    icon: ReactNode;
    label: string;
    description: string;
    compact?: boolean;
}) {
    return (
        <a
            href={href}
            className={cn(
                'border border-white/70 bg-white/68 text-left shadow-[0_10px_22px_rgba(15,23,42,0.04)] backdrop-blur-md transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-white hover:bg-white/86 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20',
                compact
                    ? 'inline-flex min-w-max items-center gap-2.5 rounded-full px-4 py-2.5'
                    : 'flex items-start gap-3 rounded-[22px] px-3.5 py-3'
            )}
        >
            <span className={cn('text-slate-500 dark:text-slate-300', compact ? '' : 'mt-0.5')}>{icon}</span>
            <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800 dark:text-white">{label}</span>
                {!compact ? (
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</span>
                ) : null}
            </span>
        </a>
    );
}


export default function SettingsPage() {
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- AIFA State ---
    const [drugStats, setDrugStats] = useState<number | null>(null);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(0);

    // --- Profile State ---
    const { user, updateUser, changePin } = useSecurity();
    const [profile, setProfile] = useState({
        doctorName: '',
        clinicName: ''
    });
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    /* @Codex */
    const [pinForm, setPinForm] = useState({ currentPin: '', newPin: '', confirmPin: '' });
    /* @Codex */
    const [isChangingPin, setIsChangingPin] = useState(false);
    /* @Codex */
    const [pinFeedback, setPinFeedback] = useState<null | { tone: 'success' | 'error'; message: string }>(null);

    const {
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
    } = useAiSettingsController();

    const [showAdvanced, setShowAdvanced] = useState(false);
    const [isDockerApp, setIsDockerApp] = useState(false);
    // @Codex
    const [nativeLaunchState, setNativeLaunchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    /* @Codex */
    const {
        isEnabled: isPreviewProfilesEnabled,
        availableProfiles,
        activeProfile,
        isApplying: isApplyingPreviewProfile,
        applyProfile,
    } = usePreviewProfileState();
    /* @Codex */
    const [selectedPreviewProfileId, setSelectedPreviewProfileId] = useState(activeProfile.id);
    /* @Codex */
    const selectedPreviewProfile = getPreviewProfileById(selectedPreviewProfileId);

    /* @Codex */
    useEffect(() => {
        setSelectedPreviewProfileId(activeProfile.id);
    }, [activeProfile.id]);
    const { uiStyleMode, setUIStyleMode } = useUIStyle();

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

    /* @Codex */
    const handleChangePin = async () => {
        setPinFeedback(null);

        if (pinForm.newPin !== pinForm.confirmPin) {
            setPinFeedback({ tone: 'error', message: 'La conferma del nuovo PIN non corrisponde.' });
            return;
        }

        setIsChangingPin(true);
        try {
            const result = await changePin(pinForm.currentPin, pinForm.newPin);
            if (!result.ok) {
                setPinFeedback({ tone: 'error', message: result.message });
                return;
            }

            setPinForm({ currentPin: '', newPin: '', confirmPin: '' });
            setPinFeedback({ tone: 'success', message: 'PIN aggiornato con successo. Usa il nuovo PIN dal prossimo sblocco.' });
        } finally {
            setIsChangingPin(false);
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

    /* @Codex */
    const railItems = [
        { href: '#appearance', label: 'Interfaccia', description: 'Stile clinico o liquid', icon: <Sparkles className="h-4 w-4" /> },
        { href: '#account', label: 'Account', description: 'Profilo e accesso', icon: <User className="h-4 w-4" /> },
        { href: '#ai', label: 'AI', description: 'Modelli, budget e runtime', icon: <Bot className="h-4 w-4" /> },
        { href: '#data', label: 'Dati locali', description: 'Farmaci ed esenzioni', icon: <Database className="h-4 w-4" /> },
        { href: '#operations', label: 'Operatività', description: 'Diagnostica e strumenti', icon: <Server className="h-4 w-4" /> },
        { href: '#backups', label: 'Backup', description: 'Schedulazione e restore', icon: <Download className="h-4 w-4" /> },
    ];

    return (
        <div className="space-y-8 pb-10">
            <div className="glass-panel liquid-hero p-6 md:p-8">
                <div className="liquid-orb -left-10 top-0 h-32 w-32 bg-sky-300/35" />
                <div className="liquid-orb right-4 top-6 h-28 w-28 bg-violet-300/28" />
                <div className="liquid-orb bottom-4 left-1/3 h-24 w-24 bg-emerald-200/20" />

                <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-4">
                        <div className="section-kicker">Centro di controllo</div>
                        <div>
                            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-4xl">
                                Impostazioni
                            </h1>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                                Un’unica shell per configurazione locale, AI, cataloghi, backup e manutenzione. La logica resta invariata; qui stiamo rendendo piu chiari ritmo, priorita e disposizione delle isole.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2.5">
                            <span className="apple-chip">
                                <Shield className="h-3.5 w-3.5 text-amber-500" />
                                Sicurezza locale
                            </span>
                            <span className="apple-chip">
                                <Bot className="h-3.5 w-3.5 text-indigo-500" />
                                Runtime AI
                            </span>
                            <span className="apple-chip">
                                <Database className="h-3.5 w-3.5 text-emerald-500" />
                                Cataloghi offline
                            </span>
                            <span className="apple-chip">
                                <Download className="h-3.5 w-3.5 text-sky-500" />
                                Backup & restore
                            </span>
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="apple-subsection min-w-[210px]">
                            <p className="section-kicker">Utente corrente</p>
                            <p className="mt-2 text-base font-semibold text-slate-900 dark:text-white">{user?.displayName || 'Admin'}</p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{user?.ambulatoryName || 'Ambulatorio non impostato'}</p>
                        </div>
                        <div className="apple-subsection min-w-[210px]">
                            <p className="section-kicker">Approccio</p>
                            <p className="mt-2 text-base font-semibold text-slate-900 dark:text-white">Local-first</p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Contenuto al centro, strumenti raccolti in famiglie operative.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="xl:hidden">
                <div className="glass-panel p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <p className="section-kicker">Famiglie</p>
                            <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Salti rapidi</h2>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Scorri orizzontalmente</p>
                    </div>
                    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                        {railItems.map((item) => (
                            <SettingsRailLink key={item.href} {...item} compact />
                        ))}
                    </div>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[230px_minmax(0,1fr)]">
                <aside className="hidden xl:block">
                    <div className="glass-panel sticky top-6 p-4">
                        <div className="mb-4">
                            <p className="section-kicker">Navigazione</p>
                            <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Famiglie impostazioni</h2>
                        </div>
                        <div className="space-y-3">
                            {railItems.map((item) => (
                                <SettingsRailLink key={item.href} {...item} />
                            ))}
                        </div>
                    </div>
                </aside>

                <div className="space-y-10">
                    <section id="appearance" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="Interfaccia"
                            title="Stile visivo"
                            description="Scegli se usare una UI piu clinica e istituzionale oppure una variante piu massimalista, piu liquid e piu playful. La preferenza resta locale e persistente."
                        />

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className={SETTINGS_CARD_CLASS}>
                                <div className="mb-6 flex items-center gap-3">
                                    <div className="rounded-lg bg-sky-100 p-2 text-sky-600">
                                        <Sparkles className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Modalita interfaccia</h2>
                                        <p className="text-xs text-gray-500">Due grammatiche diverse, stesso prodotto.</p>
                                    </div>
                                </div>

                                <div className="grid gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setUIStyleMode('clinical')}
                                        className={cn(
                                            "rounded-[24px] border px-4 py-4 text-left transition-[border-color,background-color,box-shadow,transform]",
                                            uiStyleMode === 'clinical'
                                                ? "border-sky-300/80 bg-white shadow-[0_14px_28px_rgba(10,132,255,0.12)] dark:border-sky-500/20 dark:bg-white/10"
                                                : "border-white/70 bg-white/76 hover:border-slate-200 hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white">Clinico</p>
                                                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Piu paper-first, piu denso, piu istituzionale. Ottimizzato per scansione rapida e calma operativa.</p>
                                            </div>
                                            {uiStyleMode === 'clinical' ? <CheckCircle className="mt-0.5 h-4 w-4 text-sky-600 dark:text-sky-300" /> : null}
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setUIStyleMode('liquid')}
                                        className={cn(
                                            "rounded-[28px] border px-4 py-4 text-left transition-[border-color,background-color,box-shadow,transform]",
                                            uiStyleMode === 'liquid'
                                                ? "border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.86),rgba(255,255,255,0.62))] shadow-[0_24px_48px_rgba(10,132,255,0.14)] backdrop-blur-xl dark:border-white/15 dark:bg-white/10"
                                                : "border-white/70 bg-white/76 hover:-translate-y-0.5 hover:border-white hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="bg-[linear-gradient(135deg,#0A84FF,#5AC8FA_55%,#5E5CE6)] bg-clip-text text-sm font-semibold text-transparent">Liquid</p>
                                                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Piu massimalista, piu materica, piu vicina a Play, Sleeve e Craft. Tiene il delight nel chrome, non nel dato clinico.</p>
                                            </div>
                                            {uiStyleMode === 'liquid' ? <CheckCircle className="mt-0.5 h-4 w-4 text-sky-500 dark:text-sky-300" /> : null}
                                        </div>
                                    </button>
                                </div>
                            </div>

                            <div className="apple-subsection">
                                <p className="section-kicker">Stato corrente</p>
                                <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                                    {uiStyleMode === 'liquid' ? 'Liquid attivo' : 'Clinico attivo'}
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                    {uiStyleMode === 'liquid'
                                        ? 'Shell, hero e superfici principali spingono di piu su glass, profondita, curvature morbide e presence.'
                                        : "L'interfaccia resta piu sobria, piu densa e piu focalizzata sul dato operativo."}
                                </p>
                                <div className="mt-5 flex flex-wrap gap-2.5">
                                    <span className="apple-chip">
                                        <Sparkles className="h-3.5 w-3.5 text-sky-500" />
                                        {uiStyleMode === 'liquid' ? 'Massimalismo controllato' : 'Sobrieta operativa'}
                                    </span>
                                    <span className="apple-chip">
                                        <Shield className="h-3.5 w-3.5 text-emerald-500" />
                                        Preferenza locale persistente
                                    </span>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section id="account" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="Account"
                            title="Profilo e accesso"
                            description="Dati personali e controllo del PIN raccolti in un’unica area, cosi le impostazioni identitarie non competono con la diagnostica o con gli strumenti di sistema."
                        />

                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* --- Profile Section --- */}
                <div className={SETTINGS_CARD_CLASS}>
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
                            <label htmlFor="doctor-name" className={SETTINGS_LABEL_CLASS}>
                                Nome Medico
                            </label>
                            <input
                                id="doctor-name"
                                name="doctorName"
                                type="text"
                                value={profile.doctorName}
                                onChange={(e) => setProfile({ ...profile, doctorName: e.target.value })}
                                placeholder="es. Dr. Mario Rossi"
                                autoComplete="name"
                                className={SETTINGS_INPUT_CLASS}
                            />
                        </div>

                        <div>
                            <label htmlFor="clinic-name" className={SETTINGS_LABEL_CLASS}>
                                Nome Ambulatorio
                            </label>
                            <input
                                id="clinic-name"
                                name="clinicName"
                                type="text"
                                value={profile.clinicName}
                                onChange={(e) => setProfile({ ...profile, clinicName: e.target.value })}
                                placeholder="es. Studio Medico Centro"
                                autoComplete="organization"
                                className={SETTINGS_INPUT_CLASS}
                            />
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={saveProfile}
                                disabled={isSavingProfile}
                                className={SETTINGS_TONED_BUTTON_CLASS.emerald}
                            >
                                <Save className="w-4 h-4" />
                                {isSavingProfile ? 'Salvataggio...' : 'Salva Profilo'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* --- Security Section --- */}
                <div className={SETTINGS_CARD_CLASS}>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
                            <Shield className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Sicurezza</h2>
                            <p className="text-xs text-gray-500">Ruota il PIN senza rigenerare i dati clinici.</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="current-pin" className={SETTINGS_LABEL_CLASS}>
                                PIN attuale
                            </label>
                            <input
                                id="current-pin"
                                name="currentPin"
                                type="password"
                                inputMode="numeric"
                                value={pinForm.currentPin}
                                onChange={(e) => setPinForm({ ...pinForm, currentPin: e.target.value })}
                                placeholder="Inserisci il PIN attuale"
                                autoComplete="current-password"
                                spellCheck={false}
                                className={SETTINGS_INPUT_CLASS}
                            />
                        </div>

                        <div>
                            <label htmlFor="new-pin" className={SETTINGS_LABEL_CLASS}>
                                Nuovo PIN
                            </label>
                            <input
                                id="new-pin"
                                name="newPin"
                                type="password"
                                inputMode="numeric"
                                value={pinForm.newPin}
                                onChange={(e) => setPinForm({ ...pinForm, newPin: e.target.value })}
                                placeholder="4-8 caratteri"
                                autoComplete="new-password"
                                spellCheck={false}
                                className={SETTINGS_INPUT_CLASS}
                            />
                        </div>

                        <div>
                            <label htmlFor="confirm-pin" className={SETTINGS_LABEL_CLASS}>
                                Conferma nuovo PIN
                            </label>
                            <input
                                id="confirm-pin"
                                name="confirmPin"
                                type="password"
                                inputMode="numeric"
                                value={pinForm.confirmPin}
                                onChange={(e) => setPinForm({ ...pinForm, confirmPin: e.target.value })}
                                placeholder="Ripeti il nuovo PIN"
                                autoComplete="new-password"
                                spellCheck={false}
                                className={SETTINGS_INPUT_CLASS}
                            />
                        </div>

                        <p className="text-xs text-gray-500">
                            Il cambio PIN fa il re-wrap della stessa master key: i dati restano leggibili, ma dal prossimo unlock servirà il nuovo PIN.
                        </p>

                        {pinFeedback && (
                            <div className={cn(
                                'rounded-lg border px-3 py-2 text-xs',
                                pinFeedback.tone === 'success'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-red-200 bg-red-50 text-red-700'
                            )}>
                                {pinFeedback.message}
                            </div>
                        )}

                        <div className="pt-2">
                            <button
                                onClick={handleChangePin}
                                disabled={isChangingPin}
                                className={SETTINGS_TONED_BUTTON_CLASS.amber}
                            >
                                <Shield className="w-4 h-4" />
                                {isChangingPin ? 'Aggiornamento...' : 'Aggiorna PIN'}
                            </button>
                        </div>
                    </div>
                </div>
                        </div>
                    </section>

                    <section id="ai" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="AI"
                            title="Modelli, ruoli e runtime locale"
                            description="Qui la pagina smette di essere un mosaico di box uguali e diventa una sequenza: profilo hardware, ruoli clinici, budget insight, runtime e diagnostica."
                        />

                {/* --- AI Config Section --- */}
                <div className={SETTINGS_CARD_CLASS}>
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
                        <div className={SETTINGS_SECTION_CARD_CLASS}>
                            <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                                <Cpu className="w-4 h-4" />
                                Profilo Hardware
                            </label>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div
                                    onClick={() => applyHardwareProfile('low')}
                                    className={cn(
                                        "rounded-[22px] border px-4 py-4 cursor-pointer transition-[border-color,background-color,box-shadow,transform]",
                                        hardwareProfile === 'low'
                                            ? "border-emerald-300/80 bg-emerald-50/75 shadow-[0_14px_28px_rgba(16,185,129,0.12)] dark:border-emerald-500/20 dark:bg-emerald-900/10"
                                            : "border-white/70 bg-white/76 shadow-[0_10px_22px_rgba(15,23,42,0.04)] hover:-translate-y-0.5 hover:border-white hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                                    )}
                                >
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-200">Light</span>
                                        {hardwareProfile === 'low' && <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-200" />}
                                    </div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">&lt; 16GB RAM</p>
                                    <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">Usa solo modelli molto compressi (Q4_K_M).</p>
                                </div>

                                <div
                                    onClick={() => applyHardwareProfile('medium')}
                                    className={cn(
                                        "rounded-[22px] border px-4 py-4 cursor-pointer transition-[border-color,background-color,box-shadow,transform]",
                                        hardwareProfile === 'medium'
                                            ? "border-indigo-300/80 bg-indigo-50/75 shadow-[0_14px_28px_rgba(79,70,229,0.12)] dark:border-indigo-500/20 dark:bg-indigo-900/10"
                                            : "border-white/70 bg-white/76 shadow-[0_10px_22px_rgba(15,23,42,0.04)] hover:-translate-y-0.5 hover:border-white hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                                    )}
                                >
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-indigo-700 dark:text-indigo-200">Balanced</span>
                                        {hardwareProfile === 'medium' && <CheckCircle className="w-4 h-4 text-indigo-600 dark:text-indigo-200" />}
                                    </div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">16-32GB RAM</p>
                                    <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">Qwen 14B per sintesi e reasoning.</p>
                                </div>

                                <div
                                    onClick={() => applyHardwareProfile('high')}
                                    className={cn(
                                        "rounded-[22px] border px-4 py-4 cursor-pointer transition-[border-color,background-color,box-shadow,transform]",
                                        hardwareProfile === 'high'
                                            ? "border-violet-300/80 bg-violet-50/75 shadow-[0_14px_28px_rgba(139,92,246,0.12)] dark:border-violet-500/20 dark:bg-violet-900/10"
                                            : "border-white/70 bg-white/76 shadow-[0_10px_22px_rgba(15,23,42,0.04)] hover:-translate-y-0.5 hover:border-white hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                                    )}
                                >
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-700 dark:text-violet-200">Pro</span>
                                        {hardwareProfile === 'high' && <CheckCircle className="w-4 h-4 text-violet-600 dark:text-violet-200" />}
                                    </div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">&gt; 32GB RAM</p>
                                    <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">Qwen 3.5 35B A3B per tutte le superfici text-only.</p>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-2 md:grid-cols-2">
                                <p className="rounded-[18px] border border-sky-200/60 bg-sky-50/80 px-3 py-2 text-xs leading-5 text-sky-700 dark:border-sky-500/20 dark:bg-sky-900/10 dark:text-sky-200">
                                    Per usare provider non locali serve connettivita attiva e relativa configurazione API.
                                </p>
                                <p className="rounded-[18px] border border-slate-200/70 bg-white/72 px-3 py-2 text-xs leading-5 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                                    Il profilo hardware sovrascrive i modelli selezionati. Passa a configurazione personalizzata se vuoi controllo manuale.
                                </p>
                            </div>
                        </div>

                        {/* 2. Task Assignment with Model Selector */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
                                <Bot className="w-4 h-4" />
                                Ruoli del Team AI
                            </h3>

                            <ModelSelector
                                selectorId="clinical"
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
                                targetUrl={aiConfig.url}
                            />

                            <ModelSelector
                                selectorId="reasoning"
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
                                targetUrl={aiConfig.url}
                            />

                            <ModelSelector
                                selectorId="ocr"
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
                                targetUrl={aiConfig.url}
                            />

                            <AiRolloutGuardNotice
                                selections={[
                                    {
                                        roleId: 'clinical',
                                        roleLabel: 'Radiologo & Clinico',
                                        model: aiConfig.model_clinical,
                                    },
                                    {
                                        roleId: 'reasoning',
                                        roleLabel: 'Internista (Reasoning)',
                                        model: aiConfig.model_reasoning,
                                    },
                                ]}
                            />
                        </div>

                        {/* @Codex */}
                        <div className="rounded-[24px] border border-indigo-100/80 bg-indigo-50/45 p-4 shadow-[0_12px_24px_rgba(79,70,229,0.06)] space-y-4 dark:border-indigo-500/20 dark:bg-indigo-900/10">
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
                                                "rounded-[18px] border px-3 py-3 text-left transition-colors",
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

                            <div
                                className={cn(
                                    "rounded-[20px] border p-4 shadow-[0_10px_22px_rgba(79,70,229,0.06)]",
                                    patientInsightEnabled
                                        ? "border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-900/10"
                                        : "border-red-200/70 bg-red-50/75 dark:border-red-500/20 dark:bg-red-900/10"
                                )}
                                data-testid="patient-insight-kill-switch-card"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-bold text-slate-900 dark:text-white">Kill switch locale</p>
                                        <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                                            Se spento, la scheda paziente non avvia nuovi insight e il path runtime rifiuta la generazione in modo deterministico.
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <label
                                            htmlFor="patientInsightKillSwitch"
                                            className={cn(
                                                "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
                                                patientInsightEnabled
                                                    ? "border-emerald-200 bg-white text-emerald-700 dark:border-emerald-500/20 dark:bg-white/10 dark:text-emerald-200"
                                                    : "border-red-200 bg-white text-red-700 dark:border-red-500/20 dark:bg-white/10 dark:text-red-200"
                                            )}
                                        >
                                            {patientInsightEnabled ? 'Enabled' : 'Disabled'}
                                        </label>
                                        <input
                                            id="patientInsightKillSwitch"
                                            type="checkbox"
                                            checked={!patientInsightEnabled}
                                            onChange={(e) => setPatientInsightEnabled(!e.target.checked)}
                                            aria-label="Disabilita Patient Insight localmente"
                                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-white/10 dark:bg-white/5"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div
                                className={cn(
                                    "rounded-[20px] border p-4 shadow-[0_10px_22px_rgba(79,70,229,0.06)]",
                                    documentSynthesisEnabled
                                        ? "border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-900/10"
                                        : "border-red-200/70 bg-red-50/75 dark:border-red-500/20 dark:bg-red-900/10"
                                )}
                                data-testid="document-synthesis-kill-switch-card"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-bold text-slate-900 dark:text-white">Kill switch Document Synthesis</p>
                                        <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                                            Se spento, OCR e import base restano disponibili, ma il path runtime rifiuta analisi clinica e archivio intelligente del documento in modo deterministico.
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <label
                                            htmlFor="documentSynthesisKillSwitch"
                                            className={cn(
                                                "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
                                                documentSynthesisEnabled
                                                    ? "border-emerald-200 bg-white text-emerald-700 dark:border-emerald-500/20 dark:bg-white/10 dark:text-emerald-200"
                                                    : "border-red-200 bg-white text-red-700 dark:border-red-500/20 dark:bg-white/10 dark:text-red-200"
                                            )}
                                        >
                                            {documentSynthesisEnabled ? 'Enabled' : 'Disabled'}
                                        </label>
                                        <input
                                            id="documentSynthesisKillSwitch"
                                            type="checkbox"
                                            checked={!documentSynthesisEnabled}
                                            onChange={(e) => setDocumentSynthesisEnabled(!e.target.checked)}
                                            aria-label="Disabilita Document Synthesis localmente"
                                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-white/10 dark:bg-white/5"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div
                                className={cn(
                                    "rounded-[20px] border p-4 shadow-[0_10px_22px_rgba(79,70,229,0.06)]",
                                    smartImportEnabled
                                        ? "border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-900/10"
                                        : "border-red-200/70 bg-red-50/75 dark:border-red-500/20 dark:bg-red-900/10"
                                )}
                                data-testid="smart-import-kill-switch-card"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-bold text-slate-900 dark:text-white">Kill switch Smart Import</p>
                                        <p className="mt-1 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                                            Se spento, il pannello paziente non avvia analisi Smart Import e il path runtime rifiuta sia generate sia apply in modo deterministico.
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <label
                                            htmlFor="smartImportKillSwitch"
                                            className={cn(
                                                "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
                                                smartImportEnabled
                                                    ? "border-emerald-200 bg-white text-emerald-700 dark:border-emerald-500/20 dark:bg-white/10 dark:text-emerald-200"
                                                    : "border-red-200 bg-white text-red-700 dark:border-red-500/20 dark:bg-white/10 dark:text-red-200"
                                            )}
                                        >
                                            {smartImportEnabled ? 'Enabled' : 'Disabled'}
                                        </label>
                                        <input
                                            id="smartImportKillSwitch"
                                            type="checkbox"
                                            checked={!smartImportEnabled}
                                            onChange={(e) => setSmartImportEnabled(!e.target.checked)}
                                            aria-label="Disabilita Smart Import localmente"
                                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-white/10 dark:bg-white/5"
                                        />
                                    </div>
                                </div>
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
                                            className={`mt-1 ${SETTINGS_INPUT_CLASS}`}
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
                                            className={`mt-1 ${SETTINGS_INPUT_CLASS}`}
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
                                            className={`mt-1 ${SETTINGS_INPUT_CLASS}`}
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
                                            className={`mt-1 ${SETTINGS_INPUT_CLASS}`}
                                        />
                                    </label>
                                </div>
                            )}
                        </div>

                        {/* 3. Provider & Infrastructure */}
                        <div className="apple-subsection space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <label className="section-kicker">
                                    Infrastruttura
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="advancedFit"
                                        checked={showAdvanced}
                                        onChange={(e) => setShowAdvanced(e.target.checked)}
                                        className="sr-only"
                                    />
                                    <label
                                        htmlFor="advancedFit"
                                        className={cn(
                                            "inline-flex cursor-pointer select-none items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-medium transition-colors",
                                            showAdvanced
                                                ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-900/10 dark:text-indigo-200"
                                                : "border-slate-200/70 bg-white/72 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
                                        )}
                                    >
                                        Avanzate
                                    </label>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="flex items-center rounded-[18px] border border-slate-200/70 bg-white/72 px-3 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                                    Provider AI: <span className="ml-2 font-semibold text-slate-900 dark:text-white">Ollama (Locale)</span>
                                </div>
                                <input
                                    type="text"
                                    value={aiConfig.url}
                                    onChange={(e) => setAiConfig({ ...aiConfig, url: e.target.value })}
                                    placeholder="http://127.0.0.1:11434/v1"
                                    className={`${SETTINGS_INPUT_CLASS} font-mono text-xs`}
                                />
                            </div>

                            {showAdvanced && (
                                <div className="rounded-[20px] border border-dashed border-slate-200/80 bg-white/55 p-4 dark:border-white/10 dark:bg-white/5">
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
                                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 dark:border-white/10 dark:bg-white/5"
                                        />
                                        <label htmlFor="dockerMode" className="cursor-pointer text-xs leading-5 text-slate-500 dark:text-slate-400">
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
                                className={SETTINGS_TONED_BUTTON_CLASS.indigo}
                            >
                                <Save className="w-4 h-4" />
                                {isSavingAi ? 'Salvataggio...' : 'Salva Configurazione'}
                            </button>

                            <button
                                onClick={testAiConnection}
                                className={SETTINGS_SECONDARY_BUTTON_CLASS}
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
                                "animate-in slide-in-from-top-2 fade-in rounded-[22px] border p-4 text-sm space-y-2 shadow-[0_10px_22px_rgba(15,23,42,0.04)]",
                                aiHealth.status === 'ok'
                                    ? "border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-900/10 dark:text-emerald-200"
                                    : "border-red-200/70 bg-red-50/80 text-red-800 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-200"
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
                            <div className="flex items-center gap-2 rounded-[18px] border border-emerald-200/70 bg-emerald-50/80 p-3 text-xs text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-900/10 dark:text-emerald-200">
                                <CheckCircle className="w-4 h-4" />
                                Connessione a Ollama riuscita!
                            </div>
                        )}
                        {aiTestStatus === 'error' && (
                            <div className="flex items-center gap-2 rounded-[18px] border border-red-200/70 bg-red-50/80 p-3 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-200">
                                <AlertTriangle className="w-4 h-4" />
                                Impossibile connettersi. Controlla che Ollama sia attivo.
                            </div>
                        )}

                        <AiModelParliamentPanel />
                        <AiRolloutReadinessPanel />
                    </div>
                </div>
                    </section>

                    <section id="data" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="Dati locali"
                            title="Cataloghi offline"
                            description="Farmaci ed esenzioni vivono nello stesso dominio visivo, invece di apparire come strumenti scollegati. Qui il focus e sulla manutenzione del dato locale."
                        />

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {/* --- AIFA Database Section --- */}
                <div className={SETTINGS_CARD_CLASS}>
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
                        <div className="rounded-[22px] border border-blue-200/60 bg-blue-50/80 p-4 flex items-center justify-between dark:border-blue-500/20 dark:bg-blue-900/10">
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
                                    className="w-full flex items-center justify-center gap-2 rounded-[22px] border-2 border-dashed border-slate-300 bg-white/72 px-4 py-3 text-slate-600 shadow-[0_10px_22px_rgba(15,23,42,0.04)] transition-[border-color,background-color,color,box-shadow] hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/70 dark:border-white/15 dark:bg-white/5 dark:text-slate-300 dark:hover:border-blue-500/30 dark:hover:bg-blue-900/10"
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
                                        <div className="bg-blue-600 h-2.5 rounded-full transition-[width] duration-300 progress-bar-width" data-progress={progress}></div>
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
                        </div>
                    </section>

                    <section id="operations" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="Operatività"
                            title="Sistema e manutenzione"
                            description="Diagnostica, architettura servizi e strumenti secondari stanno insieme, cosi non invadono le aree di configurazione clinica e account."
                        />

                {/* --- System & Maintenance Section --- */}
                <div className="space-y-6">
                    {isPreviewProfilesEnabled ? (
                        <div className={SETTINGS_CARD_CLASS}>
                            <div className="mb-6 flex items-center gap-3">
                                <div className="rounded-lg bg-sky-100 p-2 text-sky-600">
                                    <Server className="h-6 w-6" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Dev Preview Profiles</h2>
                                    <p className="text-xs text-gray-500">
                                        Seleziona stack sperimentali locali senza cambiare checkout dall&apos;app.
                                    </p>
                                </div>
                            </div>

                            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                                <div className="space-y-4">
                                    <div>
                                        <label className={SETTINGS_LABEL_CLASS}>Preview Profile</label>
                                        <select
                                            value={selectedPreviewProfileId}
                                            onChange={(event) => setSelectedPreviewProfileId(event.target.value as PreviewProfileId)}
                                            className={SETTINGS_INPUT_CLASS}
                                        >
                                            {availableProfiles.map((profileOption) => (
                                                <option key={profileOption.id} value={profileOption.id}>
                                                    {profileOption.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="rounded-[22px] border border-slate-200/70 bg-white/76 p-4 shadow-[0_10px_22px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-white/5">
                                        <p className="section-kicker">Profilo selezionato</p>
                                        <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-white">
                                            {selectedPreviewProfile.label}
                                        </h3>
                                        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                            {selectedPreviewProfile.description}
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <span className="apple-chip">Origine {selectedPreviewProfile.sourceBranch}</span>
                                            {selectedPreviewProfile.featureFlags.length > 0 ? (
                                                selectedPreviewProfile.featureFlags.map((flag) => (
                                                    <span key={flag} className="apple-chip">
                                                        {PREVIEW_PROFILE_FLAG_LABELS[flag]}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="apple-chip">Nessun toggle sperimentale</span>
                                            )}
                                        </div>
                                        {selectedPreviewProfile.notes ? (
                                            <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                                {selectedPreviewProfile.notes}
                                            </p>
                                        ) : null}
                                    </div>

                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                        <button
                                            type="button"
                                            onClick={() => applyProfile(selectedPreviewProfile.id)}
                                            disabled={isApplyingPreviewProfile || selectedPreviewProfile.id === activeProfile.id}
                                            className={SETTINGS_PRIMARY_BUTTON_CLASS}
                                        >
                                            <RefreshCw className={cn('h-4 w-4', isApplyingPreviewProfile ? 'animate-spin' : '')} />
                                            {selectedPreviewProfile.id === activeProfile.id ? 'Profilo attivo' : 'Applica e ricarica'}
                                        </button>
                                        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                                            Disponibile solo in dev. La slice attuale usa il checkout corrente e lascia `targetUrl` come estensione futura.
                                        </p>
                                    </div>
                                </div>

                                <div className="rounded-[24px] border border-sky-200/60 bg-sky-50/70 p-5 shadow-[0_12px_28px_rgba(14,165,233,0.08)] dark:border-sky-500/20 dark:bg-sky-900/10">
                                    <p className="section-kicker">Profilo attivo</p>
                                    <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-white">
                                        {activeProfile.label}
                                    </h3>
                                    <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                        {activeProfile.description}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <ServiceArchitecturePanel />
                    <DiagnosticHub />

                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                        {/* Ambulatory Management */}
                        <div className="apple-subsection flex flex-col justify-between">
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
                                <a href="/settings/ambulatories" className="inline-flex items-center gap-2 rounded-full border border-blue-200/70 bg-blue-50/80 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-900/10 dark:text-blue-200 dark:hover:bg-blue-900/20">
                                    Apri Gestione &rarr;
                                </a>
                            </div>
                        </div>

                        {/* Developer Tools */}
                        <div className="apple-subsection flex flex-col justify-between">
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
                        <div className="apple-subsection flex flex-col justify-between">
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
                                    className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/76 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10 disabled:text-slate-400"
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
                    </div>

                    {/* Danger Zone */}
                    <div className="rounded-[28px] border border-red-200/60 bg-[linear-gradient(135deg,rgba(254,242,242,0.94),rgba(255,255,255,0.82))] p-6 shadow-[0_16px_32px_rgba(185,28,28,0.08)] dark:border-red-500/20 dark:bg-red-900/10">
                        <div className="mb-6 flex items-start gap-4">
                            <div className="rounded-2xl bg-red-100 p-2.5 text-red-600 dark:bg-red-500/15 dark:text-red-200">
                                <AlertTriangle className="w-6 h-6" />
                            </div>
                            <div>
                                <p className="section-kicker">Zona Pericolo</p>
                                <h3 className="mt-1 font-semibold text-slate-900 dark:text-white">Azioni irreversibili</h3>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Separata dal resto delle isole operative per non competere visivamente con diagnostica e strumenti quotidiani.</p>
                            </div>
                        </div>

                        <div className="mb-6 rounded-[22px] border border-yellow-200/70 bg-yellow-50/80 p-4 dark:border-yellow-500/20 dark:bg-yellow-900/10">
                            <div className="flex gap-3">
                                <div className="flex-shrink-0">
                                    <AlertTriangle className="h-5 w-5 text-yellow-500" />
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                        Provider locale consigliato: Ollama.
                                    </p>
                                    <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-200">
                                        Modificando queste impostazioni potresti interrompere il collegamento con l&apos;AI.
                                        Assicurati che il server Ollama sia attivo su <code>{aiConfig.url || "localhost:11434"}</code>.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-4 rounded-[22px] border border-red-100 bg-white/78 p-4 shadow-[0_10px_22px_rgba(185,28,28,0.06)] dark:border-red-900/50 dark:bg-red-950/20 md:flex-row md:items-center md:justify-between">
                            <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-red-100">Reset Onboarding</p>
                                <p className="text-xs text-slate-500 dark:text-red-200/70">Cancella profilo utente e chiavi. I pazienti restano invariati.</p>
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
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-600 shadow-sm transition-[border-color,background-color,color,box-shadow] hover:bg-red-600 hover:text-white dark:border-red-500/30 dark:bg-red-950/10 dark:text-red-200 dark:hover:bg-red-600"
                            >
                                Reset Completo
                            </button>
                        </div>
                    </div>
                </div>
                    </section>

                    <section id="backups" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="Backup"
                            title="Continuità e ripristino"
                            description="Schedulazione e restore diventano una famiglia dedicata: importante, ma non concorrente con account, AI o manutenzione quotidiana."
                        />
                        <div className="space-y-6">
                            <BackupSchedulerUI />
                            <BackupRestoreUI />
                        </div>
                    </section>
                </div>
            </div>
        </div >
    );
}
