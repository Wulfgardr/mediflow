'use client';

/* @Codex */
import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from '@/lib/live-query';
import { v4 as uuidv4 } from 'uuid';
import { Activity, ChevronDown, Minus, Plus, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { db } from '@/lib/db';
import { searchStaticTerminology } from '@/lib/terminology';
import { classifyObservationRange, formatReferenceRange } from '@/lib/observation-range';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';

/* @Codex */
function toLocalDateTimeInput(date: Date): string {
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/*
 * @Codex Observation.value e tipizzato number | string (lib/db.ts): import/API
 * possono scrivere stringhe (es. "120/80", "positivo"). Coerciamo una sola volta
 * al numero per i calcoli (delta, sparkline). Se non e un numero finito, niente
 * trend. La classificazione fuori-range usa il range per-record (refLow/refHigh)
 * via lib/observation-range (sorgente unica di verita), mai range inventati.
 */
function toNumeric(value: number | string): number | null {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

/* @Codex Sparkline compatta, valori in ordine cronologico crescente. */
function Sparkline({ values }: { values: number[] }) {
    if (values.length < 2) return null;
    const width = 56;
    const height = 18;
    const pad = 2;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const points = values
        .map((value, index) => {
            const x = pad + (index / (values.length - 1)) * (width - pad * 2);
            const y = height - pad - ((value - min) / span) * (height - pad * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
            className="text-[color:var(--mf-muted)]"
        >
            <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
}

/* @Codex */
export default function ObservationManager({ patientId, embedded = false }: { patientId: string; embedded?: boolean }) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [code, setCode] = useState('8480-6');
    const [unitCode, setUnitCode] = useState('mm[Hg]');
    const [value, setValue] = useState('');
    const [observedAt, setObservedAt] = useState(toLocalDateTimeInput(new Date()));
    const [notes, setNotes] = useState('');
    // S6: range di riferimento del referto (opzionali). Se assenti, nessun flag.
    const [refLow, setRefLow] = useState('');
    const [refHigh, setRefHigh] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [valueError, setValueError] = useState<string | null>(null);
    const codeSelectRef = useRef<HTMLSelectElement>(null);
    const valueInputRef = useRef<HTMLInputElement>(null);
    /* @Codex WUL-UIUX: piu analiti possono restare aperti insieme (confronto tra
       parametri in polifarmaco); "full" espande l'intera storia oltre le ultime 5. */
    const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
    const [fullGroups, setFullGroups] = useState<Set<string>>(new Set());
    /* @Codex WUL-UIUX (Fase 3): "Per data" legge un prelievo/pannello a colpo
       d'occhio (piu analiti dello stesso giorno). "Stesso giorno" e un'euristica
       onesta di UI (label "Misure del giorno", non "Referto"): senza panelId nello
       schema non si afferma che sia lo stesso referto. */
    const [viewMode, setViewMode] = useState<'parametro' | 'data'>('parametro');

    const toggleGroup = (analyteCode: string) =>
        setOpenGroups((prev) => {
            const next = new Set(prev);
            if (next.has(analyteCode)) next.delete(analyteCode);
            else next.add(analyteCode);
            return next;
        });
    const toggleFull = (analyteCode: string) =>
        setFullGroups((prev) => {
            const next = new Set(prev);
            if (next.has(analyteCode)) next.delete(analyteCode);
            else next.add(analyteCode);
            return next;
        });
    /* Precompila il form con questo analita e porta il focus sul valore. */
    const prefillGroup = (analyteCode: string, unit: string) => {
        setCode(analyteCode);
        if (unit) setUnitCode(unit);
        valueInputRef.current?.focus();
    };

    const loincOptions = useMemo(() => searchStaticTerminology('LOINC', '', 500), []);
    const ucumOptions = useMemo(() => searchStaticTerminology('UCUM', '', 500), []);
    /* @Codex Etichetta italiana per un analita, con fallback al display grezzo
       (regge sia i record storici in inglese sia quelli nuovi). */
    const italianLoincLabel = (analyteCode: string, fallback: string) =>
        loincOptions.find((item) => item.code === analyteCode)?.displayIt ?? fallback;

    const observations = useLiveQuery(
        async () => {
            const items = await db.observations.filter((o) => o.patientId === patientId).toArray();
            return items.sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
        },
        [patientId],
    );

    type Observation = NonNullable<typeof observations>[number];

    /* @Codex Raggruppamento per analita: una sezione densa per parametro,
       gruppi ordinati per misura piu recente, codifica mostrata una sola volta. */
    const groups = useMemo(() => {
        if (!observations) return undefined;
        const byCode = new Map<string, Observation[]>();
        for (const observation of observations) {
            const bucket = byCode.get(observation.code);
            if (bucket) {
                bucket.push(observation);
            } else {
                byCode.set(observation.code, [observation]);
            }
        }
        const result = Array.from(byCode.values()).map((items) => {
            const sorted = [...items].sort(
                (a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
            );
            return {
                code: sorted[0].code,
                display: sorted[0].display,
                unitCode: sorted[0].unitCode,
                codeSystem: sorted[0].codeSystem,
                items: sorted,
            };
        });
        result.sort(
            (a, b) => new Date(b.items[0].observedAt).getTime() - new Date(a.items[0].observedAt).getTime(),
        );
        return result;
    }, [observations]);

    /* @Codex WUL-UIUX (Fase 3): raggruppamento per giorno locale di observedAt,
       per leggere insieme le misure dello stesso prelievo. Giorni piu recenti in
       cima; dentro il giorno, misure per ora decrescente. Chiave = data locale
       (non UTC) cosi non slitta a cavallo di mezzanotte. */
    const byDay = useMemo(() => {
        if (!observations) return undefined;
        const dayKey = (date: Date) =>
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const byKey = new Map<string, { key: string; date: Date; items: Observation[] }>();
        for (const observation of observations) {
            const date = new Date(observation.observedAt);
            if (Number.isNaN(date.getTime())) continue;
            const key = dayKey(date);
            const bucket = byKey.get(key);
            if (bucket) {
                bucket.items.push(observation);
            } else {
                byKey.set(key, { key, date, items: [observation] });
            }
        }
        return Array.from(byKey.values())
            .map((day) => ({
                ...day,
                items: [...day.items].sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime()),
            }))
            .sort((a, b) => b.date.getTime() - a.date.getTime());
    }, [observations]);

    const selectedLoinc = loincOptions.find((item) => item.code === code);

    const saveObservation = async (event: React.FormEvent) => {
        event.preventDefault();
        if (isSaving) return;

        /* @Codex Accetta la virgola decimale italiana ("36,5") oltre al punto. */
        const numericValue = Number(value.replace(',', '.').trim());
        const observedDate = new Date(observedAt);
        if (!Number.isFinite(numericValue)) {
            setValueError('Inserisci un valore numerico, ad esempio 36,5');
            return;
        }
        if (Number.isNaN(observedDate.getTime()) || !selectedLoinc) {
            return;
        }
        setValueError(null);

        try {
            setIsSaving(true);
            await db.observations.add({
                id: uuidv4(),
                patientId,
                codeSystem: 'LOINC',
                code: selectedLoinc.code,
                display: selectedLoinc.displayIt ?? selectedLoinc.display,
                unitSystem: 'UCUM',
                unitCode,
                value: numericValue,
                notes: notes.trim() || undefined,
                refLow: refLow.trim() ? refLow.replace(',', '.').trim() : undefined,
                refHigh: refHigh.trim() ? refHigh.replace(',', '.').trim() : undefined,
                observedAt: observedDate,
                source: 'manual',
                createdAt: new Date(),
            });

            /* @Codex WUL-UIUX Trascrizione referto multi-analita: conservare la
               data del prelievo e riportare il focus sul parametro, cosi la misura
               successiva dello stesso referto mantiene lo stesso timestamp. */
            setValue('');
            setNotes('');
            setRefLow('');
            setRefHigh('');
            codeSelectRef.current?.focus();
        } catch (error) {
            console.error('Failed to save observation', error);
            showToast({ tone: 'error', title: 'Salvataggio osservazione fallito' });
        } finally {
            setIsSaving(false);
        }
    };

    const deleteObservation = async (id: string) => {
        const { confirmed } = await confirm({
            title: 'Eliminare questa misura?',
            message: 'La misura verra rimossa dai parametri clinici del paziente.',
            confirmLabel: 'Elimina',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            await db.observations.delete(id);
        } catch (error) {
            console.error('Failed to delete observation', error);
            showToast({ tone: 'error', title: 'Eliminazione misura fallita' });
        }
    };

    return (
        <div className={embedded ? 'space-y-5' : 'patient-detail-section glass-panel border p-6 space-y-5'}>
            {!embedded && (
                <div>
                    <p className="section-kicker">Parametri</p>
                    <div className="mt-1 flex items-center gap-2">
                        <Activity className="w-5 h-5 text-[color:var(--mf-muted)]" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Parametri clinici</h3>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[color:var(--mf-muted)]">
                        Valori misurati per il paziente, raggruppati per parametro. La codifica clinica resta visibile come metadata.
                    </p>
                </div>
            )}

            <form onSubmit={saveObservation} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="space-y-1">
                    <span className="section-kicker">Parametro</span>
                    <select
                        ref={codeSelectRef}
                        value={code}
                        onChange={(e) => {
                            const next = e.target.value;
                            setCode(next);
                            /* @Codex Imposta l'unita di default dell'analita
                               (resta modificabile), evita "Glicemia 90 mmHg". */
                            const option = loincOptions.find((item) => item.code === next);
                            if (option?.defaultUnit) setUnitCode(option.defaultUnit);
                        }}
                        className="mf-input"
                    >
                        {loincOptions.map((item) => (
                            <option key={item.code} value={item.code}>
                                {item.displayIt ?? item.display}
                            </option>
                        ))}
                    </select>
                    {selectedLoinc ? (
                        <span className="block text-[10.5px] font-mono uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            LOINC {selectedLoinc.code}
                        </span>
                    ) : null}
                </label>

                <label className="space-y-1">
                    <span className="section-kicker">Data e ora</span>
                    <input
                        type="datetime-local"
                        value={observedAt}
                        onChange={(e) => setObservedAt(e.target.value)}
                        className="mf-input dark:[color-scheme:dark]"
                    />
                </label>

                <label className="space-y-1">
                    <span className="section-kicker">Valore</span>
                    <input
                        ref={valueInputRef}
                        value={value}
                        onChange={(e) => {
                            setValue(e.target.value);
                            if (valueError) setValueError(null);
                        }}
                        placeholder="Es. 120"
                        inputMode="decimal"
                        aria-invalid={valueError ? true : undefined}
                        className="mf-input"
                    />
                    {valueError ? (
                        <span className="block text-[11px] text-[color:var(--mf-critical)]">{valueError}</span>
                    ) : null}
                </label>

                <label className="space-y-1">
                    <span className="section-kicker">Unita</span>
                    <select
                        value={unitCode}
                        onChange={(e) => setUnitCode(e.target.value)}
                        className="mf-input"
                    >
                        {ucumOptions.map((item) => (
                            <option key={item.code} value={item.code}>
                                {item.displayIt ?? item.display}
                            </option>
                        ))}
                    </select>
                    <span className="block text-[10.5px] font-mono uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        UCUM {unitCode}
                    </span>
                </label>

                <label className="space-y-1">
                    <span className="section-kicker">Rif. min (opzionale)</span>
                    <input
                        value={refLow}
                        onChange={(e) => setRefLow(e.target.value)}
                        className="mf-input"
                        inputMode="decimal"
                        placeholder="Es. 70"
                    />
                </label>

                <label className="space-y-1">
                    <span className="section-kicker">Rif. max (opzionale)</span>
                    <input
                        value={refHigh}
                        onChange={(e) => setRefHigh(e.target.value)}
                        className="mf-input"
                        inputMode="decimal"
                        placeholder="Es. 110"
                    />
                </label>

                <label className="md:col-span-2 space-y-1">
                    <span className="section-kicker">Note (opzionale)</span>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        className="mf-input"
                        placeholder="Contesto della misura, paziente a riposo, ecc."
                    />
                </label>

                <div className="md:col-span-2 flex justify-end">
                    <button
                        type="submit"
                        disabled={isSaving || value.trim().length === 0}
                        className="ui-btn-primary inline-flex h-10 items-center gap-1.5 px-4 text-sm font-semibold disabled:opacity-50"
                    >
                        <Plus className="w-4 h-4" />
                        {isSaving ? 'Salvataggio...' : 'Registra parametro'}
                    </button>
                </div>
            </form>

            <div className="space-y-3">
                {groups && groups.length > 0 ? (
                    <div className="flex justify-end">
                        <div role="group" aria-label="Vista parametri" className="inline-flex rounded-full border border-[color:rgba(15,23,42,0.12)] bg-white/70 p-0.5 text-xs dark:border-white/10 dark:bg-white/5">
                            <button
                                type="button"
                                aria-pressed={viewMode === 'parametro'}
                                onClick={() => setViewMode('parametro')}
                                className={`rounded-full px-3 py-1 font-medium transition-colors ${viewMode === 'parametro' ? 'bg-[color:var(--mf-ink)] text-white' : 'text-[color:var(--mf-muted)] hover:text-[color:var(--mf-ink)]'}`}
                            >
                                Per parametro
                            </button>
                            <button
                                type="button"
                                aria-pressed={viewMode === 'data'}
                                onClick={() => setViewMode('data')}
                                className={`rounded-full px-3 py-1 font-medium transition-colors ${viewMode === 'data' ? 'bg-[color:var(--mf-ink)] text-white' : 'text-[color:var(--mf-muted)] hover:text-[color:var(--mf-ink)]'}`}
                            >
                                Per data
                            </button>
                        </div>
                    </div>
                ) : null}
                {groups === undefined ? (
                    <div className="space-y-2" aria-hidden>
                        {[0, 1, 2].map((row) => (
                            <div
                                key={row}
                                className="h-16 animate-pulse rounded-[18px] border border-slate-200/70 bg-white/60 dark:border-white/10 dark:bg-white/5"
                            />
                        ))}
                    </div>
                ) : groups.length === 0 ? (
                    <p className="text-sm italic text-[color:var(--mf-muted)]">
                        Nessun parametro registrato. Usa il modulo qui sopra per registrare la prima misura.
                    </p>
                ) : viewMode === 'data' ? (
                    (byDay ?? []).map((day) => (
                        <section
                            key={day.key}
                            className="overflow-hidden rounded-[18px] border border-slate-200/80 bg-white/78 dark:border-white/10 dark:bg-white/5"
                        >
                            <header className="border-b border-slate-200/70 bg-white/55 px-3.5 py-2 dark:border-white/10 dark:bg-white/5">
                                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                                    Misure del {day.date.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}
                                </span>
                                <span className="ml-2 text-[11px] text-[color:var(--mf-muted)]">
                                    {day.items.length} {day.items.length === 1 ? 'misura' : 'misure'}
                                </span>
                            </header>
                            <div className="divide-y divide-slate-200/60 dark:divide-white/5">
                                {day.items.map((item) => {
                                    const flag = classifyObservationRange(item.value, item.refLow, item.refHigh);
                                    const range = formatReferenceRange(item.refLow, item.refHigh, item.refText);
                                    return (
                                        <div key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-2 px-3.5 py-1.5">
                                            <span className="min-w-0 truncate text-[13px] text-slate-800 dark:text-slate-100">
                                                {italianLoincLabel(item.code, item.display)}
                                            </span>
                                            <span className="inline-flex items-center gap-2">
                                                <span className={flag ? 'text-sm font-semibold tabular-nums text-[color:var(--mf-critical)]' : 'text-sm tabular-nums text-slate-800 dark:text-slate-100'}>
                                                    {item.value}{item.unitCode ? ` ${item.unitCode}` : ''}
                                                </span>
                                                {range ? <span className="text-[10px] text-slate-400 dark:text-slate-500">rif {range}</span> : null}
                                                {flag ? (
                                                    <span className="rounded-md bg-[color:rgba(163,58,47,0.12)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--mf-critical)]">
                                                        {flag === 'alto' ? 'Alto' : 'Basso'}
                                                    </span>
                                                ) : null}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ))
                ) : (
                    groups.map((group) => {
                        const latest = group.items[0];
                        const previous = group.items[1];
                        const latestNum = toNumeric(latest.value);
                        const previousNum = previous ? toNumeric(previous.value) : null;
                        const delta =
                            latestNum !== null && previousNum !== null ? latestNum - previousNum : 0;
                        const hasTrend = latestNum !== null && previousNum !== null;
                        const chartValues = [...group.items]
                            .slice(0, 12)
                            .reverse()
                            .map((item) => toNumeric(item.value))
                            .filter((n): n is number => n !== null);
                        const label = italianLoincLabel(group.code, group.display);
                        const isOpen = openGroups.has(group.code);
                        const isFull = fullGroups.has(group.code);
                        const regionId = `param-region-${group.code}`;
                        const visibleItems = isFull ? group.items : group.items.slice(0, 5);
                        return (
                            <section
                                key={group.code}
                                className="overflow-hidden rounded-[18px] border border-slate-200/80 bg-white/78 dark:border-white/10 dark:bg-white/5"
                            >
                                <button
                                    type="button"
                                    onClick={() => toggleGroup(group.code)}
                                    aria-expanded={isOpen}
                                    aria-controls={regionId}
                                    className="mf-listrow !rounded-none justify-between px-3.5 py-2.5"
                                >
                                    <span className="min-w-0">
                                        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                            <span className="text-sm font-semibold text-slate-900 dark:text-white">
                                                {label}
                                            </span>
                                            <span className="text-[11px] text-[color:var(--mf-muted)]">
                                                {group.unitCode} · {group.items.length}{' '}
                                                {group.items.length === 1 ? 'misura' : 'misure'}
                                            </span>
                                        </span>
                                        <span className="block font-mono text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                            {group.codeSystem} {group.code}
                                        </span>
                                    </span>
                                    <span className="flex shrink-0 items-center gap-2.5">
                                        <Sparkline values={chartValues} />
                                        <span className={`text-base font-semibold tabular-nums ${classifyObservationRange(latest.value, latest.refLow, latest.refHigh) ? 'text-[color:var(--mf-critical)]' : 'text-slate-900 dark:text-white'}`}>
                                            {latest.value}
                                        </span>
                                        {hasTrend ? (
                                            delta > 0 ? (
                                                <TrendingUp className="h-4 w-4 text-[color:var(--mf-muted)]" aria-label="in aumento" />
                                            ) : delta < 0 ? (
                                                <TrendingDown className="h-4 w-4 text-[color:var(--mf-muted)]" aria-label="in calo" />
                                            ) : (
                                                <Minus className="h-4 w-4 text-[color:var(--mf-muted)]" aria-label="stabile" />
                                            )
                                        ) : null}
                                        <ChevronDown
                                            className={`h-4 w-4 text-[color:var(--mf-muted)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                                            aria-hidden
                                        />
                                    </span>
                                </button>

                                <div id={regionId} hidden={!isOpen}>
                                    {isOpen ? (
                                        <>
                                            <div className="divide-y divide-slate-200/60 border-t border-slate-200/70 dark:divide-white/5 dark:border-white/10">
                                                {visibleItems.map((item) => {
                                                    const interpretation = classifyObservationRange(item.value, item.refLow, item.refHigh);
                                                    const rangeLabel = formatReferenceRange(item.refLow, item.refHigh, item.refText);
                                                    return (
                                                        <div
                                                            key={item.id}
                                                            className="grid grid-cols-[72px_1fr_auto] items-center gap-2 px-3.5 py-1.5"
                                                        >
                                                            <span
                                                                className="text-xs tabular-nums text-[color:var(--mf-muted)]"
                                                                title={new Date(item.observedAt).toLocaleString('it-IT')}
                                                            >
                                                                {new Date(item.observedAt).toLocaleDateString('it-IT', {
                                                                    day: '2-digit',
                                                                    month: '2-digit',
                                                                    year: '2-digit',
                                                                })}
                                                            </span>
                                                            <div className="min-w-0">
                                                                <span className="inline-flex items-center gap-2">
                                                                    <span
                                                                        className={
                                                                            interpretation
                                                                                ? 'text-sm font-semibold tabular-nums text-[color:var(--mf-critical)]'
                                                                                : 'text-sm tabular-nums text-slate-800 dark:text-slate-100'
                                                                        }
                                                                    >
                                                                        {item.value}
                                                                    </span>
                                                                    {rangeLabel ? (
                                                                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                                                            rif {rangeLabel}
                                                                        </span>
                                                                    ) : null}
                                                                    {interpretation ? (
                                                                        <span className="rounded-md bg-[color:rgba(163,58,47,0.12)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--mf-critical)]">
                                                                            {interpretation === 'alto' ? 'Alto' : 'Basso'}
                                                                        </span>
                                                                    ) : null}
                                                                </span>
                                                                {item.notes ? (
                                                                    <span
                                                                        className="block truncate text-[11px] italic text-[color:var(--mf-muted)]"
                                                                        title={item.notes}
                                                                    >
                                                                        {item.notes}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                            <button
                                                                onClick={() => deleteObservation(item.id)}
                                                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                                                                title="Elimina misura"
                                                                aria-label={`Elimina misura ${label} del ${new Date(item.observedAt).toLocaleDateString('it-IT')}`}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="flex items-center justify-between gap-2 px-3.5 py-2">
                                                <button
                                                    type="button"
                                                    onClick={() => prefillGroup(group.code, group.unitCode)}
                                                    className="text-xs font-medium text-[color:var(--mf-ink)] hover:underline"
                                                >
                                                    Registra nuova misura
                                                </button>
                                                {group.items.length > 5 ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleFull(group.code)}
                                                        className="text-xs font-medium text-[color:var(--mf-muted)] transition-colors hover:text-[color:var(--mf-ink)]"
                                                    >
                                                        {isFull ? 'Mostra meno' : `Mostra tutte le ${group.items.length} misure`}
                                                    </button>
                                                ) : null}
                                            </div>
                                        </>
                                    ) : null}
                                </div>
                            </section>
                        );
                    })
                )}
            </div>
        </div>
    );
}
