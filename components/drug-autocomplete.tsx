'use client';

import { useState, useRef, useEffect } from 'react';
import { db, AifaDrug } from '@/lib/db';
import { Search, X, Pill, Database, Activity } from 'lucide-react';

interface DrugAutocompleteProps {
    onSelect: (drug: AifaDrug) => void;
    placeholder?: string;
    autoFocus?: boolean;
}

export default function DrugAutocomplete({ onSelect, placeholder = "Cerca farmaco o principio attivp...", autoFocus = false }: DrugAutocompleteProps) {
    const [query, setQuery] = useState("");
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
                    const firstToken = tokens[0];

                    const nameMatches = await db.drugs
                        .where('name')
                        .startsWithIgnoreCase(firstToken)
                        .limit(50) // Increased limit to allow filtering
                        .toArray();

                    const principleMatches = await db.drugs
                        .where('activePrinciple')
                        .startsWithIgnoreCase(firstToken)
                        .limit(50)
                        .toArray();

                    // 2. Merge and Deduplicate
                    const merged = [...nameMatches, ...principleMatches];
                    const uniqueMap = new Map(merged.map(item => [item.aic, item]));
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
        <div ref={wrapperRef} className="relative w-full">
            <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    className="w-full pl-9 pr-10 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-white/10 dark:bg-black/20 focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white uppercase transition-all"
                />

                {isLoading && (
                    <div className="absolute right-3 top-2.5">
                        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                )}

                {!isLoading && query && (
                    <button
                        onClick={() => setQuery('')}
                        className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                        title="Cancella ricerca"
                        aria-label="Cancella ricerca" // Fix accessibility
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Results Dropdown */}
            {isOpen && results.length > 0 && (
                <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-[#1C1C1E] rounded-lg shadow-xl border border-gray-100 dark:border-white/10 max-h-80 overflow-y-auto">

                    <div className="p-2 bg-gray-50 dark:bg-white/5 border-b border-gray-100 dark:border-white/5 flex justify-between items-center text-[10px] text-gray-500 uppercase font-semibold">
                        <span>Risultati ({results.length})</span>
                        <span className="flex items-center gap-1"><Database className="w-3 h-3" /> Database AIFA</span>
                    </div>

                    {results.map((drug) => (
                        <button
                            key={drug.aic}
                            onClick={() => handleSelect(drug)}
                            className="w-full text-left px-4 py-3 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-b border-gray-50 dark:border-white/5 last:border-0 group transition-colors"
                        >
                            <div className="flex justify-between items-start">
                                <div className="flex-1 pr-2">
                                    <div className="font-bold text-gray-800 dark:text-gray-200 text-sm group-hover:text-indigo-700 dark:group-hover:text-indigo-300">
                                        {drug.name}
                                    </div>
                                    {drug.packaging && (
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-medium">
                                            {drug.packaging}
                                        </div>
                                    )}
                                    <div className="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1 mt-1">
                                        <Activity className="w-3 h-3" />
                                        {drug.activePrinciple}
                                    </div>
                                    <div className="text-[10px] text-gray-400 mt-1 truncate">
                                        {drug.company} {drug.class ? `• Fascia ${drug.class}` : ''} {drug.atc ? `• ATC: ${drug.atc}` : ''}
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <span className="inline-block bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400 text-[10px] px-1.5 py-0.5 rounded font-mono">
                                        AIC: {drug.aic}
                                    </span>
                                    {drug.price !== undefined && drug.price > 0 && (
                                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">
                                            € {drug.price.toFixed(2)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {isOpen && query.length > 2 && results.length === 0 && !isLoading && (
                <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-[#1C1C1E] rounded-lg shadow-xl border border-gray-100 dark:border-white/10 p-4 text-center">
                    <Pill className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Nessun farmaco trovato nel database.</p>
                    <p className="text-xs text-gray-400 mt-1">Prova a cercare per principio attivo o usa l'inserimento manuale (Galenico).</p>
                </div>
            )}
        </div>
    );
}
