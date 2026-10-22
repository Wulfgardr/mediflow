'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { DisclosureControl } from '@/components/disclosure';
import { useRuntimeTwinFolder } from '@/components/runtime-twin-design';

interface CollapsibleSectionProps {
    id?: string;
    kicker?: string;
    title: string;
    icon?: LucideIcon;
    count?: string | number;
    summary?: string;
    defaultOpen?: boolean;
    keepMounted?: boolean;
    surfaceClassName?: string;
    children: ReactNode;
}

export function CollapsibleSection({
    id,
    kicker,
    title,
    icon: Icon,
    count,
    summary,
    defaultOpen = false,
    keepMounted = false,
    surfaceClassName = 'patient-detail-section',
    children,
}: CollapsibleSectionProps) {
    const [open, setOpen] = useState(defaultOpen);
    const reactId = useId();
    const regionId = `${reactId}-region`;
    const folderSection = useRuntimeTwinFolder();
    const folderActive = folderSection === id || (folderSection === 'quadro' && id === 'diario');
    const expanded = open || folderActive;
    const [visited, setVisited] = useState(false);
    if (expanded && !visited) setVisited(true);

    const [prevDefaultOpen, setPrevDefaultOpen] = useState(defaultOpen);
    if (defaultOpen !== prevDefaultOpen) {
        setPrevDefaultOpen(defaultOpen);
        if (defaultOpen) setOpen(true);
    }

    useEffect(() => {
        if (!id) return;
        const openIfTargeted = () => {
            if (window.location.hash === `#${id}`) {
                setOpen(true);
            }
        };
        openIfTargeted();
        window.addEventListener('hashchange', openIfTargeted);
        return () => window.removeEventListener('hashchange', openIfTargeted);
    }, [id]);

    return (
        <section id={id} data-folder-pane={id} data-folder-active={folderActive} className={`${surfaceClassName} scroll-mt-28 border-0 shadow-none`}>
            <h3 className="m-0 px-5 md:px-6">
                {folderActive ? <div className="flex items-center gap-3 py-5 md:py-6"><span className="mt-1 flex min-w-0 flex-1 items-center gap-2 text-lg font-semibold text-ink">{Icon ? <Icon className="h-5 w-5 text-muted" aria-hidden="true" /> : null}{title}</span>{count !== undefined && count !== '' ? <span className="ml-3 apple-chip">{count}</span> : null}</div>
                    : <DisclosureControl expanded={expanded} controls={regionId} onToggle={() => setOpen(value => !value)}>
                        {kicker && !folderSection ? <span className="section-kicker">{kicker}</span> : null}
                        <span className="flex items-center gap-2">{Icon ? <Icon size={20} aria-hidden="true" /> : null}{title}
                            {count !== undefined && count !== '' ? <span className="apple-chip">{count}</span> : null}</span>
                        {!expanded && summary ? <span className="block text-sm text-muted">{summary}</span> : null}
                    </DisclosureControl>}
            </h3>
            <div id={regionId} hidden={!expanded} className="px-5 pb-5 md:px-6 md:pb-6">
                {keepMounted || expanded || visited ? children : null}
            </div>
        </section>
    );
}
