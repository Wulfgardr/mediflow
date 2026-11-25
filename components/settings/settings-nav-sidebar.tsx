'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SETTINGS_NAV_GROUPS, isSettingsItemActive } from '@/lib/settings-navigation';
import { cn } from '@/lib/utils';

import navigation from './settings-navigation.module.css';

function NavGroups({ pathname }: { pathname: string }) {
    return (
        <div className={navigation.groups}>
            {SETTINGS_NAV_GROUPS.map(group => (
                <div key={group.id}>
                    <p className={navigation.groupLabel}>{group.label}</p>
                    <ul className={navigation.items}>
                        {group.items.map(item => {
                            const active = isSettingsItemActive(item, pathname);
                            return (
                                <li key={item.id}>
                                    <Link
                                        href={item.href}
                                        aria-current={active ? 'page' : undefined}
                                        data-state={active ? 'active' : 'idle'}
                                        data-testid={`settings-nav-${item.id}`}
                                        className={cn(navigation.item, item.tone === 'danger' && navigation.danger)}
                                    >
                                        {item.label}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}

export function SettingsNavSidebar({ onSearchRequest }: { onSearchRequest?: () => void }) {
    const pathname = usePathname();
    const stripRef = useRef<HTMLDivElement>(null);
    const desktopRef = useRef<HTMLDivElement>(null);
    const [desktopOverflows, setDesktopOverflows] = useState(false);
    useEffect(() => {
        const desktop = desktopRef.current;
        const pane = desktop?.closest('aside');
        if (!desktop || !pane) return;
        const revealCurrent = () => {
            if (!pane.clientHeight || !desktop.clientHeight) return;
            setDesktopOverflows(pane.scrollHeight > pane.clientHeight + 1);
            const current = desktop.querySelector<HTMLElement>('[aria-current="page"]');
            if (!current) return;
            const item = current.getBoundingClientRect(), viewport = pane.getBoundingClientRect();
            const hintHeight = desktop.querySelector<HTMLElement>('[data-index-hint]')?.offsetHeight ?? 0;
            if (item.top < viewport.top + hintHeight) pane.scrollTop += item.top - viewport.top - hintHeight;
            else if (item.bottom > viewport.bottom) pane.scrollTop += item.bottom - viewport.bottom;
        };
        revealCurrent();
        const observer = new ResizeObserver(revealCurrent);
        observer.observe(pane);
        observer.observe(desktop);
        return () => observer.disconnect();
    }, [pathname]);
    useEffect(() => {
        const strip = stripRef.current;
        if (!strip) return;
        const revealCurrent = () => {
            const current = strip.querySelector<HTMLElement>('[aria-current="page"]');
            if (!current || !strip.clientWidth) return;
            const item = current.getBoundingClientRect(), viewport = strip.getBoundingClientRect();
            if (item.left < viewport.left) strip.scrollLeft += item.left - viewport.left;
            else if (item.right > viewport.right) strip.scrollLeft += item.right - viewport.right;
        };
        revealCurrent();
        const observer = new ResizeObserver(revealCurrent);
        observer.observe(strip);
        return () => observer.disconnect();
    }, [pathname]);
    return (
        <nav aria-label="Sezioni impostazioni" data-testid="settings-nav-sidebar" data-overview={pathname === "/settings" || pathname === "/settings/"} className={navigation.root}>
            <div ref={stripRef} data-settings-strip className={navigation.mobileStrip} aria-describedby="settings-scroll-hint">
                {SETTINGS_NAV_GROUPS.flatMap(group => group.items).map(item => {
                    const active = isSettingsItemActive(item, pathname);
                    return <Link key={item.id} href={item.href} data-testid={`settings-nav-mobile-${item.id}`}
                        data-state={active ? 'active' : 'idle'} aria-current={active ? 'page' : undefined}
                        className={cn(navigation.item, item.tone === 'danger' && navigation.danger)}>{item.label}</Link>;
                })}
            </div>
            <div className={navigation.mobileTools}>
                <span id="settings-scroll-hint" className={navigation.scrollHint}>Scorri per altre sezioni <span aria-hidden="true">↔</span></span>
                {onSearchRequest && <button type="button" onClick={onSearchRequest} aria-label="Cerca impostazione" data-testid="settings-search-trigger-mobile" className={navigation.mobileStripSearch}><Search size={16} aria-hidden="true" />Cerca impostazione</button>}
            </div>

            <div ref={desktopRef} className={navigation.desktopSidebar}>
                {desktopOverflows && <span data-index-hint className={navigation.desktopScrollHint}>Scorri l’indice <span aria-hidden="true">↕</span></span>}
                {onSearchRequest ? (
                    <button
                        type="button"
                        onClick={onSearchRequest}
                        data-testid="settings-search-trigger"
                        className={navigation.searchButton}
                    >
                        <span><Search aria-hidden="true" /> Cerca impostazione</span>
                        <kbd className={navigation.shortcut}>⌘K</kbd>
                    </button>
                ) : null}
                <NavGroups pathname={pathname} />
            </div>
        </nav>
    );
}
