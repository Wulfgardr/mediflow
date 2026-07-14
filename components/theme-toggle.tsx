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
        return <div className="mx-auto h-8 w-[88px] rounded-full bg-[color:var(--lume-surface-field)]" />;
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
                backgroundColor: 'var(--lume-surface-field)',
                borderColor: 'color-mix(in srgb, var(--lume-ink) 10%, transparent)',
            }}
        >
            {tabs.map((tab) => {
                const isActive = theme === tab.id;
                return (
                    <button
                        key={tab.id}
                        onClick={() => setTheme(tab.id)}
                        className={cn(
                            "relative z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lume-accent)]",
                            isActive
                                ? "text-[color:var(--lume-ink)]"
                                : "text-[color:var(--lume-ink-muted)] hover:text-[color:var(--lume-ink)]"
                        )}
                        title={tab.label}
                        aria-label={`Tema ${tab.label}`}
                    >
                        {isActive && (
                            <motion.div
                                layoutId={`theme-indicator-${indicatorLayoutId}`}
                                className="absolute inset-0 rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-focal)] shadow-[0_2px_8px_color-mix(in_srgb,var(--lume-ink)_10%,transparent)]"
                                transition={{
                                    type: "tween",
                                    duration: 0.165,
                                    ease: [0.22, 0.61, 0.36, 1],
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
