'use client';

import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return <div className="w-[88px] h-8 bg-gray-200/50 rounded-full animate-pulse mx-auto" />;
    }

    const tabs = [
        { id: 'light', icon: Sun, label: 'Light' },
        { id: 'dark', icon: Moon, label: 'Dark' },
        { id: 'system', icon: Monitor, label: 'System' },
    ] as const;

    return (
        <div className="relative flex p-0.5 bg-system-gray-6 rounded-full border border-black/5 dark:border-white/5 w-fit mx-auto shadow-inner">
            {tabs.map((tab) => {
                const isActive = theme === tab.id;
                return (
                    <button
                        key={tab.id}
                        onClick={() => setTheme(tab.id)}
                        className={cn(
                            "relative z-10 flex items-center justify-center w-7 h-7 rounded-full transition-colors duration-200 focus:outline-none",
                            isActive
                                ? "text-foreground"
                                : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        )}
                        title={tab.label}
                        aria-label={tab.label}
                    >
                        {isActive && (
                            <motion.div
                                layoutId="theme-indicator"
                                className="absolute inset-0 bg-white dark:bg-gray-700 rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_4px_rgba(0,0,0,0.2)] border border-black/5 dark:border-white/5"
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
