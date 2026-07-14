'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
    /* @Codex WUL-UIUX (Fase 6-7): pattern combobox ARIA + navigazione da tastiera. */
    const [activeIndex, setActiveIndex] = useState(-1);
    const listboxId = useId();
    const optionId = (index: number) => `${listboxId}-opt-${index}`;
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
            setActiveIndex(-1);
            return;
        }

        const controller = new AbortController();
        const timeout = window.setTimeout(async () => {
            setIsLoading(true);
            try {
                const response = await fetch(`/api/exemptions?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
                if (!response.ok) {
                    setResults([]);
                    setActiveIndex(-1);
                    return;
                }
                const items: ExemptionOption[] = await response.json();
                setResults(items);
                setActiveIndex(-1);
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
        setActiveIndex(-1);
    };

    const removeCode = (code: string) => {
        onChange(value.filter((item) => item !== code));
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
                addCode(results[activeIndex].code);
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
        <div ref={rootRef} className="space-y-3">
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--mf-muted)]" />
                <input
                    type="text"
                    role="combobox"
                    aria-expanded={isOpen && results.length > 0}
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsOpen(results.length > 0)}
                    placeholder="Cerca codice o descrizione esenzione (min 2 caratteri)"
                    className="mf-input"
                    /* @Codex WUL-UIUX: .mf-input ha padding shorthand unlayered che
                       batte la utility pl-*, quindi forziamo lo spazio per l'icona qui. */
                    style={{ paddingLeft: '2.5rem' }}
                />

                {isOpen && (
                    <div
                        className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-1 shadow-[0_2px_8px_color-mix(in_srgb,var(--lume-ink)_10%,transparent)]"
                        role="listbox"
                        id={listboxId}
                        aria-label="Risultati catalogo esenzioni"
                    >
                        {isLoading ? (
                            <p className="px-3 py-2 text-xs text-[color:var(--mf-muted)]">Ricerca in corso...</p>
                        ) : catalogCount === 0 ? (
                            <div className="space-y-1 px-3 py-2 text-xs text-[color:var(--mf-warning)] dark:text-[color:rgb(230,180,120)]">
                                <p>Catalogo esenzioni vuoto.</p>
                                <a href="/settings" className="underline text-[color:var(--mf-primary)]">
                                    Vai in Impostazioni e importa i file esenzioni.
                                </a>
                            </div>
                        ) : results.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-[color:var(--mf-muted)]">Nessun codice trovato.</p>
                        ) : (
                            <div className="space-y-0.5">
                                {results.map((result, index) => {
                                    const selected = value.includes(result.code);
                                    return (
                                        <button
                                            key={result.code}
                                            type="button"
                                            role="option"
                                            id={optionId(index)}
                                            aria-selected={index === activeIndex}
                                            onClick={() => addCode(result.code)}
                                            onMouseEnter={() => setActiveIndex(index)}
                                            disabled={selected}
                                            className={`w-full rounded-[var(--lume-radius-control)] px-3 py-2 text-left transition-[background-color] duration-[var(--lume-dur-riga)] ${selected
                                                ? 'bg-[color:rgba(15,123,104,0.1)] opacity-60'
                                                : `hover:bg-[color:var(--lume-surface-focal)] ${index === activeIndex ? 'lume-focal bg-[color:var(--lume-surface-focal)] [--lume-focal-shadow-opacity:1]' : ''}`
                                                }`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="lume-registro text-xs font-semibold text-[color:var(--mf-ink)]">{result.code}</p>
                                                {result.type && (
                                                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] text-[color:var(--mf-muted)] dark:bg-white/10">
                                                        {result.type}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="mt-1 text-xs text-[color:var(--mf-muted)]">{result.description}</p>
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
                                className="inline-flex items-center gap-2 rounded-full border border-[color:rgba(15,123,104,0.18)] bg-[color:rgba(15,123,104,0.08)] py-1 pl-2.5 pr-2 text-xs text-[color:var(--mf-primary)] dark:border-[color:rgba(94,199,177,0.28)] dark:bg-[color:rgba(94,199,177,0.16)] dark:text-[color:rgb(150,224,204)]"
                            >
                                <span className="lume-registro font-semibold">{code}</span>
                                <span className="max-w-[340px] truncate">{detail?.description || 'Descrizione non caricata'}</span>
                                <button
                                    type="button"
                                    onClick={() => removeCode(code)}
                                    className="text-[color:var(--mf-muted)] transition-colors hover:text-[color:var(--mf-critical)]"
                                    aria-label={`Rimuovi ${code}`}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </span>
                        );
                    })}
                </div>
            ) : (
                <p className="text-xs text-[color:var(--mf-muted)]">
                    {catalogCount === 0 ? 'Catalogo non ancora caricato: importa i file esenzioni nelle impostazioni.' : 'Nessuna esenzione associata.'}
                </p>
            )}
        </div>
    );
}
