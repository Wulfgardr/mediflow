'use client';

/* @Codex WUL-676: keep native range semantics, steps and keyboard handling. */
import type { ComponentProps, CSSProperties } from 'react';
import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';
import styles from './range-input.module.css';

type RangeInputProps = Omit<ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'min' | 'max'> & {
    min: number;
    max: number;
    value: number;
};

export function RangeInput({ min, max, value, className, style, ...props }: RangeInputProps) {
    const { proposal } = useRuntimeTwinDesign();
    const progress = max > min ? Math.min(100, Math.max(0, (value - min) / (max - min) * 100)) : 0;
    const control = <input
        {...props}
        type="range"
        min={min}
        max={max}
        value={value}
        className={`${styles.input} ${className ?? ''}`}
        style={style}
    />;
    return proposal
        ? <span className={styles.root} style={{ '--range-progress': `${progress}%` } as CSSProperties}>
            <span className={styles.track} aria-hidden="true" />
            {control}
        </span>
        : control;
}
