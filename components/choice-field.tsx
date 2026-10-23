'use client';

import { Children, isValidElement, useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import styles from './choice-field.module.css';

type ChoiceFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
    label: string;
    hideLabel?: boolean;
    description?: ReactNode;
    disabledReason?: string;
    error?: string | null;
};

function optionText(children: ReactNode): string {
    return Children.toArray(children).map(child => isValidElement<{ children?: ReactNode }>(child)
        ? optionText(child.props.children) : String(child)).join('');
}

function selectedText(children: ReactNode, value: ChoiceFieldProps['value']): string | undefined {
    for (const child of Children.toArray(children)) {
        if (!isValidElement<{ children?: ReactNode; value?: string | number }>(child)) continue;
        if (child.type === 'option' && String(child.props.value ?? optionText(child.props.children)) === String(value)) return optionText(child.props.children);
        if (child.type === 'optgroup') {
            const found = selectedText(child.props.children, value);
            if (found !== undefined) return found;
        }
    }
}

export function ChoiceField({ label, hideLabel = false, description, disabledReason, error, children,
    id, className = '', disabled, 'aria-describedby': describedBy, 'aria-invalid': invalid, title, ...props }: ChoiceFieldProps) {
    const generatedId = useId();
    const fieldId = id ?? `${generatedId}-choice`;
    const hint = description || (disabled && disabledReason);
    const descriptions = [describedBy, hint && `${fieldId}-hint`, error && `${fieldId}-error`].filter(Boolean).join(' ') || undefined;
    return <div className={styles.field} data-choice-field>
        <label htmlFor={fieldId} className={hideLabel ? styles.hiddenLabel : undefined}>{label}</label>
        <select {...props} id={fieldId} className={`${styles.control} ${className}`} disabled={disabled}
            aria-describedby={descriptions} aria-invalid={error ? true : invalid}
            title={title ?? selectedText(children, props.value ?? props.defaultValue)}>{children}</select>
        {hint && <p id={`${fieldId}-hint`} className={styles.hint}>{description}{description && disabled && disabledReason ? ' ' : ''}{disabled && disabledReason}</p>}
        {error && <p id={`${fieldId}-error`} className={styles.error} role="alert">{error}</p>}
    </div>;
}
