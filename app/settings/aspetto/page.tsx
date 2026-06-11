'use client';

// WUL-297 Aspetto: moved from the monolithic settings page.

import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { useUIAccessibility } from '@/components/ui-accessibility-provider';
import { usePrivacy } from '@/components/privacy-provider';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';

export default function SettingsAppearancePage() {
    const {
        reduceMotion,
        setReduceMotion,
    } = useUIAccessibility();
    const { isPrivacyMode, togglePrivacyMode } = usePrivacy();

    return (
        <section data-testid="settings-appearance-section" className="space-y-4">
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
                                    ? "border-[color:rgba(15,23,42,0.22)] bg-[color:rgba(248,250,252,0.9)] dark:border-[color:rgba(226,232,240,0.28)] dark:bg-white/12"
                                    : "border-[color:rgba(112,106,100,0.12)] bg-white/78 dark:bg-white/6"
                            )}
                        >
                            <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">Riduci movimento</p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Riduce transizioni, effetti atmosferici e micro-animazioni del flow field.</p>
                            </div>
                            <span className="apple-chip">{reduceMotion ? 'Attivo' : 'Disattivo'}</span>
                        </button>

                        {/* WUL-297: la Privacy Mode vive nell'intestazione dell'app; qui resta un puntatore. */}
                        <button
                            type="button"
                            onClick={togglePrivacyMode}
                            aria-pressed={isPrivacyMode}
                            data-testid="settings-privacy-mode-pointer"
                            className={cn(
                                "flex w-full items-center justify-between rounded-[18px] border px-4 py-3 text-left transition-[border-color,background-color,color]",
                                isPrivacyMode
                                    ? "border-[color:rgba(15,23,42,0.22)] bg-[color:rgba(248,250,252,0.9)] dark:border-[color:rgba(226,232,240,0.28)] dark:bg-white/12"
                                    : "border-[color:rgba(112,106,100,0.12)] bg-white/78 dark:bg-white/6"
                            )}
                        >
                            <div className="flex items-start gap-3">
                                {isPrivacyMode
                                    ? <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                    : <Eye className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />}
                                <div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Privacy Mode</p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        Offusca i dati identificativi in presenza del paziente. Sempre disponibile dall&apos;intestazione dell&apos;app.
                                    </p>
                                </div>
                            </div>
                            <span className="apple-chip">{isPrivacyMode ? 'Attiva' : 'Spenta'}</span>
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
    );
}
