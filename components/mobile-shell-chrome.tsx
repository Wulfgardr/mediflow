'use client';

/* @Codex */
import Link from 'next/link';
/* @Codex */
import { usePathname } from 'next/navigation';
/* @Codex */
import { Activity, BarChart3, LayoutDashboard, Settings, Users } from 'lucide-react';
/* @Codex */
import { ThemeToggle } from '@/components/theme-toggle';
/* @Codex */
import { useSecurity } from '@/components/security-provider';
/* @Codex */
import { cn } from '@/lib/utils';

/* @Codex */
const MOBILE_LINKS: Array<{ href: string; name: string; icon: typeof Users; matchPrefixes?: string[] }> = [
    { href: '/', name: 'Pazienti', icon: Users, matchPrefixes: ['/patients'] },
    { href: '/diary', name: 'Diario', icon: LayoutDashboard },
    { href: '/scales', name: 'Scale', icon: Activity },
    { href: '/settings', name: 'Impostazioni', icon: Settings },
];

/* @Codex */
const MOBILE_SECONDARY_LINKS: Array<{ href: string; label: string; icon: typeof Users }> = [
    { href: '/analytics', label: 'Analisi', icon: BarChart3 },
];

/* @Codex */
export function MobileShellChrome() {
    const pathname = usePathname();
    const { user } = useSecurity();

    return (
        <>
            <header className="xl:hidden">
                <div className="mediflow-mobile-header glass-panel mb-4 flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                        <Link href="/" className="inline-flex items-center gap-2">
                            <span className="bg-[linear-gradient(135deg,var(--mf-primary),var(--mf-accent),var(--mf-plum))] bg-clip-text text-base font-black tracking-tight text-transparent">
                                MediFlow
                            </span>
                        </Link>
                        <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                            {user?.displayName || 'Sessione locale'}
                        </p>
                    </div>
                    <div className="flex items-center gap-1">
                        {MOBILE_SECONDARY_LINKS.map((entry) => {
                            const EntryIcon = entry.icon;
                            const isActive = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
                            return (
                                <Link
                                    key={entry.href}
                                    href={entry.href}
                                    aria-label={entry.label}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={cn(
                                        'inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/60 text-[color:var(--mf-muted)] transition-colors hover:text-[color:var(--mf-primary)] dark:bg-white/6',
                                        isActive && 'text-[color:var(--mf-primary)] bg-[color:rgba(15,123,104,0.1)] border-[color:rgba(15,123,104,0.22)]',
                                    )}
                                >
                                    <EntryIcon className="h-4 w-4" />
                                </Link>
                            );
                        })}
                        <ThemeToggle />
                    </div>
                </div>
            </header>

            <nav className="mediflow-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-[color:rgba(112,106,100,0.12)] bg-[color:rgba(255,249,240,0.9)] px-3 pt-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/88 xl:hidden">
                <div className="mx-auto grid max-w-md grid-cols-4 gap-2">
                    {MOBILE_LINKS.map((link) => {
                        const Icon = link.icon;
                        const prefixMatch = link.matchPrefixes?.some((p) => pathname === p || pathname.startsWith(`${p}/`));
                        const isActive = pathname === link.href
                            || (link.href !== '/' && pathname.startsWith(link.href))
                            || !!prefixMatch;

                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                aria-current={isActive ? 'page' : undefined}
                                className={cn(
                                    'mediflow-mobile-link flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2.5 text-[11px] font-medium transition-[background-color,color,box-shadow]',
                                    isActive
                                        ? 'bg-[color:rgba(15,123,104,0.1)] text-[color:var(--mf-primary)] shadow-[0_8px_20px_rgba(15,123,104,0.12)] dark:bg-[color:rgba(15,123,104,0.16)]'
                                        : 'text-slate-500 hover:bg-black/5 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white',
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                <span>{link.name}</span>
                            </Link>
                        );
                    })}
                </div>
            </nav>
        </>
    );
}
