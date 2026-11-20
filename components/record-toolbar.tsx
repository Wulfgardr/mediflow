'use client';

import type { KeyboardEvent, ReactNode } from 'react';

const itemSelector = 'a[href], button:not([disabled])';

function toolbarItems(root: HTMLElement) {
    return [...root.querySelectorAll<HTMLElement>(itemSelector)].filter(item => !item.closest('[role="menu"]') && item.getClientRects().length > 0);
}

function keepOneStop(root: HTMLElement, current?: HTMLElement) {
    const items = toolbarItems(root);
    const stop = current && items.includes(current) ? current : items[0];
    for (const item of items) item.tabIndex = item === stop ? 0 : -1;
}

function watchToolbar(root: HTMLDivElement | null) {
    if (!root) return;
    keepOneStop(root);
    const observer = new MutationObserver(() => keepOneStop(root, root.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined));
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
}

const moves: Record<string, (index: number, count: number) => number> = {
    ArrowRight: (index, count) => (index + 1) % count,
    ArrowLeft: (index, count) => (index - 1 + count) % count,
    Home: () => 0,
    End: (_index, count) => count - 1,
};

export function RecordToolbar({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const move = moves[event.key];
        if (!move || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const items = toolbarItems(event.currentTarget);
        const index = items.indexOf(event.target as HTMLElement);
        if (index < 0) return;
        event.preventDefault();
        const next = items[move(index, items.length)];
        keepOneStop(event.currentTarget, next);
        next.focus();
    };
    return <div ref={watchToolbar} role="toolbar" aria-label={label} className={className} onKeyDown={onKeyDown}
        onFocus={event => { if (toolbarItems(event.currentTarget).includes(event.target as HTMLElement)) keepOneStop(event.currentTarget, event.target as HTMLElement); }}>
        {children}
    </div>;
}
