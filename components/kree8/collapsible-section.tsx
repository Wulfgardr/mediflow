'use client';

/* WUL-UIUX: i gestori pesanti si montano alla prima apertura; quelli con
   bozze restano montati per conservarle quando la sezione viene chiusa. */

import { useEffect, useId, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { DisclosureControl } from '@/components/disclosure';
import { useRuntimeTwinFolder } from '@/components/runtime-twin-design';

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

    return (
        <section id={id} data-folder-pane={id} data-folder-active={folderActive} className={`${surfaceClassName} scroll-mt-28 border-0 shadow-none`}>
            {/* Il titolo resta un heading che contiene il controllo, come nel
                pattern W3C APG: è raggiungibile per livello dagli screen reader.
                La cartella attiva espone solo il titolo, senza controllo. */}
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
