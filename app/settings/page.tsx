'use client';

import { Eye, EyeOff } from 'lucide-react';
import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import { useSecurity } from '@/components/security-provider';
/* @Codex */
import NetworkOperatingModePanel from '@/components/settings/network-operating-mode-panel';
import { ThemeToggle } from '@/components/theme-toggle';
import { usePrivacy } from '@/components/privacy-provider';

export default function SettingsPage() {
    const { user } = useSecurity();
    const { isPrivacyMode, togglePrivacyMode } = usePrivacy();

    /* @Codex */
    const settingsNavItems = [
        { href: '/settings/profilo', label: 'Profilo', meta: 'account' },
        { href: '/settings/ai/modelli', label: 'AI locale', meta: 'modelli' },
        { href: '/settings/backup', label: 'Backup', meta: 'archivi' },
        { href: '/settings/repertori', label: 'Repertori', meta: 'AIFA/esenzioni' },
        { href: '/settings/diagnostica', label: 'Diagnostica', meta: 'servizi' },
        { href: '/settings/aspetto', label: 'Lettura', meta: 'tema' },
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

        </Kree8WorkspaceShell>
    );
}
