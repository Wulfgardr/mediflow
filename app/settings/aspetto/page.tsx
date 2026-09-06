'use client';

// WUL-297 Aspetto: moved from the monolithic settings page.

import { Eye, EyeOff, PanelLeft, PanelTop } from 'lucide-react';
/* @Codex */
import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';
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
    /* @Codex */
    const { enabled, proposal, composition, setComposition, setProposal } = useRuntimeTwinDesign();

    return (
        <section data-testid="settings-appearance-section" className="space-y-4">
            <SettingsSectionIntro
                kicker="Generale"
                title="Aspetto"
                description="Tema, movimento e accessibilità per una lettura adatta al lavoro clinico."
            />

            {/* @Codex: the same presentation preference drives Settings and comparison. */}
            {enabled && (
                <fieldset className="mf-section min-w-0" data-testid="settings-navigation-layout">
                    <legend className="px-2 text-base font-semibold">Navigazione</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {([
                            { value: 'stream', title: 'Barra superiore', detail: 'B · Diario', Icon: PanelTop },
                            { value: 'workbench', title: 'Barra laterale', detail: 'A · Postazione', Icon: PanelLeft },
                        ] as const).map(({ value, title, detail, Icon }) => (
                            <label key={value} className={cn(
                                'flex min-w-0 cursor-pointer items-center gap-4 rounded-xl border p-5',
                                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--lume-accent)]',
                                proposal && composition === value
                                    ? 'border-[color:var(--lume-accent)] bg-[color:var(--lume-surface-focal)]'
                                    : 'border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)]'
                            )}>
                                <Icon aria-hidden="true" className="h-6 w-6 shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold">{title}</span>
                                    <span className="mt-1 block text-xs text-[color:var(--lume-ink-muted)]">{detail}</span>
                                </span>
                                <input type="radio" name="navigation-layout" value={value} aria-label={title}
                                    checked={proposal && composition === value}
                                    onChange={() => { setComposition(value); setProposal(true); }}
                                    className="h-4 w-4 shrink-0 accent-[var(--lume-accent)]" />
                            </label>
                        ))}
                    </div>
                </fieldset>
            )}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
                <div className="mf-section lume-focal" data-testid="ui-accessibility-controls">
                    <p className="section-kicker">Controlli di lettura</p>
                    <h3 className="mt-2 text-lg font-semibold" style={{ color: 'var(--lume-ink)' }}>
                        Tema e movimento
                    </h3>
                    <p className="mt-2 text-sm leading-6" style={{ color: 'var(--lume-ink-muted)' }}>
                        Cambia tema della postazione e riduce animazioni quando serve meno stimolo visivo.
                    </p>

                    <div className="mt-5 space-y-3">
                        <div className="flex items-center justify-between gap-4 rounded-[var(--lume-radius-card)] border bg-[color:var(--lume-surface-field)] px-4 py-3" style={{ borderColor: 'color-mix(in srgb, var(--lume-ink) 12%, transparent)' }}>
                            <div>
                                <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>Tema interfaccia</p>
                                <p className="mt-1 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>Chiaro, scuro o automatico secondo il Mac.</p>
                            </div>
                            <ThemeToggle />
                        </div>
                        <button
                            type="button"
                            onClick={() => setReduceMotion(!reduceMotion)}
                            className={cn(
                                "flex w-full items-center justify-between rounded-[var(--lume-radius-card)] border px-4 py-3 text-left transition-[border-color,background-color,color]",
                                reduceMotion
                                    ? "border-[color:var(--lume-accent)] bg-[color:var(--lume-surface-focal)]"
                                    : "border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)]"
                            )}
                        >
                            <div>
                                <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>Riduci movimento</p>
                                <p className="mt-1 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>Riduce le transizioni non essenziali durante il lavoro clinico.</p>
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
                                "flex w-full items-center justify-between rounded-[var(--lume-radius-card)] border px-4 py-3 text-left transition-[border-color,background-color,color]",
                                isPrivacyMode
                                    ? "border-[color:var(--lume-accent)] bg-[color:var(--lume-surface-focal)]"
                                    : "border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)]"
                            )}
                        >
                            <div className="flex items-start gap-3">
                                {isPrivacyMode
                                    ? <EyeOff className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--lume-ink-muted)' }} />
                                    : <Eye className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--lume-ink-muted)' }} />}
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>Privacy Mode</p>
                                    <p className="mt-1 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>
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
                    className="mf-section self-start text-sm leading-6"
                >
                    <p className="section-kicker">Spazio operativo</p>
                    <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>
                        {enabled ? 'Una cartella, due viste' : 'Vista unica MediFlow'}
                    </p>
                    <p className="mt-2 text-xs leading-5" style={{ color: 'var(--lume-ink-muted)' }}>
                        Schede, strumenti e impostazioni usano lo stesso spazio operativo.
                    </p>
                </aside>
            </div>
        </section>
    );
}
