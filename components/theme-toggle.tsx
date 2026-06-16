'use client';

import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { useId, useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const indicatorLayoutId = useId();

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return <div className="w-[88px] h-8 bg-gray-200/50 dark:bg-white/5 rounded-full animate-pulse mx-auto" />;
    }

    const tabs = [
        { id: 'light', icon: Sun, label: 'Chiaro' },
        { id: 'dark', icon: Moon, label: 'Scuro' },
        { id: 'system', icon: Monitor, label: 'Sistema' },
    ] as const;

    return (
        <div
            className="relative mx-auto flex w-fit rounded-full border p-0.5 shadow-inner"
            style={{
                backgroundColor: 'var(--glass-bg)',
                borderColor: 'var(--glass-border)',
            }}
        >
            {tabs.map((tab) => {
                const isActive = theme === tab.id;
                return (
                    <button
                        key={tab.id}
                        onClick={() => setTheme(tab.id)}
                        className={cn(
                            "relative z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/30",
                            isActive
                                ? "text-[color:var(--mf-ink)]"
                                : "text-[color:var(--mf-muted)] hover:text-[color:var(--mf-ink)]"
                        )}
                        title={tab.label}
                        aria-label={`Tema ${tab.label}`}
                    >
                        {isActive && (
                            <motion.div
                                layoutId={`theme-indicator-${indicatorLayoutId}`}
                                className="absolute inset-0 rounded-full border border-[color:var(--glass-border)] bg-[color:var(--mf-bg-elevated)] shadow-[0_2px_4px_rgba(15,23,42,0.08)]"
                                transition={{
                                    type: "spring",
                                    stiffness: 500,
                                    damping: 30
                                }}
                                style={{ zIndex: -1 }}
                            />
                        )}
                        <tab.icon className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                );
            })}
        </div>
    );
}
