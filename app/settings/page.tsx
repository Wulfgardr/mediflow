'use client';

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { Upload, Database, Save, AlertTriangle, Server, User, Shield, Activity, KeyRound, Wrench, ChevronDown, Eye, EyeOff } from 'lucide-react';
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
import NetworkOperatingModePanel from '@/components/settings/network-operating-mode-panel';
/* @Codex */
import UpdateAwarenessPanel from '@/components/settings/update-awareness-panel';
import { useUIAccessibility } from '@/components/ui-accessibility-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { usePrivacy } from '@/components/privacy-provider';
import {
    SETTINGS_CARD_CLASS,
    SETTINGS_INPUT_CLASS,
    SETTINGS_LABEL_CLASS,
    SETTINGS_PRIMARY_BUTTON_CLASS,
    SETTINGS_SECONDARY_BUTTON_CLASS,
    SettingsSectionIntro,
} from '@/components/settings/settings-ui';

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
        { href: '/settings/ai/modelli', label: 'AI locale', meta: 'modelli' },
        { href: '#backups', label: 'Backup', meta: 'archivi' },
        { href: '#data', label: 'Repertori', meta: 'AIFA/esenzioni' },
        { href: '#operations', label: 'Servizi', meta: 'locale' },
        { href: '#appearance', label: 'Lettura', meta: 'tema' },
    ];

    return (
        <Kree8WorkspaceShell
            eyebrow="Sistema"
            title="Impostazioni"
            subtitle="Accesso, AI locale, backup, repertori e servizi del Mac che ospita MediFlow."
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

                    {/* === Repertori === */}
                    <section id="data" className="space-y-4 scroll-mt-24">
                        <SettingsSectionIntro
                            kicker="Repertori"
                            title="Farmaci AIFA ed esenzioni"
                            description="Repertori locali per la cartella: farmaci AIFA ed esenzioni consultabili anche senza rete."
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
                                <p className="section-kicker">Spazio operativo</p>
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
