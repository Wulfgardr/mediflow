'use client';

import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

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
                            "relative z-10 flex h-11 w-11 items-center justify-center rounded-full border transition-[background-color,border-color,color] duration-[var(--lume-dur-fuoco)] ease-[var(--lume-ease)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lume-accent)]",
                            isActive
                                ? "border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:var(--lume-surface-focal)] text-[color:var(--lume-ink)] shadow-[var(--lume-shadow-focal)]"
                                : "border-transparent text-[color:var(--lume-ink-muted)] hover:bg-[color:color-mix(in_srgb,var(--lume-ink)_5%,transparent)] hover:text-[color:var(--lume-ink)]"
                        )}
                        title={tab.label}
                        aria-label={`Tema ${tab.label}`}
                    >
                        <tab.icon className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                );
            })}
        </div>
    );
}
