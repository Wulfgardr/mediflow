'use client';

/* @Codex */
import Link from 'next/link';
/* @Codex */
import { usePathname } from 'next/navigation';
/* @Codex */
import { Activity, LayoutDashboard, Settings, Users } from 'lucide-react';
/* @Codex */
import { ThemeToggle } from '@/components/theme-toggle';
/* @Codex */
import { useSecurity } from '@/components/security-provider';
/* @Codex */
import { cn } from '@/lib/utils';

/* @Codex */
const MOBILE_LINKS = [
    { href: '/', name: 'Pazienti', icon: Users },
    { href: '/diary', name: 'Diario', icon: LayoutDashboard },
    { href: '/scales', name: 'Scale', icon: Activity },
    { href: '/settings', name: 'Impostazioni', icon: Settings },
];

/* @Codex */
export function MobileShellChrome() {
    const pathname = usePathname();
    const { user } = useSecurity();

    return (
        <>
            <header className="xl:hidden">
                <div className="glass-panel mb-4 flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                        <Link href="/" className="inline-flex items-center gap-2">
                            <span className="text-base font-black tracking-tight text-slate-900 dark:text-white">
                                MediFlow
                            </span>
                        </Link>
                        <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                            {user?.displayName || 'Sessione attiva'}
                        </p>
                    </div>
                    <ThemeToggle />
                </div>
            </header>

            <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-black/5 bg-white/88 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/88 xl:hidden">
                <div className="mx-auto grid max-w-md grid-cols-4 gap-2">
                    {MOBILE_LINKS.map((link) => {
                        const Icon = link.icon;
                        const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));

                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    'flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2.5 text-[11px] font-medium transition-[background-color,color,box-shadow]',
                                    isActive
                                        ? 'bg-sky-500/10 text-sky-700 shadow-[0_8px_20px_rgba(14,165,233,0.14)] dark:bg-sky-500/15 dark:text-sky-300'
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
