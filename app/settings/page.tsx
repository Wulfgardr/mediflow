'use client';

// WUL-297: /settings is now a thin "Stato sistema" dashboard inside the
// settings sidebar layout. Legacy #anchor deep-links redirect to the
// dedicated sub-routes.

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { useSecurity } from '@/components/security-provider';
/* @Codex */
import NetworkOperatingModePanel from '@/components/settings/network-operating-mode-panel';
import { ThemeToggle } from '@/components/theme-toggle';
import { SETTINGS_NAV_GROUPS } from '@/lib/settings-navigation';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';

// Old monolithic-page anchors → new sub-routes.
const LEGACY_ANCHOR_REDIRECTS: Record<string, string> = {
    '#account': '/settings/profilo',
    '#ai': '/settings/ai/modelli',
    '#backups': '/settings/backup',
    '#data': '/settings/repertori',
    '#operations': '/settings/diagnostica',
    '#appearance': '/settings/aspetto',
};

export default function SettingsPage() {
    const router = useRouter();
    const { user } = useSecurity();

    useEffect(() => {
        const target = LEGACY_ANCHOR_REDIRECTS[window.location.hash];
        if (target) {
            router.replace(target);
        }
    }, [router]);

    return (
        <div className="space-y-8" data-testid="settings-overview-section">
            <section className="patient-detail-section mf-section p-6 md:p-8">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
                    <div>
                        <p className="section-kicker">Postazione locale</p>
                        <h2 className="mt-1 text-xl font-semibold tracking-tight" style={{ color: 'var(--mf-ink)' }}>
                            Stato operativo
                        </h2>
                        <p className="mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--mf-muted)' }}>
                            Nessun dato clinico viene inviato fuori dal dispositivo.
                        </p>
                        <div className="mt-5 flex flex-wrap items-center gap-3">
                            <div className="[&>div]:mx-0">
                                <ThemeToggle />
                            </div>
                            <p className="text-xs" style={{ color: 'var(--mf-muted)' }}>
                                La Privacy Mode è sempre disponibile dall&apos;intestazione dell&apos;app.
                            </p>
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

            <section className="space-y-4">
                <SettingsSectionIntro
                    kicker="Sezioni"
                    title="Tutte le impostazioni"
                    description="Premi ⌘K per cercare un'impostazione e aprire subito la sezione corrispondente."
                />

                <div className="space-y-6">
                    {SETTINGS_NAV_GROUPS.map((group) => (
                        <div key={group.id} className="space-y-2">
                            <p className="section-kicker">{group.label}</p>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {group.items.map((item) => {
                                    const isDanger = item.tone === 'danger';
                                    return (
                                        <Link
                                            key={item.id}
                                            href={item.href}
                                            data-testid={`settings-overview-link-${item.id}`}
                                            className="mf-section mf-section-tight group flex items-start justify-between gap-3 p-4 transition-transform hover:-translate-y-0.5"
                                            style={isDanger ? { borderColor: 'rgba(192, 57, 43, 0.3)', background: 'rgba(192, 57, 43, 0.06)' } : undefined}
                                        >
                                            <span className="min-w-0">
                                                <span
                                                    className="block text-sm font-semibold"
                                                    style={{ color: isDanger ? 'var(--mf-critical)' : 'var(--mf-ink)' }}
                                                >
                                                    {item.label}
                                                </span>
                                                <span className="mt-1 block text-[11px] leading-4" style={{ color: 'var(--mf-muted)' }}>
                                                    {item.description}
                                                </span>
                                            </span>
                                            <ArrowUpRight
                                                className="h-4 w-4 shrink-0 opacity-50 transition-opacity group-hover:opacity-100"
                                                style={{ color: isDanger ? 'var(--mf-critical)' : 'var(--mf-muted)' }}
                                            />
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
