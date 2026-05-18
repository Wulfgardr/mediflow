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

const drugInputClassName = 'h-11 w-full rounded-[14px] border border-[color:rgba(15,23,42,0.12)] bg-white/88 px-3 py-2.5 pl-9 pr-9 text-sm text-[color:var(--mf-ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[color:rgba(100,116,139,0.58)] focus:border-[color:rgba(15,23,42,0.28)] focus:shadow-[0_0_0_4px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/5';
const drugPopoverClassName = 'absolute z-[100] mt-2 max-h-80 w-full overflow-y-auto rounded-[18px] border border-[color:rgba(112,106,100,0.14)] bg-white/96 p-2 shadow-[0_22px_60px_rgba(54,45,38,0.14)] backdrop-blur dark:border-white/10 dark:bg-[color:rgba(24,24,22,0.96)]';
const drugRowClassName = 'w-full rounded-[14px] px-3 py-3 text-left transition-colors hover:bg-[color:rgba(248,250,252,0.86)] focus:bg-[color:rgba(248,250,252,0.86)] focus:outline-none dark:hover:bg-white/6 dark:focus:bg-white/6';

export default function DrugAutocomplete({ onSelect, placeholder = "Cerca per nome o principio attivo...", autoFocus = false, defaultValue = "" }: DrugAutocompleteProps) {
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
                    const candidateByAic = new Map<string, AifaDrug>();
                    let nameMatchCount = 0;
                    let principleMatchCount = 0;

                    for (const drug of allDrugs) {
                        if (nameMatchCount < 50 && drug.name.toLowerCase().startsWith(firstToken)) {
                            candidateByAic.set(drug.aic, drug);
                            nameMatchCount += 1;
                        }
                        if (
                            principleMatchCount < 50 &&
                            drug.activePrinciple?.toLowerCase().startsWith(firstToken)
                        ) {
                            candidateByAic.set(drug.aic, drug);
                            principleMatchCount += 1;
                        }
                        if (nameMatchCount >= 50 && principleMatchCount >= 50) break;
                    }

                    const unique = Array.from(candidateByAic.values());

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
                    className={drugInputClassName}
                />

                {isLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--mf-ink)', borderTopColor: 'transparent' }}></div>
                    </div>
                )}

                {!isLoading && query && (
                    <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--mf-muted)] transition-colors hover:bg-[color:rgba(248,250,252,0.86)] hover:text-[color:var(--mf-ink)] dark:hover:bg-white/8"
                        style={{ color: 'var(--mf-muted)' }}
                        title="Cancella ricerca"
                        aria-label="Cancella ricerca"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {isOpen && results.length > 0 && (
                <div className={drugPopoverClassName}>
                    <div className="mb-1 flex items-center justify-between gap-3 border-b border-[color:rgba(112,106,100,0.10)] px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--mf-muted)] dark:border-white/10">
                        <span>Risultati catalogo ({results.length})</span>
                        <span className="flex items-center gap-1"><Database className="w-3 h-3" /> AIFA locale</span>
                    </div>

                    {results.map((drug) => (
                        <button
                            key={drug.aic}
                            type="button"
                            onClick={() => handleSelect(drug)}
                            className={drugRowClassName}
                            aria-label={`Seleziona ${drug.name}`}
                        >
                            <div className="flex justify-between items-start w-full">
                                <div className="flex-1 pr-2">
                                    <div className="text-sm font-semibold text-[color:var(--mf-ink)]">{drug.name}</div>
                                    {drug.packaging && (
                                        <div className="mt-0.5 text-xs font-medium text-[color:var(--mf-muted)]">{drug.packaging}</div>
                                    )}
                                    <div className="mt-1 flex items-center gap-1 text-xs font-medium text-[color:var(--mf-muted)]">
                                        <Activity className="w-3 h-3" />
                                        {drug.activePrinciple}
                                    </div>
                                    <div className="mt-1 truncate text-[10px] text-[color:rgba(112,106,100,0.72)]">
                                        {drug.company} {drug.class ? `• Fascia ${drug.class}` : ''} {drug.atc ? `• ATC: ${drug.atc}` : ''}
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <span className="apple-chip font-mono text-[10px]">AIC {drug.aic}</span>
                                    {drug.price !== undefined && drug.price > 0 && (
                                        <div className="mt-1 text-xs font-medium text-[color:var(--mf-muted)]">€ {drug.price.toFixed(2)}</div>
                                    )}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {isOpen && query.length > 2 && results.length === 0 && !isLoading && (
                <div className={`${drugPopoverClassName} p-5 text-center`}>
                    <Pill className="mx-auto mb-2 h-7 w-7 text-[color:var(--mf-muted)]" />
                    <p className="text-sm font-semibold text-[color:var(--mf-ink)]">Nessun farmaco trovato nel catalogo locale.</p>
                    <p className="mt-1 text-xs leading-5 text-[color:var(--mf-muted)]">Prova nome commerciale o principio attivo, oppure usa “Farmaco manuale o galenico”.</p>
                </div>
            )}
        </div>
    );
}
