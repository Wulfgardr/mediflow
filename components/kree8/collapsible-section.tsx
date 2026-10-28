'use client';

/* WUL-UIUX: i gestori pesanti si montano alla prima apertura; quelli con
   bozze restano montati per conservarle quando la sezione viene chiusa. */

import { useEffect, useId, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { DisclosureControl } from '@/components/disclosure';
import { useRuntimeTwinFolder } from '@/components/runtime-twin-design';
import sectionRecipe from '@/components/ink-section.module.css';

interface CollapsibleSectionProps {
    id?: string;
    kicker?: string;
    title: string;
    icon?: LucideIcon;
    /* Conteggio mostrato nel chip a destra (es. "3 attive"). */
    count?: string | number;
    /* Da chiusa, descrive cosa contiene la sezione con una sintesi utile. */
    summary?: string;
    defaultOpen?: boolean;
    /* Monta i figli subito, anche da chiusa. Senza keepMounted il primo
       montaggio è a richiesta; dopo ogni apertura visited conserva i figli
       nascosti, così chiudere o cambiare sezione non perde form e bozze. */
    keepMounted?: boolean;
    /* Allinea la superficie Lume alla colonna che ospita la sezione. */
    surfaceClassName?: string;
    headerAction?: ReactNode;
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
    headerAction,
}: CollapsibleSectionProps) {
    const [open, setOpen] = useState(defaultOpen);
    const reactId = useId();
    const regionId = `${reactId}-region`;
    const folderSection = useRuntimeTwinFolder();
    const folderActive = folderSection === id || (folderSection === 'quadro' && id === 'diario');
    const expanded = open || folderActive;
    // Ogni apertura (controllo, cartella, defaultOpen o ancora) conserva le bozze.
    const [visited, setVisited] = useState(false);
    if (expanded && !visited) setVisited(true);

    /* defaultOpen può passare da false a true dopo il caricamento dei dati.
       useState lo legge solo al mount: il pattern React «adjust state during
       render» apre sul fronte false→true senza effetto e senza richiudere sul
       fronte opposto. A valore invariato rispetta la chiusura manuale. */
    const [prevDefaultOpen, setPrevDefaultOpen] = useState(defaultOpen);
    if (defaultOpen !== prevDefaultOpen) {
        setPrevDefaultOpen(defaultOpen);
        if (defaultOpen) setOpen(true);
    }

    /* L'ancora apre la sezione anche all'arrivo diretto, evitando un
       contenitore chiuso come destinazione della navigazione. */
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

    const heading = (
        <h3 className={`${sectionRecipe.heading} ${headerAction ? '' : sectionRecipe.header}`}>
            {folderActive ? <div className="flex flex-wrap items-center gap-3"><span className={`${sectionRecipe.heading} flex min-w-0 flex-1 items-center gap-2 text-ink`}>{Icon ? <Icon className="h-5 w-5 text-muted" aria-hidden="true" /> : null}{title}</span>{' '}{count !== undefined && count !== '' ? <span className={sectionRecipe.count}>{count}</span> : null}</div>
                : <DisclosureControl expanded={expanded} controls={regionId} onToggle={() => setOpen(value => !value)}>
                    {kicker && !folderSection ? <span className="section-kicker">{kicker}</span> : null}
                    <span className={`${sectionRecipe.heading} flex items-center gap-2`}>{Icon ? <Icon size={20} aria-hidden="true" /> : null}{title}
                        {count !== undefined && count !== '' ? <span className={sectionRecipe.count}>{count}</span> : null}</span>
                    {!expanded && summary ? <span className={`${sectionRecipe.summary} block text-muted`}>{summary}</span> : null}
                </DisclosureControl>}
        </h3>
    );

    return (
        <section id={id} data-folder-pane={id} data-folder-active={folderActive} className={`${surfaceClassName} scroll-mt-28 border-0 shadow-none`}>
            {headerAction ? <div data-section-header className={sectionRecipe.header}>{heading}{headerAction}</div> : heading}
            <div id={regionId} hidden={!expanded} className="px-5 py-5 md:px-6 md:py-6">
                {keepMounted || expanded || visited ? children : null}
            </div>
        </section>
    );
}
