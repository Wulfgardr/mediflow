'use client';

/* @Codex */
import { useMemo, useState } from 'react';
import { useLiveQuery } from '@/lib/live-query';
import { v4 as uuidv4 } from 'uuid';
import { Activity, Minus, Plus, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { db } from '@/lib/db';
import { searchStaticTerminology } from '@/lib/terminology';

/* @Codex */
function toLocalDateTimeInput(date: Date): string {
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/*
 * @Codex Range di riferimento per analita (LOINC).
 * Lasciato vuoto di proposito: i range clinici dipendono da metodica, sesso ed
 * eta e non vanno inventati. Popolare con dati validati localmente; finche una
 * voce non esiste, nessun flag di anomalia viene mostrato (stato onesto).
 */
const REFERENCE_RANGES: Record<string, { low: number; high: number }> = {};

/*
 * @Codex Observation.value e tipizzato number | string (lib/db.ts:825): import/API
 * possono scrivere stringhe (es. "120/80", "positivo"). Coerciamo una sola volta
 * al numero per i calcoli (delta, sparkline, range) e teniamo il valore grezzo per
 * la visualizzazione. Se non e un numero finito, niente trend ne flag.
 */
function toNumeric(value: number | string): number | null {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

function interpretValue(code: string, value: number | string): 'basso' | 'alto' | null {
    const range = REFERENCE_RANGES[code];
    if (!range) return null;
    const n = toNumeric(value);
    if (n === null) return null;
    if (n < range.low) return 'basso';
    if (n > range.high) return 'alto';
    return null;
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
export default function ObservationManager({ patientId }: { patientId: string }) {
    const [code, setCode] = useState('8480-6');
    const [unitCode, setUnitCode] = useState('mm[Hg]');
    const [value, setValue] = useState('');
    const [observedAt, setObservedAt] = useState(toLocalDateTimeInput(new Date()));
    const [notes, setNotes] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [valueError, setValueError] = useState<string | null>(null);

    const loincOptions = useMemo(() => searchStaticTerminology('LOINC', '', 200), []);
    const ucumOptions = useMemo(() => searchStaticTerminology('UCUM', '', 200), []);

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

    const selectedLoinc = loincOptions.find((item) => item.code === code);

    const saveObservation = async (event: React.FormEvent) => {
        event.preventDefault();
        if (isSaving) return;

        /* @Codex Accetta la virgola decimale italiana ("36,5") oltre al punto. */
        const numericValue = Number(value.replace(',', '.').trim());
        const observedDate = new Date(observedAt);
        if (!Number.isFinite(numericValue)) {
            setValueError('Inserisci un valore numerico, ad esempio 36.5');
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
                display: selectedLoinc.display,
                unitSystem: 'UCUM',
                unitCode,
                value: numericValue,
                notes: notes.trim() || undefined,
                observedAt: observedDate,
                source: 'manual',
                createdAt: new Date(),
            });

            setValue('');
            setNotes('');
            setObservedAt(toLocalDateTimeInput(new Date()));
        } catch (error) {
            console.error('Failed to save observation', error);
            alert('Salvataggio osservazione fallito');
        } finally {
            setIsSaving(false);
        }
    };

    const deleteObservation = async (id: string) => {
        if (!confirm('Eliminare questa misura?')) return;
        try {
            await db.observations.delete(id);
        } catch (error) {
            console.error('Failed to delete observation', error);
            alert('Eliminazione misura fallita');
        }
    };

    return (
        <div className="patient-detail-section glass-panel border p-6 space-y-5">
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

            <form onSubmit={saveObservation} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="space-y-1">
                    <span className="section-kicker">Parametro</span>
                    <select
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="mf-input"
                    >
                        {loincOptions.map((item) => (
                            <option key={item.code} value={item.code}>
                                {item.display}
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
                                {item.display}
                            </option>
                        ))}
                    </select>
                    <span className="block text-[10.5px] font-mono uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        UCUM {unitCode}
                    </span>
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
                        return (
                            <section
                                key={group.code}
                                className="overflow-hidden rounded-[18px] border border-slate-200/80 bg-white/78 dark:border-white/10 dark:bg-white/5"
                            >
                                <header className="flex items-center justify-between gap-3 border-b border-slate-200/70 bg-white/55 px-3.5 py-2.5 dark:border-white/10 dark:bg-white/5">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                            <span className="text-sm font-semibold text-slate-900 dark:text-white">
                                                {group.display}
                                            </span>
                                            <span className="text-[11px] text-[color:var(--mf-muted)]">
                                                {group.unitCode} · {group.items.length}{' '}
                                                {group.items.length === 1 ? 'misura' : 'misure'}
                                            </span>
                                        </div>
                                        <span className="font-mono text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                            {group.codeSystem} {group.code}
                                        </span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2.5">
                                        <Sparkline values={chartValues} />
                                        <span className="text-base font-semibold tabular-nums text-slate-900 dark:text-white">
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
                                    </div>
                                </header>

                                <div className="divide-y divide-slate-200/60 dark:divide-white/5">
                                    {group.items.map((item) => {
                                        const interpretation = interpretValue(item.code, item.value);
                                        const range = REFERENCE_RANGES[item.code];
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
                                                        {range ? (
                                                            <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                                                rif {range.low}-{range.high}
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
                                                    aria-label={`Elimina misura ${group.display} del ${new Date(item.observedAt).toLocaleDateString('it-IT')}`}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })
                )}
            </div>
        </div>
    );
}
