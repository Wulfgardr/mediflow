'use client';

import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import styles from './patient-header.module.css';

type PatientSheetActionsMenuProps = {
    editHref: string;
    canShareFhirFile: boolean;
    onExportFhir: () => void;
    onShareFhir: () => void;
    onReportPdf: () => void;
    leadingActions?: readonly { label: string; onSelect: () => void }[];
    triggerRef?: RefObject<HTMLButtonElement | null>;
    onOpen?: () => void;
};

export function PatientSheetActionsMenu({ editHref, canShareFhirFile, onExportFhir, onShareFhir,
    onReportPdf, leadingActions = [], triggerRef: suppliedRef, onOpen }: PatientSheetActionsMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const ownTriggerRef = useRef<HTMLButtonElement>(null);
    const triggerRef = suppliedRef ?? ownTriggerRef;
    const menuRef = useRef<HTMLDivElement>(null);
    const initialFocus = useRef<'first' | 'last'>('first');
    const menuId = useId();
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const close = (restoreFocus = true) => {
        setIsOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    };
    const open = (edge: 'first' | 'last' = 'first') => {
        onOpen?.();
        initialFocus.current = edge;
        setIsOpen(true);
    };
    useEffect(() => {
        if (!isOpen) return;
        const candidates = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const position = () => {
            const menu = menuRef.current, trigger = triggerRef.current;
            if (!menu || !trigger) return;
            const anchor = trigger.getBoundingClientRect();
            const viewportWidth = document.documentElement.clientWidth;
            menu.style.left = `${Math.max(8, Math.min(anchor.right - menu.offsetWidth, viewportWidth - menu.offsetWidth - 8))}px`;
            menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - menu.offsetHeight - 8))}px`;
        };
        position();
        (initialFocus.current === 'last' ? candidates.at(-1) : candidates[0])?.focus();
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        const closeOutside = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside);
        return () => {
            document.removeEventListener('pointerdown', closeOutside);
            window.removeEventListener('resize', position);
            window.removeEventListener('scroll', position, true);
        };
    }, [isOpen, triggerRef]);
    const run = (action: () => void) => { close(); action(); };
    const itemClass = 'mf-popover-row';
    return <div ref={rootRef} className={styles.actionsMenu} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
    }}>
        <Button ref={triggerRef} variant="secondary" aria-expanded={isOpen} aria-haspopup="menu" aria-controls={menuId}
            onClick={() => isOpen ? close() : open()} onKeyDown={event => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault(); open(event.key === 'ArrowUp' ? 'last' : 'first');
                }
            }}>
            <MoreHorizontal size={16} aria-hidden="true" />Azioni
        </Button>
        {isOpen ? <div id={menuId} ref={menuRef} role="menu" aria-label="Azioni scheda"
            className={`mf-popover ${styles.menu}`} onKeyDown={event => {
                const candidates = items();
                const index = candidates.indexOf(document.activeElement as HTMLElement);
                let next: number | undefined;
                if (event.key === 'ArrowDown') next = (index + 1) % candidates.length;
                if (event.key === 'ArrowUp') next = (index - 1 + candidates.length) % candidates.length;
                if (event.key === 'Home') next = 0;
                if (event.key === 'End') next = candidates.length - 1;
                if (next !== undefined) { event.preventDefault(); candidates[next]?.focus(); }
                else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            }}>
            {leadingActions.map(action => <button key={action.label} type="button" role="menuitem" tabIndex={-1}
                className={itemClass} onClick={() => run(action.onSelect)}>{action.label}</button>)}
            <Link href={editHref} role="menuitem" tabIndex={-1} className={itemClass} onClick={() => close(false)}>Modifica</Link>
            <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => run(onExportFhir)}>Esporta FHIR</button>
            {canShareFhirFile ? <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => run(onShareFhir)}>Condividi FHIR</button> : null}
            <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => run(onReportPdf)}>Report PDF</button>
            <Link href={editHref} role="menuitem" tabIndex={-1} className={itemClass} onClick={() => close(false)}>Archivia</Link>
        </div> : null}
    </div>;
}
