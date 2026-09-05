'use client';

/* @Codex WUL-UIUX: progressive disclosure per la Scheda. I gestori operativi
   pesanti si aprono su richiesta, cosi su pazienti complessi la pagina si apre
   corta e prioritizzata invece di una catena di pannelli sempre espansi.
   Stile invariato (superficie, radius, colori): cambia solo la disposizione. */

import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useRuntimeTwinDesign, useRuntimeTwinFolder } from '@/components/runtime-twin-design';

interface CollapsibleSectionProps {
    id?: string;
    kicker?: string;
    title: string;
    icon?: LucideIcon;
    /* Conteggio mostrato nel chip a destra (es. "3 attive"). */
    count?: string | number;
    /* Riga di sintesi mostrata quando la sezione e chiusa: deve essere onesta e
       utile (cosa c'e dentro), non meta-testo. */
    summary?: string;
    defaultOpen?: boolean;
    /* @Codex WUL-UIUX: mantiene i figli montati anche da chiusi (solo nascosti).
       Va usato per i gestori con form, cosi una compilazione a meta non si perde
       quando la sezione viene collassata. Per default i figli si smontano da
       chiusi (lazy mount) per tenere la pagina leggera. */
    keepMounted?: boolean;
    /* Classe della superficie Lume, cosi la sezione si allinea alla colonna in
       cui vive (es. patient-detail-side-section nella colonna stretta). */
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
    surfaceClassName = 'patient-detail-section border',
    children,
}: CollapsibleSectionProps) {
    const [open, setOpen] = useState(defaultOpen);
    const reactId = useId();
    const regionId = `${reactId}-region`;
    const { composition } = useRuntimeTwinDesign();
    const folderSection = useRuntimeTwinFolder();
    const folderActive = folderSection === id || (composition === 'stream' && folderSection === 'quadro' && id === 'timeline');
    const expanded = open || folderActive;
    // A visited proposal pane retains its form even when navigating elsewhere.
    const [visited, setVisited] = useState(false);
    if (folderActive && !visited) setVisited(true);

    /* @Codex WUL-UIUX: defaultOpen puo diventare true dopo il caricamento dati
       (es. attentionCount 0 -> N): useState lo legge solo al mount. Apriamo sul
       fronte false->true col pattern React "adjust state during render" (niente
       effetto), senza richiudere cio che l'utente ha aperto ne riaprire cio che
       ha chiuso a mano. */
    const [prevDefaultOpen, setPrevDefaultOpen] = useState(defaultOpen);
    if (defaultOpen !== prevDefaultOpen) {
        setPrevDefaultOpen(defaultOpen);
        if (defaultOpen) setOpen(true);
    }

    /* Se si naviga verso l'ancora della sezione, la si apre per non lasciare
       l'utente davanti a un contenitore vuoto. */
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

    const HeadingControl = folderActive ? 'div' : 'button';
    return (
        <section id={id} data-folder-pane={id} data-folder-active={folderActive} className={`${surfaceClassName} scroll-mt-28`}>
            {/* @Codex WUL-UIUX: il titolo è un heading che contiene il controllo
                di disclosure — pattern W3C APG. Gli screen reader possono saltare
                di sezione in sezione per livello, non solo per anchor. */}
            <h3 className="m-0">
                <HeadingControl
                    type={folderActive ? undefined : "button"}
                    onClick={folderActive ? undefined : () => setOpen((value) => !value)}
                    aria-expanded={folderActive ? undefined : expanded}
                    aria-controls={folderActive ? undefined : regionId}
                    className="flex w-full items-center gap-3 rounded-[inherit] p-5 text-left md:p-6"
                >
                    <span className="min-w-0 flex-1">
                        {kicker && !folderSection ? <span className="section-kicker">{kicker}</span> : null}
                        <span className="mt-1 flex items-center gap-2 text-lg font-semibold text-ink">
                            {Icon ? <Icon className="h-5 w-5 text-muted" /> : null}
                            {title}
                        </span>
                        {!expanded && summary ? (
                            <span className="mt-1 block truncate text-sm text-muted">{summary}</span>
                        ) : null}
                    </span>
                    {count !== undefined && count !== '' ? (
                        <span className="apple-chip shrink-0">{count}</span>
                    ) : null}
                    {!folderActive ? <ChevronDown
                        className={`h-5 w-5 shrink-0 text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                        aria-hidden
                    /> : null}
                </HeadingControl>
            </h3>
            <div id={regionId} hidden={!expanded} className="px-5 pb-5 md:px-6 md:pb-6">
                {keepMounted || expanded || visited ? children : null}
            </div>
        </section>
    );
}
