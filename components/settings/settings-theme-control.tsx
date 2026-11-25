'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import surface from '@/components/record-surface.module.css';
import { useTheme } from '@/components/theme-provider';

const THEMES = [
    { id: 'light', label: 'Chiaro', Icon: Sun },
    { id: 'dark', label: 'Scuro', Icon: Moon },
    { id: 'system', label: 'Sistema', Icon: Monitor },
] as const;

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function SettingsThemeControl() {
    const { theme, setTheme } = useTheme();
    const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);

    return (
        <div role="group" aria-label="Tema interfaccia" className={surface.segmented} data-lume-control="theme">
            {THEMES.map(({ id, label, Icon }) => (
                <button key={id} type="button" aria-label={`Tema ${label}`}
                    aria-pressed={hydrated && theme === id} onClick={() => setTheme(id)} data-lume-control="theme">
                    <Icon size={14} aria-hidden="true" />
                    {label}
                </button>
            ))}
        </div>
    );
}
