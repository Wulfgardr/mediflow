'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

type ExemptionOption = {
    code: string;
    description: string;
    type?: string | null;
};

interface ExemptionSelectorProps {
    value: string[];
    onChange: (codes: string[]) => void;
}

/* @Codex */
export default function ExemptionSelector({ value, onChange }: ExemptionSelectorProps) {
    const rootRef = useRef<HTMLDivElement>(null);

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<ExemptionOption[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [detailsByCode, setDetailsByCode] = useState<Record<string, ExemptionOption>>({});
    /* @Codex */
    const [catalogCount, setCatalogCount] = useState<number | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        const loadCount = async () => {
            try {
                const response = await fetch('/api/exemptions?count=1', { signal: controller.signal });
                if (!response.ok) return;
                const payload = await response.json();
                setCatalogCount(Number(payload.count || 0));
            } catch (error) {
                if ((error as Error).name === 'AbortError') return;
                console.error('Failed to load exemptions count', error);
            }
        };
        loadCount();
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent) => {
            if (!rootRef.current) return;
            if (event.target instanceof Node && rootRef.current.contains(event.target)) return;
            setIsOpen(false);
        };

        window.addEventListener('mousedown', onClickOutside);
        return () => window.removeEventListener('mousedown', onClickOutside);
    }, []);

    useEffect(() => {
        const missing = value.filter((code) => !detailsByCode[code]);
        if (!missing.length) return;

        const controller = new AbortController();
        const run = async () => {
            try {
                const response = await fetch(`/api/exemptions?codes=${encodeURIComponent(missing.join(','))}`, {
                    signal: controller.signal,
                });
                if (!response.ok) return;
                const items: ExemptionOption[] = await response.json();
                setDetailsByCode((prev) => {
                    const next = { ...prev };
                    for (const item of items) {
                        next[item.code] = item;
                    }
                    return next;
                });
            } catch (error) {
                if ((error as Error).name === 'AbortError') return;
                console.error('Failed to resolve exemption codes', error);
            }
        };

        run();
        return () => controller.abort();
    }, [detailsByCode, value]);

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            setResults([]);
            return;
        }

        const controller = new AbortController();
        const timeout = window.setTimeout(async () => {
            setIsLoading(true);
            try {
                const response = await fetch(`/api/exemptions?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
                if (!response.ok) {
                    setResults([]);
                    return;
                }
                const items: ExemptionOption[] = await response.json();
                setResults(items);
                setIsOpen(true);
            } catch (error) {
                if ((error as Error).name !== 'AbortError') {
                    console.error('Failed to search exemptions', error);
                }
            } finally {
                setIsLoading(false);
            }
        }, 180);

        return () => {
            controller.abort();
            window.clearTimeout(timeout);
        };
    }, [query]);

    const addCode = (code: string) => {
        if (!code || value.includes(code)) return;
        onChange([...value, code]);
        setQuery('');
        setResults([]);
        setIsOpen(false);
    };

    const removeCode = (code: string) => {
        onChange(value.filter((item) => item !== code));
    };

    return (
        <div ref={rootRef} className="space-y-3">
            <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={() => setIsOpen(results.length > 0)}
                    placeholder="Cerca codice o descrizione esenzione (min 2 caratteri)"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-50 dark:bg-[#010409] border border-transparent dark:border-[#30363d] focus:bg-white dark:focus:bg-[#0d1117] focus:ring-2 focus:ring-blue-500 outline-none dark:text-[#c9d1d9]"
                />

                {isOpen && (
                    <div className="absolute z-30 mt-2 w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0d1117] shadow-xl max-h-72 overflow-auto">
                        {isLoading ? (
                            <p className="px-3 py-2 text-xs text-gray-500">Ricerca in corso...</p>
                        ) : catalogCount === 0 ? (
                            <div className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                                <p>Catalogo esenzioni vuoto.</p>
                                <a href="/settings" className="underline text-blue-600 dark:text-blue-300">
                                    Vai in Impostazioni e importa i file esenzioni.
                                </a>
                            </div>
                        ) : results.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-gray-500">Nessun codice trovato.</p>
                        ) : (
                            <div className="py-1">
                                {results.map((result) => {
                                    const selected = value.includes(result.code);
                                    return (
                                        <button
                                            key={result.code}
                                            type="button"
                                            onClick={() => addCode(result.code)}
                                            disabled={selected}
                                            className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${selected
                                                ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 opacity-60'
                                                : 'border-transparent hover:border-blue-300 hover:bg-blue-50/80 dark:hover:bg-blue-900/20'
                                                }`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-200">{result.code}</p>
                                                {result.type && (
                                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-300">
                                                        {result.type}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{result.description}</p>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {value.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {value.map((code) => {
                        const detail = detailsByCode[code];
                        return (
                            <span
                                key={code}
                                className="inline-flex items-center gap-2 pl-2.5 pr-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/40 text-indigo-700 dark:text-indigo-300 text-xs"
                            >
                                <span className="font-mono font-semibold">{code}</span>
                                <span className="max-w-[340px] truncate">{detail?.description || 'Descrizione non caricata'}</span>
                                <button
                                    type="button"
                                    onClick={() => removeCode(code)}
                                    className="text-indigo-500 hover:text-red-500 transition-colors"
                                    aria-label={`Rimuovi ${code}`}
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </span>
                        );
                    })}
                </div>
            ) : (
                <p className="text-xs text-gray-500">
                    {catalogCount === 0 ? 'Catalogo non ancora caricato: importa i file esenzioni nelle impostazioni.' : 'Nessuna esenzione associata.'}
                </p>
            )}
        </div>
    );
}
