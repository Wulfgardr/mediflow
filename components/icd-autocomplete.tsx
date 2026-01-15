'use client';

import { useState, useRef, useEffect } from 'react';
import { searchICDHybrid, ICDSearchResult } from '@/lib/icd-service'; // UPDATED Import
import { Search, X, Server, AlertTriangle } from 'lucide-react';

interface ICDAutocompleteProps {
    value?: { code: string; description: string; system: 'ICD-9' | 'ICD-10' | 'ICD-11' };
    onChange?: (value: { code: string; description: string; system: 'ICD-9' | 'ICD-10' | 'ICD-11' }) => void;
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
        <div ref={wrapperRef} className="relative w-full">
            <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                    type="text"
                    value={query}
                    onChange={handleSearch}
                    placeholder="Cerca diagnosi (ICD-11 Official - English)"
                    className="w-full pl-9 pr-8 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-white/10 dark:bg-black/20 focus:ring-2 focus:ring-blue-500 outline-none uppercase dark:text-white"
                />
                {/* Loading Indicator */}
                {isLoading && (
                    <div className="absolute right-8 top-2.5">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                )}

                {query && !isLoading && (
                    <button
                        onClick={() => {
                            setQuery("");
                            if (onChange) onChange({ code: '', description: '', system: 'ICD-11' });
                            if (onSelect) onSelect('', '');
                        }}
                        className="absolute right-2 top-2.5 text-gray-400 hover:text-gray-600"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Results Dropdown */}
            {isOpen && results.length > 0 && (
                <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-100 dark:border-white/10 max-h-60 overflow-y-auto">
                    {/* Header informing sources could be good, but stick to list for now */}
                    {results.map((item) => (
                        <button
                            key={`${item.system}-${item.code}`}
                            type="button"
                            onClick={() => handleSelect(item)}
                            className="w-full text-left px-4 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center justify-between group border-b border-gray-50 dark:border-white/5 last:border-0"
                        >
                            <span className="font-medium text-gray-800 dark:text-gray-200 text-sm truncate">{item.description}</span>

                            <div className="flex items-center gap-2">
                                {/* System Badge */}
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${item.system === 'ICD-11' ? 'bg-blue-100 text-blue-700' :
                                    item.system === 'ICD-9' ? 'bg-orange-100 text-orange-700' :
                                        'bg-purple-100 text-purple-700'
                                    }`}>
                                    {item.system === 'ICD-11' ? <Server className="w-3 h-3" /> : (item.isLegacy ? <AlertTriangle className="w-3 h-3" /> : null)}
                                    {item.system} {item.code}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {isOpen && results.length === 0 && query.length > 1 && (
                <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-100 dark:border-white/10 p-3 text-center text-xs text-gray-400 italic">
                    Nessuna corrispondenza. Prova a cercare in Inglese (es. "Amyloid").
                </div>
            )}
        </div>
    );
}
