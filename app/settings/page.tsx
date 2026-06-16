'use client';

// WUL-297: /settings is now a thin "Stato sistema" dashboard inside the
// settings sidebar layout. Legacy #anchor deep-links redirect to the
// dedicated sub-routes.

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    Activity,
    ArrowUpRight,
    Brain,
    Building2,
    Database,
    Eye,
    HardDrive,
    KeyRound,
    MonitorCog,
    Settings2,
    ShieldAlert,
    UserRoundCog,
    type LucideIcon,
} from 'lucide-react';
import { useSecurity } from '@/components/security-provider';
/* @Codex */
import NetworkOperatingModePanel from '@/components/settings/network-operating-mode-panel';
import { ThemeToggle } from '@/components/theme-toggle';
import { SETTINGS_NAV_GROUPS, type SettingsNavItem } from '@/lib/settings-navigation';
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

/* @Codex */
const SETTINGS_ITEM_ICONS: Record<string, LucideIcon> = {
    profilo: UserRoundCog,
    aspetto: Eye,
    ambulatori: Building2,
    accesso: KeyRound,
    backup: HardDrive,
    repertori: Database,
    'ai-modelli': Brain,
    'ai-funzioni': Settings2,
    diagnostica: Activity,
    sviluppo: MonitorCog,
    'zona-pericolo': ShieldAlert,
};

/* @Codex */
const SETTINGS_ITEM_BADGES: Record<string, string> = {
    profilo: 'operatore',
    aspetto: 'preferenze',
    ambulatori: 'contesti',
    accesso: 'PIN',
    backup: 'Mac',
    repertori: 'manuale',
    'ai-modelli': 'locale',
    'ai-funzioni': 'governance',
    diagnostica: 'servizi',
    sviluppo: 'dev',
    'zona-pericolo': 'admin',
};

/* @Codex */
function SettingsCommandRow({ item }: { item: SettingsNavItem }) {
    const Icon = SETTINGS_ITEM_ICONS[item.id] ?? Settings2;
    const isDanger = item.tone === 'danger';

    return (
        <Link
            href={item.href}
            data-testid={`settings-overview-link-${item.id}`}
            className="group grid min-h-[64px] grid-cols-[32px_minmax(0,1fr)_auto_18px] items-center gap-3 rounded-[14px] border px-3.5 py-3 transition-colors hover:border-[color:var(--mf-accent)]"
            style={{
                borderColor: isDanger ? 'rgba(192, 57, 43, 0.26)' : 'var(--glass-border)',
                background: isDanger ? 'rgba(192, 57, 43, 0.06)' : 'var(--mf-bg-elevated)',
            }}
        >
            <span
                className="flex h-8 w-8 items-center justify-center rounded-[10px]"
                style={{
                    background: isDanger ? 'rgba(192, 57, 43, 0.08)' : 'var(--mf-bg)',
                    color: isDanger ? 'var(--mf-critical)' : 'var(--mf-muted)',
                }}
            >
                <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
                <span
                    className="block truncate text-[13px] font-semibold"
                    style={{ color: isDanger ? 'var(--mf-critical)' : 'var(--mf-ink)' }}
                >
                    {item.label}
                </span>
                <span className="mt-0.5 block truncate text-[11px]" style={{ color: 'var(--mf-muted)' }}>
                    {item.description}
                </span>
            </span>
            <span
                className="hidden rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex"
                style={{
                    background: isDanger ? 'rgba(192, 57, 43, 0.08)' : 'var(--mf-bg)',
                    color: isDanger ? 'var(--mf-critical)' : 'var(--mf-muted)',
                }}
            >
                {SETTINGS_ITEM_BADGES[item.id] ?? 'apri'}
            </span>
            <ArrowUpRight
                className="h-4 w-4 justify-self-end opacity-45 transition-opacity group-hover:opacity-100"
                style={{ color: isDanger ? 'var(--mf-critical)' : 'var(--mf-muted)' }}
                aria-hidden="true"
            />
        </Link>
    );
}

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
        <div className="space-y-6" data-testid="settings-overview-section">
            <section className="patient-detail-section mf-section p-5 md:p-6">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)] xl:items-start">
                    <div className="space-y-4">
                        <div>
                            <p className="section-kicker">Postazione locale</p>
                            <h2 className="mt-1 text-xl font-semibold tracking-tight" style={{ color: 'var(--mf-ink)' }}>
                                Stato operativo
                            </h2>
                            <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--mf-muted)' }}>
                                Controlli essenziali del Mac che ospita MediFlow, senza uscita dati di default.
                            </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="apple-subsection min-w-0 p-4">
                                <p className="section-kicker">Operatore</p>
                                <p className="mt-2 truncate text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>
                                    {user?.displayName || 'Admin'}
                                </p>
                                <p className="mt-1 truncate text-xs" style={{ color: 'var(--mf-muted)' }}>
                                    {user?.ambulatoryName || 'Ambulatorio non impostato'}
                                </p>
                            </div>
                            <div className="apple-subsection min-w-0 p-4">
                                <p className="section-kicker">Lettura</p>
                                <div className="mt-2 flex flex-wrap items-center gap-3">
                                    <div className="[&>div]:mx-0">
                                        <ThemeToggle />
                                    </div>
                                </div>
                                <p className="mt-2 text-xs leading-5" style={{ color: 'var(--mf-muted)' }}>
                                    Privacy Mode resta nell&apos;intestazione dell&apos;app.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="min-w-0">
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

                <div className="grid gap-4 xl:grid-cols-2">
                    {SETTINGS_NAV_GROUPS.map((group) => (
                        <div key={group.id} className="mf-section mf-section-tight p-4 md:p-5">
                            <div className="mb-3 flex items-baseline justify-between gap-3">
                                <p className="section-kicker">{group.label}</p>
                                <span className="text-[11px]" style={{ color: 'var(--mf-muted)' }}>
                                    {group.items.length} sezioni
                                </span>
                            </div>
                            <div className="grid gap-2">
                                {group.items.map((item) => (
                                    <SettingsCommandRow key={item.id} item={item} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
