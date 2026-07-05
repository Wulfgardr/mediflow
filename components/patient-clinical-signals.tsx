'use client';

/* @Codex WUL-UIUX: striscia di segnali clinici sopra la piega. Su pazienti
   complessi dà i numeri che contano subito (problemi, terapie, parametri,
   referti, prossimo passaggio) senza scorrere i pannelli. Stile glass invariato. */

import type { LucideIcon } from 'lucide-react';

export type ClinicalSignalTone = 'neutral' | 'primary' | 'warning' | 'critical';

export interface ClinicalSignal {
    label: string;
    value: string | number;
    hint?: string;
    icon?: LucideIcon;
    tone?: ClinicalSignalTone;
}

const TONE_VALUE_CLASS: Record<ClinicalSignalTone, string> = {
    neutral: 'text-[color:var(--mf-ink)]',
    primary: 'text-[color:var(--mf-primary)] dark:text-[color:rgb(150,224,204)]',
    warning: 'text-[color:var(--mf-warning)] dark:text-[color:rgb(230,180,120)]',
    critical: 'text-[color:var(--mf-critical)] dark:text-[color:rgb(240,150,140)]',
};

export function PatientClinicalSignals({ signals }: { signals: ClinicalSignal[] }) {
    if (signals.length === 0) return null;

    return (
        <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
        >
            {signals.map((signal) => {
                const Icon = signal.icon;
                const tone = signal.tone ?? 'neutral';
                return (
                    <div
                        key={signal.label}
                        className="rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/72 px-4 py-3 dark:border-[color:rgba(255,247,240,0.1)] dark:bg-white/5"
                    >
                        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                            {signal.label}
                        </p>
                        <p className={`mt-1.5 text-[22px] font-semibold leading-none tabular-nums ${TONE_VALUE_CLASS[tone]}`}>
                            {signal.value}
                        </p>
                        {signal.hint ? (
                            <p className="mt-1 truncate text-[11px] text-[color:var(--mf-muted)]" title={signal.hint}>
                                {signal.hint}
                            </p>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
