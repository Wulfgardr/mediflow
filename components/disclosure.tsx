'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import styles from './disclosure.module.css';

type ControlProps = { expanded: boolean; controls: string; onToggle: () => void; children: ReactNode; label?: string };

export function DisclosureControl({ expanded, controls, onToggle, children, label }: ControlProps) {
    return <button type="button" className={styles.control} aria-expanded={expanded} aria-controls={controls}
        aria-label={label} onClick={onToggle} data-disclosure-control>
        <ChevronRight size={16} aria-hidden="true" className={expanded ? styles.expanded : undefined} />
        <span className={styles.label}>{children}</span>
    </button>;
}

type DisclosureProps = { title: ReactNode; children: ReactNode; id?: string; contentId?: string;
    className?: string; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void;
    headingLevel?: 2 | 3 | 4; label?: string; 'data-testid'?: string };

export function Disclosure({ title, children, id, contentId, className = '', defaultOpen = false,
    open, onOpenChange, headingLevel, label, 'data-testid': testId }: DisclosureProps) {
    const generatedId = useId();
    const [localOpen, setLocalOpen] = useState(defaultOpen);
    const expanded = open ?? localOpen;
    const regionId = contentId ?? `${generatedId}-content`;
    const control = <DisclosureControl expanded={expanded} controls={regionId} label={label}
        onToggle={() => { setLocalOpen(!expanded); onOpenChange?.(!expanded); }}>{title}</DisclosureControl>;
    const Heading = headingLevel ? `h${headingLevel}` as 'h2' | 'h3' | 'h4' : null;
    return <div id={id} className={`${styles.disclosure} ${className}`} data-disclosure data-expanded={expanded} data-testid={testId}>
        <div className={styles.header}>{Heading ? <Heading>{control}</Heading> : control}</div>
        <div id={regionId} hidden={!expanded} className={styles.content}>{children}</div>
    </div>;
}
