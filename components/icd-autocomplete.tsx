'use client';

import { useState, useRef, useEffect, useId } from 'react';
import { searchICDHybrid, ICDSearchResult } from '@/lib/icd-service'; // UPDATED Import
import { createLatestRequestGuard } from '@/lib/latest-request-guard'; // @Codex
import { Search, X, Server } from 'lucide-react';

interface ICDAutocompleteProps {
    value?: { code: string; description: string; system: string };
    onChange?: (value: { code: string; description: string; system: string }) => void;
    // Alternative simple mode
    initialValue?: { code: string; title: string } | null;
    onSelect?: (code: string, title: string) => void;
}

export default function ICDAutocomplete({ value, onChange, initialValue, onSelect }: ICDAutocompleteProps) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<ICDSearchResult[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    /* @Codex */
    const [searchError, setSearchError] = useState<string | null>(null);
    /* @Codex WUL-UIUX (Fase 5): pattern combobox ARIA + navigazione da tastiera. */
    const [activeIndex, setActiveIndex] = useState(-1);
    const listboxId = useId();
    const optionId = (index: number) => `${listboxId}-opt-${index}`;
    const wrapperRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null); // @Codex
    const latestSearchRef = useRef(createLatestRequestGuard()); // @Codex

    // Initial value population
    useEffect(() => {
        // Handle standard "value" prop
        if (value && (value.code || value.description)) {
            const display = value.code ? `${value.code} - ${value.description}` : value.description;
            if (!query) setQuery(display);
        } else if (initialValue && (initialValue.code || initialValue.title)) {
            // Handle simple "initialValue" prop
            const display = initialValue.code ? `${initialValue.code} - ${initialValue.title}` : initialValue.title;
            if (!query) setQuery(display);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value?.code, value?.description, initialValue?.code, initialValue?.title]);

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

    // @Codex WUL-311 - prevent delayed ICD lookups from updating an unmounted autocomplete.
    useEffect(() => {
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
            latestSearchRef.current.discard();
        };
    }, []);

    const [isLoading, setIsLoading] = useState(false);

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setQuery(val);

        if (debounceRef.current) { // @Codex
            clearTimeout(debounceRef.current); // @Codex
            debounceRef.current = null; // @Codex
        }

        if (val.length > 1) {
            const requestId = latestSearchRef.current.issue(); // @Codex
            setSearchError(null); // @Codex
            setIsLoading(true);
            debounceRef.current = setTimeout(() => { // @Codex
                searchICDHybrid(val) // @Codex
                    .then((matches) => { // @Codex
                        if (!latestSearchRef.current.isLatest(requestId)) return; // @Codex
                        setSearchError(null); // @Codex
                        setResults(matches); // @Codex
                        setActiveIndex(-1); // @Codex WUL-UIUX
                        setIsOpen(true); // @Codex
                    }) // @Codex
                    .catch(() => { // @Codex
                        if (!latestSearchRef.current.isLatest(requestId)) return; // @Codex
                        setSearchError('Servizio ICD-11 locale non raggiungibile. Verifica Docker e sessione attiva.'); // @Codex
                        setResults([]); // @Codex
                        setIsOpen(true); // @Codex
                    }) // @Codex
                    .finally(() => { // @Codex
                        if (latestSearchRef.current.isLatest(requestId)) { // @Codex
                            setIsLoading(false); // @Codex
                        } // @Codex
                    }); // @Codex
            }, 225); // @Codex
        } else {
            latestSearchRef.current.discard(); // @Codex
            setSearchError(null); // @Codex
            setResults([]);
            setActiveIndex(-1); // @Codex WUL-UIUX
            setIsOpen(false);
            setIsLoading(false); // @Codex
        }

        // Propagate free text
        if (onChange && value) {
            onChange({ code: '', description: val, system: value.system });
        }
    };

    const handleSelect = (item: ICDSearchResult) => {
        latestSearchRef.current.discard(); // @Codex
        if (debounceRef.current) { // @Codex
            clearTimeout(debounceRef.current); // @Codex
            debounceRef.current = null; // @Codex
        }
        setIsLoading(false); // selecting while a search is pending must not leave the spinner stuck
        // Mode 1: Standard onChange
        if (onChange) {
            onChange({
                code: item.code,
                description: item.description,
                system: item.system as 'ICD-9' | 'ICD-10' | 'ICD-11'
            });
        }
        // Mode 2: Simple onSelect
        if (onSelect) {
            onSelect(item.code, item.description);
        }

        setQuery(`${item.code} - ${item.description}`);
        setActiveIndex(-1);
        setIsOpen(false);
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
        // @Codex WUL-229: ICD autocomplete shares mf-input + mf-popover language with drug picker
        <div ref={wrapperRef} className="relative w-full">
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} aria-hidden="true" />
                <input
                    type="text"
                    role="combobox"
                    value={query}
                    onChange={handleSearch}
                    onKeyDown={handleKeyDown}
                    placeholder="Cerca diagnosi (ICD-11 Official - English)"
                    className="mf-input mf-input-sm icd-autocomplete-input"
                    aria-expanded={isOpen && results.length > 0}
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                    aria-invalid={!!searchError}
                />
                {isLoading && (
                    <div className="absolute right-9 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--mf-primary)', borderTopColor: 'transparent' }}></div>
                    </div>
                )}

                {query && !isLoading && (
                    <button
                        type="button"
                        onClick={() => {
                            latestSearchRef.current.discard(); // @Codex
                            if (debounceRef.current) { // @Codex
                                clearTimeout(debounceRef.current); // @Codex
                                debounceRef.current = null; // @Codex
                            }
                            setQuery("");
                            setSearchError(null); // @Codex
                            setResults([]); // @Codex
                            setIsOpen(false); // @Codex
                            setIsLoading(false); // @Codex
                            if (onChange) onChange({ code: '', description: '', system: 'ICD-11' });
                            if (onSelect) onSelect('', '');
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2"
                        style={{ color: 'var(--mf-muted)' }}
                        aria-label="Cancella ricerca"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {isOpen && results.length > 0 && (
                <div className="absolute z-[100] mt-2 w-full max-h-64 overflow-y-auto rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-1 shadow-[0_2px_8px_color-mix(in_srgb,var(--lume-ink)_10%,transparent)]" role="listbox" id={listboxId} aria-label="Risultati diagnosi ICD">
                    {results.map((item, index) => (
                        <button
                            key={`${item.system}-${item.code}`}
                            type="button"
                            role="option"
                            id={optionId(index)}
                            aria-selected={index === activeIndex}
                            onClick={() => handleSelect(item)}
                            onMouseEnter={() => setActiveIndex(index)}
                            className={`mf-popover-row w-full text-left flex items-center justify-between ${index === activeIndex ? 'lume-focal is-active [--lume-focal-shadow-opacity:1]' : ''}`}
                        >
                            <span className="font-medium text-sm truncate" style={{ color: 'var(--mf-ink)' }}>{item.description}</span>
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="patient-code-pill patient-code-pill-primary lume-registro text-[10px]">
                                    <Server className="w-3 h-3 mr-1" />
                                    {item.system} {item.code}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {isOpen && searchError && (
                <div
                    className="absolute z-[100] mt-2 w-full rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-3 text-left text-xs leading-5 shadow-[0_2px_8px_color-mix(in_srgb,var(--lume-ink)_10%,transparent)]"
                    style={{ color: 'var(--mf-warning)' }}
                    role="status"
                >
                    {searchError}
                </div>
            )}

            {isOpen && !searchError && results.length === 0 && query.length > 1 && (
                <div className="absolute z-[100] mt-2 w-full rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-3 text-center text-xs italic shadow-[0_2px_8px_color-mix(in_srgb,var(--lume-ink)_10%,transparent)]" style={{ color: 'var(--mf-muted)' }}>
                    Nessuna corrispondenza. Prova a cercare in Inglese (es. &quot;Amyloid&quot;).
                </div>
            )}
        </div>
    );
}
