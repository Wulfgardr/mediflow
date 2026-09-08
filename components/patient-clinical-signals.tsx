'use client';

/* @Codex WUL-UIUX: striscia di segnali clinici sopra la piega. Su pazienti
   complessi dà i numeri che contano subito (problemi, terapie, parametri,
   referti, prossimo passaggio) senza scorrere i pannelli. Stile Lume invariato. */

import type { LucideIcon } from 'lucide-react';
import styles from '@/components/patient-disclosure.module.css';

export type ClinicalSignalTone = 'neutral' | 'primary' | 'warning' | 'critical';

export interface ClinicalSignal {
    label: string;
    value: string | number;
    hint?: string;
    icon?: LucideIcon;
    tone?: ClinicalSignalTone;
}

const TONE_VALUE_CLASS: Record<ClinicalSignalTone, string> = {
    neutral: 'text-[color:var(--lume-ink)]',
    primary: 'text-[color:var(--lume-accent)] dark:text-[color:rgb(150,224,204)]',
    warning: 'text-[color:var(--lume-signal-warning)] dark:text-[color:rgb(230,180,120)]',
    critical: 'text-[color:var(--lume-signal-critical)] dark:text-[color:rgb(240,150,140)]',
};

export function PatientClinicalSignals({ signals }: { signals: ClinicalSignal[] }) {
    if (signals.length === 0) return null;

    return (
        <dl className={styles.signals}>
            {signals.map((signal) => {
                const Icon = signal.icon;
                const tone = signal.tone ?? 'neutral';
                return (
                    <div
                        key={signal.label}
                        className={`${styles.signal} rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/72 px-4 py-3 dark:border-[color:rgba(255,247,240,0.1)] dark:bg-white/5`}
                    >
                        <dt className={styles.signalLabel}>
                            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                            {signal.label}
                        </dt>
                        <dd className={`${styles.signalValue} ${TONE_VALUE_CLASS[tone]}`}>
                            {signal.value}
                        </dd>
                        {signal.hint ? (
                            <dd className={styles.signalHint}>
                                {signal.hint}
                            </dd>
                        ) : null}
                    </div>
                );
            })}
        </dl>
    );
}
