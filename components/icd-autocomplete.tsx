'use client';

import { useState, useRef, useEffect } from 'react';
import { searchICDHybrid, ICDSearchResult } from '@/lib/icd-service'; // UPDATED Import
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
    const wrapperRef = useRef<HTMLDivElement>(null);

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

    const [isLoading, setIsLoading] = useState(false);

    const handleSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setQuery(val);

        if (val.length > 1) {
            setIsLoading(true);
            try {
                const matches = await searchICDHybrid(val);
                setResults(matches);
                setIsOpen(true);
            } finally {
                setIsLoading(false);
            }
        } else {
            setResults([]);
            setIsOpen(false);
        }

        // Propagate free text
        if (onChange && value) {
            onChange({ code: '', description: val, system: value.system });
        }
    };

    const handleSelect = (item: ICDSearchResult) => {
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
        setIsOpen(false);
    };

    return (
        // @Codex WUL-229 — ICD autocomplete shares mf-input + mf-popover language with drug picker
        <div ref={wrapperRef} className="relative w-full">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                <input
                    type="text"
                    value={query}
                    onChange={handleSearch}
                    placeholder="Cerca diagnosi (ICD-11 Official - English)"
                    className="mf-input mf-input-sm pl-9 pr-9 uppercase"
                />
                {isLoading && (
                    <div className="absolute right-9 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--mf-primary)', borderTopColor: 'transparent' }}></div>
                    </div>
                )}

                {query && !isLoading && (
                    <button
                        onClick={() => {
                            setQuery("");
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
                <div className="absolute z-[100] w-full mt-2 mf-popover max-h-64 overflow-y-auto">
                    {results.map((item) => (
                        <button
                            key={`${item.system}-${item.code}`}
                            type="button"
                            onClick={() => handleSelect(item)}
                            className="mf-popover-row w-full text-left flex items-center justify-between"
                        >
                            <span className="font-medium text-sm truncate" style={{ color: 'var(--mf-ink)' }}>{item.description}</span>
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="patient-code-pill patient-code-pill-primary text-[10px]">
                                    <Server className="w-3 h-3 mr-1" />
                                    {item.system} {item.code}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {isOpen && results.length === 0 && query.length > 1 && (
                <div className="absolute z-[100] w-full mt-2 mf-popover p-3 text-center text-xs italic" style={{ color: 'var(--mf-muted)' }}>
                    Nessuna corrispondenza. Prova a cercare in Inglese (es. &quot;Amyloid&quot;).
                </div>
            )}
        </div>
    );
}
