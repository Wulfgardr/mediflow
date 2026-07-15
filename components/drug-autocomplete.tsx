'use client';

import { useState, useRef, useEffect, useId } from 'react';
import type { AifaDrug } from '@/lib/db';
import {
    commitDrugAutocompleteQueryChange,
    createDrugAutocompleteSearch,
} from '@/lib/drug-autocomplete-search';
import { Search, X, Pill, Database, Activity } from 'lucide-react';

interface DrugAutocompleteProps {
    onSelect: (drug: AifaDrug) => void;
    placeholder?: string;
    autoFocus?: boolean;
    defaultValue?: string;
}

const drugInputClassName = 'mf-input h-11 px-3 py-2.5 pl-9 pr-9 text-sm';
const drugPopoverClassName = 'absolute z-[100] mt-2 max-h-80 w-full overflow-y-auto rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-2 shadow-[0_2px_8px_color-mix(in_srgb,var(--lume-ink)_10%,transparent)]';
const drugRowClassName = 'w-full rounded-[var(--lume-radius-control)] px-3 py-3 text-left transition-[background-color] duration-[var(--lume-dur-riga)] hover:bg-[color:var(--lume-surface-focal)] focus:bg-[color:var(--lume-surface-focal)] focus:outline-none';

export default function DrugAutocomplete({ onSelect, placeholder = "Cerca per nome o principio attivo...", autoFocus = false, defaultValue = "" }: DrugAutocompleteProps) {
    const [query, setQuery] = useState(defaultValue);
    const [results, setResults] = useState<AifaDrug[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    /* @Codex WUL-UIUX (Fase 5): pattern combobox ARIA + navigazione da tastiera. */
    const [activeIndex, setActiveIndex] = useState(-1);
    const listboxId = useId();
    const optionId = (index: number) => `${listboxId}-opt-${index}`;
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [drugSearch] = useState(() => createDrugAutocompleteSearch()); // @Codex WUL-488
    /* @Codex WUL-UIUX: in modifica il campo parte con defaultValue (nome farmaco):
       non deve far partire una ricerca ne aprire il popover finche il medico non
       digita davvero. */
    const hasUserTyped = useRef(false);

    // Debounce search
    useEffect(() => {
        drugSearch.abort(); // @Codex WUL-488
        if (!hasUserTyped.current) return () => drugSearch.abort();
        const timer = setTimeout(async () => {
            const tokens = query.trim().split(/\s+/).filter(t => t.length > 0);

            if (tokens.length > 0 && tokens[0].length > 2) {
                setIsLoading(true);
                try {
                    const matches = await drugSearch.run(query.trim()); // @Codex WUL-488
                    if (matches === null) return;
                    setResults(matches);
                    setActiveIndex(-1);
                    setIsOpen(true);
                    setIsLoading(false);
                } catch (e) {
                    console.error("Drug search error", e);
                    setIsLoading(false);
                }
            } else if (tokens.length === 0) {
                setResults([]);
                setActiveIndex(-1);
                setIsOpen(false);
                setIsLoading(false);
            } else {
                setIsLoading(false);
            }
        }, 300);

        return () => {
            clearTimeout(timer);
            drugSearch.abort();
        };
    }, [drugSearch, query]);

    // Handle outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    const handleSelect = (drug: AifaDrug) => {
        commitDrugAutocompleteQueryChange(drugSearch, setQuery, drug.name, () => setIsLoading(false)); // @Codex WUL-488
        setIsOpen(false);
        setActiveIndex(-1);
        onSelect(drug);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!isOpen && results.length > 0) {
                setIsOpen(true);
                return;
            }
            setActiveIndex((prev) => (results.length === 0 ? -1 : (prev + 1) % results.length));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((prev) => (results.length === 0 ? -1 : (prev - 1 + results.length) % results.length));
        } else if (event.key === 'Enter') {
            if (isOpen && activeIndex >= 0 && activeIndex < results.length) {
                event.preventDefault();
                handleSelect(results[activeIndex]);
            }
        } else if (event.key === 'Escape') {
            if (isOpen) {
                event.preventDefault();
                setIsOpen(false);
                setActiveIndex(-1);
            }
        }
    };

    return (
        // @Codex WUL-229: drug autocomplete now uses mf-input + mf-popover (vitreous tier)
        <div ref={wrapperRef} className="relative w-full">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--lume-ink-muted)' }} />
                <input
                    type="text"
                    role="combobox"
                    aria-expanded={isOpen && results.length > 0}
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                    value={query}
                    onChange={(e) => {
                        hasUserTyped.current = true;
                        commitDrugAutocompleteQueryChange(drugSearch, setQuery, e.target.value); // @Codex WUL-488
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    className={drugInputClassName}
                />

                {isLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--lume-ink)', borderTopColor: 'transparent' }}></div>
                    </div>
                )}

                {!isLoading && query && (
                    <button
                        type="button"
                        onClick={() => commitDrugAutocompleteQueryChange(drugSearch, setQuery, '')} // @Codex WUL-488
                        className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--lume-ink-muted)] transition-colors hover:bg-[color:var(--lume-surface-focal)] hover:text-[color:var(--lume-ink)]"
                        style={{ color: 'var(--lume-ink-muted)' }}
                        title="Cancella ricerca"
                        aria-label="Cancella ricerca"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {isOpen && results.length > 0 && (
                <div className={drugPopoverClassName} role="listbox" id={listboxId} aria-label="Risultati catalogo farmaci">
                    <div role="presentation" className="mb-1 flex items-center justify-between gap-3 border-b border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">
                        <span>Risultati catalogo ({results.length})</span>
                        <span className="flex items-center gap-1"><Database className="w-3 h-3" /> AIFA locale</span>
                    </div>

                    {results.map((drug, index) => (
                        <button
                            key={drug.aic}
                            type="button"
                            role="option"
                            id={optionId(index)}
                            aria-selected={index === activeIndex}
                            onClick={() => handleSelect(drug)}
                            onMouseEnter={() => setActiveIndex(index)}
                            className={`${drugRowClassName} ${index === activeIndex ? 'lume-focal bg-[color:var(--lume-surface-focal)] [--lume-focal-shadow-opacity:1]' : ''}`}
                            aria-label={`Seleziona ${drug.name}`}
                        >
                            <div className="flex justify-between items-start w-full">
                                <div className="flex-1 pr-2">
                                    <div className="text-sm font-semibold text-[color:var(--lume-ink)]">{drug.name}</div>
                                    {drug.packaging && (
                                        <div className="mt-0.5 text-xs font-medium text-[color:var(--lume-ink-muted)]">{drug.packaging}</div>
                                    )}
                                    <div className="mt-1 flex items-center gap-1 text-xs font-medium text-[color:var(--lume-ink-muted)]">
                                        <Activity className="w-3 h-3" />
                                        {drug.activePrinciple}
                                    </div>
                                    <div className="mt-1 truncate text-[10px] text-[color:var(--lume-ink-muted)]">
                                        {drug.company} {drug.class ? `• Fascia ${drug.class}` : ''} {drug.atc ? `• ATC: ${drug.atc}` : ''}
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <span className="apple-chip lume-registro text-[10px]">AIC {drug.aic}</span>
                                    {drug.price !== undefined && drug.price > 0 && (
                                        <div className="mt-1 text-xs font-medium text-[color:var(--lume-ink-muted)]">€ {drug.price.toFixed(2)}</div>
                                    )}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {isOpen && query.length > 2 && results.length === 0 && !isLoading && (
                <div className={`${drugPopoverClassName} p-5 text-center`}>
                    <Pill className="mx-auto mb-2 h-7 w-7 text-[color:var(--lume-ink-muted)]" />
                    <p className="text-sm font-semibold text-[color:var(--lume-ink)]">Nessun farmaco trovato nel catalogo locale.</p>
                    <p className="mt-1 text-xs leading-5 text-[color:var(--lume-ink-muted)]">Prova nome commerciale o principio attivo, oppure usa “Farmaco manuale o galenico”.</p>
                </div>
            )}
        </div>
    );
}
