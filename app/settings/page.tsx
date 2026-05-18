'use client';

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import {
    AI_INSIGHT_MODE_OPTIONS,
} from '@/lib/ai-insight-settings';
import { Upload, Database, Bot, Save, RefreshCw, AlertTriangle, CheckCircle, Server, User, Cpu, Download, Check, Shield, Sparkles, Activity, KeyRound, Wrench, ChevronDown, Stethoscope, Eye, EyeOff } from 'lucide-react';
import BackupRestoreUI from '@/components/backup-restore-ui';
import BackupSchedulerUI from '@/components/backup-scheduler-ui';
import DataSeeder from '@/components/data-seeder';
import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
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
import NetworkOperatingModePanel from '@/components/settings/network-operating-mode-panel';
/* @Codex */
import UpdateAwarenessPanel from '@/components/settings/update-awareness-panel';
import { useUIAccessibility } from '@/components/ui-accessibility-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { usePrivacy } from '@/components/privacy-provider';

// --- Model Selector Component ---
interface ModelSelectorProps {
    selectorId: 'clinical' | 'reasoning' | 'ocr';
    label: string;
    description: string;
    icon: ReactNode;
    value: string;
    onChange: (val: string) => void;
    recommended: { name: string; desc: string }[];
    provider: string;
    targetUrl: string;
}

function ModelSelector({ selectorId, label, description, icon, value, onChange, recommended, provider, targetUrl }: ModelSelectorProps) {
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

    const modelSelectorTone = {
        iconStyle: { background: 'rgba(15, 23, 42, 0.06)', color: 'var(--mf-ink)' },
        titleStyle: { color: 'var(--mf-ink)' },
        descriptionStyle: { color: 'var(--mf-muted)' },
        selectedCardStyle: { borderColor: 'rgba(15, 23, 42, 0.22)', background: 'rgba(248, 250, 252, 0.9)', boxShadow: '0 14px 28px rgba(15, 23, 42, 0.08)' },
        selectedDot: 'bg-white',
        installedBadgeStyle: { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(248, 250, 252, 0.9)', color: 'var(--mf-ink)' },
        downloadBadgeStyle: { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(248, 250, 252, 0.72)', color: 'var(--mf-ink)' },
        progressStyle: { background: 'linear-gradient(90deg, #111827, #475569)' },
    };
    const c = modelSelectorTone;

    return (
        <div className="apple-subsection space-y-4" data-testid={`ai-model-selector-${selectorId}`}>
            {/* @Codex WUL-229 — selector header now uses MediFlow icon disc + ink/muted typography */}
            <div className="flex items-start gap-3">
                <div className="rounded-2xl p-2.5" style={c.iconStyle}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold" style={c.titleStyle}>{label}</h4>
                    <p className="mt-1 text-[11px] leading-5" style={c.descriptionStyle}>{description}</p>
                </div>
            </div>

            <div className="space-y-2">
                {!showCustom ? (
                    <div className="grid gap-2">
                        {recommended.map((model) => {
                            const installed = isInstalled(model.name);
                            const selected = value === model.name;

                            return (
                                // @Codex WUL-229 — option card switches to mf-option-card primitive with style-driven selection accent
                                <div
                                    key={model.name}
                                    onClick={() => onChange(model.name)}
                                    className={cn('mf-option-card relative flex items-center justify-between gap-3 !px-3.5 !py-3', selected && 'is-active z-10')}
                                    style={selected ? c.selectedCardStyle : undefined}
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div
                                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                                            style={selected
                                                ? { borderColor: 'var(--mf-ink)', background: 'var(--mf-ink)' }
                                                : { borderColor: 'rgba(112,106,100,0.28)' }}
                                        >
                                            {selected && <div className={`h-1.5 w-1.5 rounded-full ${c.selectedDot}`} />}
                                        </div>
                                        <div className="min-w-0">
                                            <span className="block truncate text-xs font-semibold" style={{ color: 'var(--mf-ink)' }}>{model.name}</span>
                                            <span className="mt-0.5 block text-[11px] leading-5" style={{ color: 'var(--mf-muted)' }}>{model.desc}</span>
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        {installed ? (
                                            <span
                                                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold"
                                                style={c.installedBadgeStyle}
                                            >
                                                <Check className="w-3 h-3" /> Installato
                                            </span>
                                        ) : (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePull(model.name);
                                                }}
                                                disabled={isPulling}
                                                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:opacity-60"
                                                style={c.downloadBadgeStyle}
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

                        {/* @Codex WUL-229 — secondary toggles use mf-btn-secondary */}
                        <button
                            onClick={() => setShowCustom(true)}
                            className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, 'justify-center border-dashed')}
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
                            className={SETTINGS_SECONDARY_BUTTON_CLASS}
                        >
                            Torna ai consigliati
                        </button>
                    </div>
                )}
            </div>

            {/* Global Pull Status */}
            {isPulling && (
                // @Codex WUL-229 — pull status card now uses the shared liquid section primitive
                <div className="mf-section mf-section-tight animate-in fade-in slide-in-from-bottom-2 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--mf-ink)' }}>
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Scaricamento {pullingModel ? `di ${pullingModel}` : 'in corso'}
                        </span>
                        <span className="text-xs font-mono" style={{ color: 'var(--mf-muted)' }}>{pullProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'rgba(112,106,100,0.18)' }}>
                        <div
                            className="h-full transition-[width] duration-300"
                            style={{ width: `${pullProgress}%`, ...c.progressStyle }}
                        />
                    </div>
                    <p className="mt-2 truncate text-[11px]" style={{ color: 'var(--mf-muted)' }}>{pullStatus}</p>
                </div>
            )}
        </div>
    );
}

/* @Codex WUL-229 — settings primitives now defer to the liquid-glass tier classes from globals.css */
const SETTINGS_CARD_CLASS = 'mf-section p-6 md:p-7';
const SETTINGS_SECTION_CARD_CLASS = 'mf-section mf-section-tight p-5 md:p-6';
const SETTINGS_INPUT_CLASS = 'mf-input';
const SETTINGS_LABEL_CLASS = 'mf-field-label';
const SETTINGS_PRIMARY_BUTTON_CLASS = 'ui-btn-primary px-5 py-2.5 disabled:opacity-50';
const SETTINGS_SECONDARY_BUTTON_CLASS = 'mf-btn-secondary';

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
        // @Codex WUL-229 — section intro now uses MediFlow ink/muted tokens for headings
        <div className="space-y-1">
            <p className="section-kicker">{kicker}</p>
            <h2 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--mf-ink)' }}>{title}</h2>
            <p className="max-w-3xl text-sm leading-6" style={{ color: 'var(--mf-muted)' }}>{description}</p>
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
    const { user, updateUser, changePin } = useSecurity();
    const { isPrivacyMode, togglePrivacyMode } = usePrivacy();
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
    const {
        reduceMotion,
        setReduceMotion,
    } = useUIAccessibility();

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
    const settingsNavItems = [
        { href: '#status', label: 'Stato', meta: 'locale' },
        { href: '#account', label: 'Account', meta: 'profilo' },
        { href: '#ai', label: 'AI locale', meta: 'modelli' },
        { href: '#backups', label: 'Backup', meta: 'archivi' },
        { href: '#data', label: 'Cataloghi', meta: 'farmaci' },
        { href: '#operations', label: 'Servizi', meta: 'locale' },
        { href: '#appearance', label: 'Lettura', meta: 'tema' },
    ];

    return (
        <Kree8WorkspaceShell
            eyebrow="Sistema"
            title="Impostazioni"
            subtitle="Accesso, AI locale, backup, cataloghi e servizi del Mac che ospita MediFlow."
            backHref="/"
            backLabel="Torna ai pazienti"
            statusLabel="I dati clinici e i servizi restano locali."
            navItems={settingsNavItems}
        >
            <section id="status" className="patient-detail-section mf-section p-6 md:p-8 scroll-mt-24">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
                    <div>
                        <p className="section-kicker">Postazione locale</p>
                        <h2 className="mt-1 text-xl font-semibold tracking-tight" style={{ color: 'var(--mf-ink)' }}>
                            Stato operativo
                        </h2>
                        <p className="mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--mf-muted)' }}>
                            Da qui si regolano accesso, modelli, archivi e servizi del computer. Nessun dato clinico viene inviato fuori dal dispositivo.
                        </p>
                        <div className="mt-5 flex flex-wrap items-center gap-3">
                            <div className="[&>div]:mx-0">
                                <ThemeToggle />
                            </div>
                            <button
                                type="button"
                                onClick={togglePrivacyMode}
                                className="mf-btn-secondary"
                                aria-pressed={isPrivacyMode}
                            >
                                {isPrivacyMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                {isPrivacyMode ? 'Privacy attiva' : 'Privacy spenta'}
                            </button>
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                        <div className="apple-subsection min-w-[210px]">
                            <p className="section-kicker">Operatore</p>
                            <p className="mt-2 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>{user?.displayName || 'Admin'}</p>
                            <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>{user?.ambulatoryName || 'Ambulatorio non impostato'}</p>
                        </div>
                        <NetworkOperatingModePanel />
                    </div>
                </div>
            </section>

            <div className="space-y-10">
                    {/* === Account === */}
                    <section id="account" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="Account"
                            title="Profilo e accesso"
                            description="Identità mostrata nei documenti generati e rotazione del PIN di sblocco."
                        />

                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                            <div className={SETTINGS_CARD_CLASS}>
                                {/* @Codex WUL-229 — header icon disc + ink copy mapped to MediFlow tokens */}
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="rounded-2xl p-2" style={{ background: 'rgba(15, 23, 42, 0.06)', color: 'var(--mf-ink)' }}>
                                        <User className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="section-kicker">Profilo</p>
                                        <h2 className="mt-1 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>Nome medico e ambulatorio</h2>
                                        <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>Mostrati in intestazione, ricette e referti generati.</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label htmlFor="doctor-name" className={SETTINGS_LABEL_CLASS}>
                                            Nome medico
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
                                            Nome ambulatorio
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
                                            className={SETTINGS_PRIMARY_BUTTON_CLASS}
                                        >
                                            <Save className="w-4 h-4" />
                                            {isSavingProfile ? 'Salvataggio...' : 'Salva profilo'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className={SETTINGS_CARD_CLASS}>
                                {/* @Codex WUL-229 — security card icon switches to MediFlow warning tone */}
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="rounded-2xl p-2" style={{ background: 'rgba(15, 23, 42, 0.06)', color: 'var(--mf-ink)' }}>
                                        <KeyRound className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="section-kicker">Sicurezza</p>
                                        <h2 className="mt-1 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>Cambio PIN</h2>
                                        <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>Ruota il PIN senza toccare la master key: i dati clinici restano leggibili.</p>
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

                                    {pinFeedback && (
                                        // @Codex WUL-229 — PIN feedback now uses the mf-alert tone primitives
                                        <div className={cn('mf-alert text-xs', pinFeedback.tone === 'success' ? 'mf-alert-success' : 'mf-alert-critical')}>
                                            {pinFeedback.message}
                                        </div>
                                    )}

                                    <div className="pt-2">
                                        <button
                                            onClick={handleChangePin}
                                            disabled={isChangingPin}
                                            className={SETTINGS_PRIMARY_BUTTON_CLASS}
                                        >
                                            <Shield className="w-4 h-4" />
                                            {isChangingPin ? 'Aggiornamento...' : 'Aggiorna PIN'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* === AI === */}
                    <section id="ai" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="AI locale"
                            title="Modelli, ruoli e runtime"
                            description="Provider locale, modelli per ciascun ruolo clinico e interruttori di sicurezza delle funzioni AI."
                        />

                        <div className="space-y-6">
                            {/* Profilo hardware */}
                            <div className={SETTINGS_CARD_CLASS}>
                                {/* @Codex WUL-229 — hardware tier cards now ride mf-option-card with token-driven accents */}
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="rounded-2xl p-2" style={{ background: 'rgba(15, 23, 42, 0.06)', color: 'var(--mf-ink)' }}>
                                        <Cpu className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="section-kicker">Profilo hardware</p>
                                        <h3 className="mt-1 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>Capacità del computer</h3>
                                        <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>Imposta i modelli di default in base alla RAM disponibile. Sovrascrive le selezioni manuali.</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div
                                        onClick={() => applyHardwareProfile('low')}
                                        className={cn('mf-option-card !px-4 !py-4', hardwareProfile === 'low' && 'is-active')}
                                        style={hardwareProfile === 'low' ? { borderColor: 'rgba(15, 23, 42, 0.22)', background: 'rgba(248, 250, 252, 0.9)' } : undefined}
                                    >
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--mf-ink)' }}>Leggero</span>
                                            {hardwareProfile === 'low' && <CheckCircle className="w-4 h-4" style={{ color: 'var(--mf-ink)' }} />}
                                        </div>
                                        <p className="text-sm font-semibold" style={{ color: 'var(--mf-ink)' }}>&lt; 16GB RAM</p>
                                        <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--mf-muted)' }}>Usa solo modelli molto compressi (Q4_K_M).</p>
                                    </div>

                                    <div
                                        onClick={() => applyHardwareProfile('medium')}
                                        className={cn('mf-option-card !px-4 !py-4', hardwareProfile === 'medium' && 'is-active')}
                                        style={hardwareProfile === 'medium' ? { borderColor: 'rgba(15, 23, 42, 0.22)', background: 'rgba(248, 250, 252, 0.9)' } : undefined}
                                    >
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--mf-ink)' }}>Bilanciato</span>
                                            {hardwareProfile === 'medium' && <CheckCircle className="w-4 h-4" style={{ color: 'var(--mf-ink)' }} />}
                                        </div>
                                        <p className="text-sm font-semibold" style={{ color: 'var(--mf-ink)' }}>16-32GB RAM</p>
                                        <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--mf-muted)' }}>Qwen 14B per sintesi e reasoning.</p>
                                    </div>

                                    <div
                                        onClick={() => applyHardwareProfile('high')}
                                        className={cn('mf-option-card !px-4 !py-4', hardwareProfile === 'high' && 'is-active')}
                                        style={hardwareProfile === 'high' ? { borderColor: 'rgba(15, 23, 42, 0.22)', background: 'rgba(248, 250, 252, 0.9)' } : undefined}
                                    >
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--mf-ink)' }}>Avanzato</span>
                                            {hardwareProfile === 'high' && <CheckCircle className="w-4 h-4" style={{ color: 'var(--mf-ink)' }} />}
                                        </div>
                                        <p className="text-sm font-semibold" style={{ color: 'var(--mf-ink)' }}>&gt; 32GB RAM</p>
                                        <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--mf-muted)' }}>Qwen 3.5 35B A3B per tutte le superfici text-only.</p>
                                    </div>
                                </div>
                            </div>

                            {/* Ruoli del team AI */}
                            <div className={SETTINGS_CARD_CLASS}>
                                {/* @Codex WUL-273 — AI roles header follows the neutral settings surface. */}
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="rounded-2xl p-2" style={{ background: 'rgba(15, 23, 42, 0.06)', color: 'var(--mf-ink)' }}>
                                        <Stethoscope className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="section-kicker">Ruoli del team AI</p>
                                        <h3 className="mt-1 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>Modelli per superficie clinica</h3>
                                        <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>Ogni ruolo usa un modello dedicato. I file vengono scaricati e tenuti in locale.</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <ModelSelector
                                        selectorId="clinical"
                                        label="Radiologo & Clinico"
                                        description="Per sintesi cliniche, insight e strutturazione testuale dopo OCR."
                                        icon={<Bot className="w-5 h-5" />}
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
                                        description="Per riassunti narrativi, chat complesse e Second Opinion."
                                        icon={<Cpu className="w-5 h-5" />}
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
                            </div>

                            {/* Patient Insight runtime policy */}
                            <div className={SETTINGS_CARD_CLASS}>
                                {/* @Codex WUL-273 — Patient Insight runtime settings stay neutral and role-led. */}
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="rounded-2xl p-2" style={{ background: 'rgba(15, 23, 42, 0.06)', color: 'var(--mf-ink)' }}>
                                        <Sparkles className="h-4 w-4" />
                                    </div>
                                    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="section-kicker">Patient Insight</p>
                                            <h3 className="mt-1 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>Budget contesto e output</h3>
                                            <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>Quanto contesto leggere e quanto produrre per ogni insight: bilancia velocità e completezza.</p>
                                        </div>
                                        <span className="apple-chip whitespace-nowrap">{selectedInsightMode.title}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {AI_INSIGHT_MODE_OPTIONS.map((option) => {
                                        const selected = aiInsightSettings.mode === option.value;
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setAiInsightSettings((prev) => ({ ...prev, mode: option.value }))}
                                                className={cn('mf-option-card text-left !px-3 !py-3', selected && 'is-active')}
                                                style={selected ? { borderColor: 'rgba(15, 23, 42, 0.22)', background: 'rgba(248, 250, 252, 0.9)' } : undefined}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-bold" style={{ color: 'var(--mf-ink)' }}>{option.title}</span>
                                                    {selected ? <CheckCircle className="h-4 w-4" style={{ color: 'var(--mf-ink)' }} /> : null}
                                                </div>
                                                <p className="mt-1 text-[11px]" style={{ color: 'var(--mf-muted)' }}>{option.description}</p>
                                            </button>
                                        );
                                    })}
                                </div>

                                <p
                                    className="mt-3 rounded-[14px] border px-3 py-2 text-[11px] leading-5"
                                    style={{ borderColor: 'rgba(15, 23, 42, 0.12)', background: 'rgba(248, 250, 252, 0.85)', color: 'var(--mf-muted)' }}
                                >
                                    {aiInsightSettings.mode === 'full_auto'
                                        ? 'MediFlow sceglie automaticamente quante fonti leggere in base al profilo della postazione e alla complessità del caso.'
                                        : selectedInsightMode.description}
                                </p>

                                <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                                    <div className="mf-section mf-section-tight !rounded-lg px-3 py-2">
                                        <span className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--mf-muted)' }}>Profilo hardware</span>
                                        <span className="font-semibold" style={{ color: 'var(--mf-ink)' }}>
                                            {hardwareProfile === 'low' ? 'Leggero' : hardwareProfile === 'medium' ? 'Bilanciato' : 'Avanzato'}
                                        </span>
                                    </div>
                                    <div className="mf-section mf-section-tight !rounded-lg px-3 py-2">
                                        <span className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--mf-muted)' }}>Budget runtime</span>
                                        <span className="font-semibold" style={{ color: 'var(--mf-ink)' }}>{insightRuntimePreview}</span>
                                    </div>
                                </div>

                                {aiInsightSettings.mode === 'manual' && (
                                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <label className="text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>
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
                                        <label className="text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>
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
                                        <label className="text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>
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
                                        <label className="text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>
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

                            {/* AI safety toggles */}
                            <div className={SETTINGS_CARD_CLASS}>
                                {/* @Codex WUL-273 — active AI switches use neutral confirmation; red is reserved for off/blocked states. */}
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="rounded-2xl p-2" style={{ background: 'rgba(192, 57, 43, 0.12)', color: 'var(--mf-critical)' }}>
                                        <Shield className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="section-kicker">Sicurezza AI</p>
                                        <h3 className="mt-1 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>Disattiva singole funzioni AI</h3>
                                        <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>Ogni interruttore ferma una funzione specifica, anche se i modelli locali sono installati.</p>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div
                                        className="rounded-[18px] border p-4"
                                        style={patientInsightEnabled
                                            ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(248, 250, 252, 0.85)' }
                                            : { borderColor: 'rgba(192, 57, 43, 0.28)', background: 'rgba(192, 57, 43, 0.08)' }}
                                        data-testid="patient-insight-kill-switch-card"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-semibold" style={{ color: 'var(--mf-ink)' }}>Patient Insight</p>
                                                <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--mf-muted)' }}>
                                                    Se spento, la scheda paziente non genera nuovi riepiloghi AI.
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <label
                                                    htmlFor="patientInsightKillSwitch"
                                                    className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                                                    style={patientInsightEnabled
                                                        ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-ink)' }
                                                        : { borderColor: 'rgba(192, 57, 43, 0.32)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-critical)' }}
                                                >
                                                    {patientInsightEnabled ? 'Attivo' : 'Spento'}
                                                </label>
                                                <button
                                                    id="patientInsightKillSwitch"
                                                    type="button"
                                                    role="switch"
                                                    aria-checked={patientInsightEnabled}
                                                    aria-label="Patient Insight locale"
                                                    onClick={() => setPatientInsightEnabled(!patientInsightEnabled)}
                                                    className="relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[color:rgba(15,23,42,0.24)]"
                                                    style={{ background: patientInsightEnabled ? 'var(--mf-ink)' : 'rgba(112,106,100,0.2)' }}
                                                >
                                                    <span
                                                        className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                                        style={{ transform: patientInsightEnabled ? 'translateX(22px)' : 'translateX(4px)' }}
                                                    />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div
                                        className="rounded-[18px] border p-4"
                                        style={documentSynthesisEnabled
                                            ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(248, 250, 252, 0.85)' }
                                            : { borderColor: 'rgba(192, 57, 43, 0.28)', background: 'rgba(192, 57, 43, 0.08)' }}
                                        data-testid="document-synthesis-kill-switch-card"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-semibold" style={{ color: 'var(--mf-ink)' }}>Document Synthesis</p>
                                                <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--mf-muted)' }}>
                                                    Se spento, OCR e import base restano disponibili, ma non vengono prodotte sintesi cliniche automatiche.
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <label
                                                    htmlFor="documentSynthesisKillSwitch"
                                                    className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                                                    style={documentSynthesisEnabled
                                                        ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-ink)' }
                                                        : { borderColor: 'rgba(192, 57, 43, 0.32)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-critical)' }}
                                                >
                                                    {documentSynthesisEnabled ? 'Attivo' : 'Spento'}
                                                </label>
                                                <button
                                                    id="documentSynthesisKillSwitch"
                                                    type="button"
                                                    role="switch"
                                                    aria-checked={documentSynthesisEnabled}
                                                    aria-label="Document Synthesis locale"
                                                    onClick={() => setDocumentSynthesisEnabled(!documentSynthesisEnabled)}
                                                    className="relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[color:rgba(15,23,42,0.24)]"
                                                    style={{ background: documentSynthesisEnabled ? 'var(--mf-ink)' : 'rgba(112,106,100,0.2)' }}
                                                >
                                                    <span
                                                        className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                                        style={{ transform: documentSynthesisEnabled ? 'translateX(22px)' : 'translateX(4px)' }}
                                                    />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div
                                        className="rounded-[18px] border p-4"
                                        style={smartImportEnabled
                                            ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(248, 250, 252, 0.85)' }
                                            : { borderColor: 'rgba(192, 57, 43, 0.28)', background: 'rgba(192, 57, 43, 0.08)' }}
                                        data-testid="smart-import-kill-switch-card"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-semibold" style={{ color: 'var(--mf-ink)' }}>Smart Import</p>
                                                <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--mf-muted)' }}>
                                                    Se spento, il pannello paziente non propone nuovi suggerimenti Smart Import e non applica quelli in sospeso.
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <label
                                                    htmlFor="smartImportKillSwitch"
                                                    className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                                                    style={smartImportEnabled
                                                        ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-ink)' }
                                                        : { borderColor: 'rgba(192, 57, 43, 0.32)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-critical)' }}
                                                >
                                                    {smartImportEnabled ? 'Attivo' : 'Spento'}
                                                </label>
                                                <button
                                                    id="smartImportKillSwitch"
                                                    type="button"
                                                    role="switch"
                                                    aria-checked={smartImportEnabled}
                                                    aria-label="Smart Import locale"
                                                    onClick={() => setSmartImportEnabled(!smartImportEnabled)}
                                                    className="relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[color:rgba(15,23,42,0.24)]"
                                                    style={{ background: smartImportEnabled ? 'var(--mf-ink)' : 'rgba(112,106,100,0.2)' }}
                                                >
                                                    <span
                                                        className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                                        style={{ transform: smartImportEnabled ? 'translateX(22px)' : 'translateX(4px)' }}
                                                    />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Connessione runtime + Save */}
                            <div className={SETTINGS_CARD_CLASS}>
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="rounded-2xl bg-slate-100/80 p-2 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                                        <Server className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="section-kicker">Connessione runtime</p>
                                        <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Provider locale</h3>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Solo Ollama in locale: nessun dato esce dal computer.</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="flex items-center rounded-[18px] border border-slate-200/70 bg-white/72 px-3 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                                        Provider AI: <span className="ml-2 font-semibold text-slate-900 dark:text-white">Ollama (locale)</span>
                                    </div>
                                    <input
                                        type="text"
                                        value={aiConfig.url}
                                        onChange={(e) => setAiConfig({ ...aiConfig, url: e.target.value })}
                                        placeholder="http://127.0.0.1:11434/v1"
                                        aria-label="URL provider Ollama"
                                        className={`${SETTINGS_INPUT_CLASS} font-mono text-xs`}
                                    />
                                </div>

                                <div className="mt-3 flex items-center justify-between gap-3">
                                    <label
                                        htmlFor="advancedFit"
                                        className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400"
                                    >
                                        <input
                                            type="checkbox"
                                            id="advancedFit"
                                            checked={showAdvanced}
                                            onChange={(e) => setShowAdvanced(e.target.checked)}
                                            className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400 dark:border-white/10 dark:bg-white/5"
                                        />
                                        Mostra opzioni avanzate
                                    </label>
                                </div>

                                {showAdvanced && (
                                    <div className="mt-3 rounded-[18px] border border-dashed border-slate-200/80 bg-white/55 p-4 dark:border-white/10 dark:bg-white/5">
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
                                                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400 dark:border-white/10 dark:bg-white/5"
                                            />
                                            <label htmlFor="dockerMode" className="cursor-pointer text-xs leading-5 text-slate-500 dark:text-slate-400">
                                                Docker Internal Host (se l&apos;app è in container)
                                            </label>
                                        </div>
                                    </div>
                                )}

                                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200/70 pt-4 dark:border-white/10">
                                    <button
                                        onClick={saveAiConfig}
                                        disabled={isSavingAi}
                                        className={SETTINGS_PRIMARY_BUTTON_CLASS}
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

                                    <p className="ml-auto text-[10px] text-slate-400 italic">
                                        CPU alta? Riavvia Ollama (`docker restart ollama`).
                                    </p>
                                </div>

                                {aiHealth && (
                                    <div className={cn(
                                        "mt-4 animate-in slide-in-from-top-2 fade-in rounded-[18px] border p-3 text-sm space-y-1",
                                        aiHealth.status === 'ok'
                                            ? "border-slate-200 bg-slate-50 text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                                            : "border-red-200/70 bg-red-50/80 text-red-800 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-200"
                                    )}>
                                        <div className="flex items-start gap-2 font-semibold">
                                            {aiHealth.status === 'ok' ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                                            <p>{aiHealth.status === 'ok' ? 'Sistema AI operativo' : 'Problema rilevato'}</p>
                                        </div>
                                        <p className="pl-6 text-xs opacity-90">{aiHealth.message}</p>
                                    </div>
                                )}

                                {aiTestStatus === 'success' && (
                                    <div className="mt-3 flex items-center gap-2 rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                                        <CheckCircle className="w-4 h-4" />
                                        Connessione a Ollama riuscita.
                                    </div>
                                )}
                                {aiTestStatus === 'error' && (
                                    <div className="mt-3 flex items-center gap-2 rounded-[14px] border border-red-200/70 bg-red-50/80 p-3 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-200">
                                        <AlertTriangle className="w-4 h-4" />
                                        Impossibile connettersi. Controlla che Ollama sia attivo.
                                    </div>
                                )}
                            </div>

                            {/* Read-only governance */}
                            <details className="group rounded-[24px] border border-slate-200/70 bg-white/60 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                                    <div>
                                        <p className="section-kicker">Governance (sola lettura)</p>
                                        <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">Parliament e readiness rollout</h3>
                                    </div>
                                    <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                                </summary>
                                <div className="space-y-4 border-t border-slate-200/70 px-5 py-5 dark:border-white/10">
                                    <AiModelParliamentPanel />
                                    <AiRolloutReadinessPanel />
                                </div>
                            </details>
                        </div>
                    </section>

                    {/* === Backup === */}
                    <section id="backups" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="Backup"
                            title="Continuità e ripristino"
                            description="Schedulazione automatica e ripristino manuale degli archivi cifrati locali."
                        />
                        <div className="space-y-6">
                            <BackupSchedulerUI />
                            <BackupRestoreUI />
                        </div>
                    </section>

                    {/* === Cataloghi === */}
                    <section id="data" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="Cataloghi"
                            title="Farmaci ed esenzioni"
                            description="Database locali per il prescrittore. Importa e aggiorna senza rete."
                        />

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className={SETTINGS_CARD_CLASS}>
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="rounded-2xl bg-slate-100 p-2 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                                        <Database className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="section-kicker">Farmaci</p>
                                        <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Database AIFA offline</h2>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                            Elenco farmaci rimborsabili usato dal prescrittore.{' '}
                                            <a
                                                href="https://www.aifa.gov.it/web/guest/liste-dei-farmaci"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-slate-700 underline-offset-2 hover:underline dark:text-slate-200"
                                            >
                                                Fonte: AIFA Open Data
                                            </a>
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between rounded-[22px] border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
                                        <div>
                                            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">Farmaci indicizzati</p>
                                            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                                                {drugStats !== null ? drugStats.toLocaleString() : '-'}
                                            </p>
                                        </div>
                                        <Server className="w-8 h-8 text-slate-300 dark:text-white/20" />
                                    </div>

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
                                            className="flex w-full items-center justify-center gap-2 rounded-[22px] border-2 border-dashed border-slate-300 bg-white/72 px-4 py-3 text-slate-600 shadow-[0_10px_22px_rgba(15,23,42,0.04)] transition-[border-color,background-color,color,box-shadow] hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 dark:border-white/15 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/25 dark:hover:bg-white/10"
                                        >
                                            <Upload className="w-5 h-5" />
                                            <span className="font-medium">Carica file AIFA (.csv)</span>
                                        </button>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-xs text-gray-500">
                                                <span>Importazione in corso...</span>
                                                <span>{progress}%</span>
                                            </div>
                                            <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                                                <div className="h-2.5 rounded-full bg-slate-900 transition-[width] duration-300 progress-bar-width dark:bg-white" data-progress={progress}></div>
                                            </div>
                                            <p className="text-[10px] text-gray-400 text-center">Non chiudere la pagina.</p>
                                        </div>
                                    )}

                                    {drugStats !== null && drugStats > 0 && (
                                        <button
                                            onClick={handleClearDrugs}
                                            className="text-xs text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                                        >
                                            <AlertTriangle className="w-3 h-3" />
                                            Svuota database farmaci
                                        </button>
                                    )}
                                </div>
                            </div>

                            <ExemptionDbManager />
                        </div>
                    </section>

                    {/* === Sistema === */}
                    <section id="operations" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="Sistema"
                            title="Diagnostica e manutenzione"
                            description="Stato dei servizi locali, gestione ambulatori, strumenti avanzati e azioni da confermare."
                        />

                        <div className="space-y-6">
                            <ServiceArchitecturePanel />
                            <DiagnosticHub />

                            <div className={SETTINGS_CARD_CLASS}>
                                <div className="flex items-start gap-3">
                                    <div className="rounded-2xl bg-slate-100 p-2 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                                        <Activity className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="section-kicker">Ambulatori</p>
                                        <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Sedi e contesti</h3>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Gestisci più sedi e cambia rapidamente contesto operativo.</p>
                                    </div>
                                    <Link
                                        href="/settings/ambulatories"
                                        className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-50/80 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                                    >
                                        Apri gestione &rarr;
                                    </Link>
                                </div>
                            </div>

                            <UpdateAwarenessPanel />

                            {/* Advanced tools (devs / native) */}
                            <details className="group rounded-[24px] border border-slate-200/70 bg-white/55 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                                    <div className="flex items-start gap-3">
                                        <div className="rounded-2xl bg-slate-100/80 p-2 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                                            <Wrench className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="section-kicker">Strumenti avanzati</p>
                                            <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">Dati dimostrativi e app Mac</h3>
                                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Usali solo per collaudo, manutenzione o avvio della shell locale.</p>
                                        </div>
                                    </div>
                                    <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                                </summary>
                                <div className="grid grid-cols-1 gap-4 border-t border-slate-200/70 px-5 py-5 md:grid-cols-2 dark:border-white/10">
                                    <div className="apple-subsection flex flex-col justify-between">
                                        <div className="mb-3">
                                            <p className="section-kicker">Sviluppo</p>
                                            <h4 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">Dati dimostrativi</h4>
                                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Genera pazienti e documenti sintetici per verificare la postazione.</p>
                                        </div>
                                        <div className="flex items-center justify-end">
                                            <DataSeeder />
                                        </div>
                                    </div>

                                    <div className="apple-subsection flex flex-col justify-between">
                                        <div className="mb-3">
                                            <p className="section-kicker">Desktop</p>
                                            <h4 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">App nativa macOS</h4>
                                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Avvia la shell nativa quando disponibile sul sistema.</p>
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
                                                <span className="text-xs text-slate-600 dark:text-slate-300">Aperta</span>
                                            )}
                                            {nativeLaunchState === 'error' && (
                                                <span className="text-xs text-red-600">Errore</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </details>

                            {/* Danger Zone */}
                            <div className="rounded-[24px] border border-red-200/60 bg-red-50/60 p-5 md:p-6 dark:border-red-500/20 dark:bg-red-900/10">
                                <div className="mb-5 flex items-start gap-3">
                                    <div className="rounded-xl bg-red-100 p-2 text-red-600 dark:bg-red-500/15 dark:text-red-200">
                                        <AlertTriangle className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="section-kicker">Zona pericolo</p>
                                        <h3 className="mt-1 font-semibold text-slate-900 dark:text-white">Azioni irreversibili</h3>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                            Operazioni che riportano la postazione a uno stato precedente. Richiedono riconfigurazione.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-4 rounded-[20px] border border-red-100 bg-white/78 p-4 dark:border-red-900/50 dark:bg-red-950/20 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-red-100">Reset onboarding</p>
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
                                        Ripeti configurazione iniziale
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* === Aspetto (cosmetic, last) === */}
                    <section id="appearance" data-testid="settings-appearance-section" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="Aspetto"
                            title="Lettura e accessibilità"
                            description="Controlli di lettura per chi preferisce meno movimento durante il lavoro clinico."
                        />

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
                            <div className="apple-subsection" data-testid="ui-accessibility-controls">
                                <p className="section-kicker">Controlli di lettura</p>
                                <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                                    Tema e movimento
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                    Cambia tema della postazione e riduce animazioni quando serve meno stimolo visivo.
                                </p>

                                <div className="mt-5 space-y-3">
                                    <div className="flex items-center justify-between gap-4 rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/78 px-4 py-3 dark:bg-white/6">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900 dark:text-white">Tema interfaccia</p>
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Chiaro, scuro o automatico secondo il Mac.</p>
                                        </div>
                                        <ThemeToggle />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setReduceMotion(!reduceMotion)}
                                        className={cn(
                                            "flex w-full items-center justify-between rounded-[18px] border px-4 py-3 text-left transition-[border-color,background-color,color]",
                                            reduceMotion
                                                ? "border-[color:rgba(15,23,42,0.22)] bg-[color:rgba(248,250,252,0.9)]"
                                                : "border-[color:rgba(112,106,100,0.12)] bg-white/78 dark:bg-white/6"
                                        )}
                                    >
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900 dark:text-white">Riduci movimento</p>
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Riduce transizioni, effetti atmosferici e micro-animazioni del flow field.</p>
                                        </div>
                                        <span className="apple-chip">{reduceMotion ? 'Attivo' : 'Disattivo'}</span>
                                    </button>
                                </div>
                            </div>

                            <aside
                                data-testid="ui-style-runtime-notice"
                                className="apple-subsection self-start text-sm leading-6 text-slate-500 dark:text-slate-400"
                            >
                                <p className="section-kicker">Runtime</p>
                                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                                    Vista unica MediFlow
                                </p>
                                <p className="mt-2 text-xs leading-5">
                                    Schede, strumenti e impostazioni usano lo stesso spazio operativo.
                                </p>
                            </aside>
                        </div>
                    </section>

            </div>
        </Kree8WorkspaceShell>
    );
}
