'use client';

import { useState, useRef, useEffect } from 'react';
import { db, AifaDrug } from '@/lib/db';
import { Search, X, Pill, Database, Activity } from 'lucide-react';

interface DrugAutocompleteProps {
    onSelect: (drug: AifaDrug) => void;
    placeholder?: string;
    autoFocus?: boolean;
    defaultValue?: string;
}

export default function DrugAutocomplete({ onSelect, placeholder = "Cerca farmaco o principio attivp...", autoFocus = false, defaultValue = "" }: DrugAutocompleteProps) {
    const [query, setQuery] = useState(defaultValue);
    const [results, setResults] = useState<AifaDrug[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(async () => {
            const tokens = query.trim().split(/\s+/).filter(t => t.length > 0);

            if (tokens.length > 0 && tokens[0].length > 2) {
                setIsLoading(true);
                try {
                    // 1. Efficient DB Fetch using ONLY the first token
                    const firstToken = tokens[0].toLowerCase();

                    const allDrugs = await db.drugs.toArray();

                    const nameMatches = allDrugs.filter((d: any) => d.name.toLowerCase().startsWith(firstToken)).slice(0, 50);
                    const principleMatches = allDrugs.filter((d: any) => d.activePrinciple && d.activePrinciple.toLowerCase().startsWith(firstToken)).slice(0, 50);

                    // 2. Merge and Deduplicate
                    const merged = [...nameMatches, ...principleMatches];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const uniqueMap = new Map(merged.map((item: any) => [item.aic, item]));
                    const unique = Array.from(uniqueMap.values());

                    // 3. Smart Filtering: Check if ALL tokens match anywhere in the drug data
                    // This allows searching for "Depakin 500" where "500" might be in the packaging
                    const filtered = unique.filter(drug => {
                        const searchString = `${drug.name} ${drug.activePrinciple} ${drug.packaging || ''}`.toLowerCase();
                        return tokens.every(token => searchString.includes(token.toLowerCase()));
                    }).slice(0, 30); // Limit final display

                    setResults(filtered);
                    setIsOpen(true);
                } catch (e) {
                    console.error("Drug search error", e);
                } finally {
                    setIsLoading(false);
                }
            } else if (tokens.length === 0) {
                setResults([]);
                setIsOpen(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [query]);

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
        setQuery(drug.name);
        setIsOpen(false);
        onSelect(drug);
    };

    return (
        // @Codex WUL-229 — drug autocomplete now uses mf-input + mf-popover (vitreous tier)
        <div ref={wrapperRef} className="relative w-full">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    className="mf-input mf-input-sm pl-9 pr-9 uppercase"
                />

                {isLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--mf-primary)', borderTopColor: 'transparent' }}></div>
                    </div>
                )}

                {!isLoading && query && (
                    <button
                        onClick={() => setQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                        style={{ color: 'var(--mf-muted)' }}
                        title="Cancella ricerca"
                        aria-label="Cancella ricerca"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {isOpen && results.length > 0 && (
                <div className="absolute z-[100] w-full mt-2 mf-popover max-h-80 overflow-y-auto">
                    <div className="px-2 py-1.5 mb-1 graphite-divider flex justify-between items-center text-[10px] uppercase font-semibold" style={{ color: 'var(--mf-muted)' }}>
                        <span>Risultati ({results.length})</span>
                        <span className="flex items-center gap-1"><Database className="w-3 h-3" /> Database AIFA</span>
                    </div>

                    {results.map((drug) => (
                        <button
                            key={drug.aic}
                            onClick={() => handleSelect(drug)}
                            className="mf-popover-row w-full text-left items-start"
                        >
                            <div className="flex justify-between items-start w-full">
                                <div className="flex-1 pr-2">
                                    <div className="font-semibold text-sm" style={{ color: 'var(--mf-ink)' }}>{drug.name}</div>
                                    {drug.packaging && (
                                        <div className="text-xs mt-0.5 font-medium" style={{ color: 'var(--mf-muted)' }}>{drug.packaging}</div>
                                    )}
                                    <div className="text-xs flex items-center gap-1 mt-1" style={{ color: 'var(--mf-primary)' }}>
                                        <Activity className="w-3 h-3" />
                                        {drug.activePrinciple}
                                    </div>
                                    <div className="text-[10px] mt-1 truncate" style={{ color: 'var(--mf-muted)' }}>
                                        {drug.company} {drug.class ? `• Fascia ${drug.class}` : ''} {drug.atc ? `• ATC: ${drug.atc}` : ''}
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <span className="apple-chip text-[10px] font-mono">AIC: {drug.aic}</span>
                                    {drug.price !== undefined && drug.price > 0 && (
                                        <div className="text-xs font-medium mt-1" style={{ color: 'var(--mf-muted)' }}>€ {drug.price.toFixed(2)}</div>
                                    )}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {isOpen && query.length > 2 && results.length === 0 && !isLoading && (
                <div className="absolute z-[100] w-full mt-2 mf-popover p-4 text-center">
                    <Pill className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--mf-muted)' }} />
                    <p className="text-sm" style={{ color: 'var(--mf-muted)' }}>Nessun farmaco trovato nel database.</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--mf-muted)' }}>Prova a cercare per principio attivo o usa l&apos;inserimento manuale (Galenico).</p>
                </div>
            )}
        </div>
    );
}
