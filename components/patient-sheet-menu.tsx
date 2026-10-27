'use client';

import { useEffect, useId, useRef, useState, type ComponentPropsWithRef, type ReactNode, type RefObject } from 'react';
import styles from './patient-header.module.css';

type PatientSheetMenuProps = {
    label: string;
    trigger: (props: ComponentPropsWithRef<'button'>) => ReactNode;
    children: ReactNode;
    triggerRef?: RefObject<HTMLButtonElement | null>;
    onOpen?: () => void;
    className?: string;
};

export function PatientSheetMenu({ label, trigger, children, triggerRef: suppliedRef, onOpen, className = '' }: PatientSheetMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const ownTriggerRef = useRef<HTMLButtonElement>(null);
    const triggerRef = suppliedRef ?? ownTriggerRef;
    const menuRef = useRef<HTMLDivElement>(null);
    const initialFocus = useRef<'first' | 'last'>('first');
    const menuId = useId();
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
        const observer = new ResizeObserver(position);
        if (menuRef.current) observer.observe(menuRef.current);
        const closeOutside = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside);
        return () => {
            observer.disconnect();
            document.removeEventListener('pointerdown', closeOutside);
            window.removeEventListener('resize', position);
            window.removeEventListener('scroll', position, true);
        };
    }, [isOpen, triggerRef]);
    return <div ref={rootRef} className={`${styles.actionsMenu} ${className}`} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
    }}>
        {trigger({ ref: triggerRef, type: 'button', 'aria-expanded': isOpen, 'aria-haspopup': 'menu', 'aria-controls': isOpen ? menuId : undefined,
            onClick: () => isOpen ? close() : open(), onKeyDown: event => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault(); open(event.key === 'ArrowUp' ? 'last' : 'first');
                }
            } })}
        {isOpen ? <div id={menuId} ref={menuRef} role="menu" aria-label={label}
            className={`mf-popover ${styles.menu}`} onClick={event => {
                const item = event.target instanceof Element ? event.target.closest('[role="menuitem"]') : null;
                if (item) close(item instanceof HTMLButtonElement && event.currentTarget.contains(document.activeElement));
            }} onKeyDown={event => {
                const candidates = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
                const index = candidates.indexOf(document.activeElement as HTMLElement);
                let next: number | undefined;
                if (event.key === 'ArrowDown') next = (index + 1) % candidates.length;
                if (event.key === 'ArrowUp') next = (index - 1 + candidates.length) % candidates.length;
                if (event.key === 'Home') next = 0;
                if (event.key === 'End') next = candidates.length - 1;
                if (next !== undefined) { event.preventDefault(); candidates[next]?.focus(); }
                else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            }}>
            {children}
        </div> : null}
    </div>;
}
