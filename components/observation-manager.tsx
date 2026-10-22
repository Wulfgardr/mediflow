'use client';

import { Disclosure, DisclosureControl } from '@/components/disclosure';
import styles from './clinical-register.module.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from '@/lib/live-query';
import { v4 as uuidv4 } from 'uuid';
import { Minus, Plus, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { ApiConflictError, db } from '@/lib/db';
import { notifyDbChange } from '@/lib/live-query';
import { searchStaticTerminology } from '@/lib/terminology';
import { classifyObservationRange, formatReferenceRange } from '@/lib/observation-range';
import {
    applyObservationPrefill,
    type ObservationPrefill,
    type ServicePrescriptionItemLink,
} from '@/lib/observation-prefill';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useRuntimeTwinPendingForm } from '@/components/runtime-twin-design';

function toLocalDateTimeInput(date: Date): string {
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

const DEFAULT_OBSERVATION_CODE = '8480-6';
const DEFAULT_OBSERVATION_UNIT = 'mm[Hg]';

/*
 * Observation.value e tipizzato number | string (lib/db.ts): import/API
 * possono scrivere stringhe (es. "120/80", "positivo"). Coerciamo una sola volta
 * al numero per i calcoli (delta, sparkline). Se non e un numero finito, niente
 * trend. La classificazione fuori-range usa il range per-record (refLow/refHigh)
 * via lib/observation-range (sorgente unica di verita), mai range inventati.
 */
function toNumeric(value: number | string): number | null {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}


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
            className="text-[color:var(--lume-ink-muted)]"
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

export type { ObservationPrefill } from '@/lib/observation-prefill';

export default function ObservationManager({
    patientId,
    embedded = false,
    prefill,
}: {
    patientId: string;
    embedded?: boolean;
    prefill?: ObservationPrefill;
}) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [code, setCode] = useState(DEFAULT_OBSERVATION_CODE);
    const [unitCode, setUnitCode] = useState(DEFAULT_OBSERVATION_UNIT);
    const [value, setValue] = useState('');
    const [observedAt, setObservedAt] = useState(() => toLocalDateTimeInput(new Date()));
    const [notes, setNotes] = useState('');
    // S6: range di riferimento del referto (opzionali). Se assenti, nessun flag.
    const [refLow, setRefLow] = useState('');
    const [refHigh, setRefHigh] = useState('');
    const [servicePrescriptionItemId, setServicePrescriptionItemId] = useState<string | undefined>();
    const [servicePrescriptionItem, setServicePrescriptionItem] = useState<ServicePrescriptionItemLink | undefined>();
    const [isSaving, setIsSaving] = useState(false);
    const [valueError, setValueError] = useState<string | null>(null);
    const initialObservedAt = useRef(observedAt);
    const codeSelectRef = useRef<HTMLSelectElement>(null);
    const [formOpen, setFormOpen] = useState(false);
    const valueInputRef = useRef<HTMLInputElement>(null);
    /* WUL-UIUX: piu analiti possono restare aperti insieme (confronto tra
       parametri in polifarmaco); "full" espande l'intera storia oltre le ultime 5. */
    const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
    const [fullGroups, setFullGroups] = useState<Set<string>>(new Set());
    const selectionPatient = useRef<string | null>(null);
    /* WUL-UIUX (Fase 3): "Per data" legge un prelievo/pannello a colpo
       d'occhio (piu analiti dello stesso giorno). "Stesso giorno" e un'euristica
       onesta di UI (label "Misure del giorno", non "Referto"): senza panelId nello
       schema non si afferma che sia lo stesso referto. */
    const [viewMode, setViewMode] = useState<'parametro' | 'data'>('parametro');
    const loincOptions = useMemo(() => searchStaticTerminology('LOINC', '', 500), []);
    const ucumOptions = useMemo(() => searchStaticTerminology('UCUM', '', 500), []);

    const hasPendingObservation = Boolean(
        value.trim()
        || notes.trim()
        || refLow.trim()
        || refHigh.trim()
        || code !== DEFAULT_OBSERVATION_CODE
        || unitCode !== DEFAULT_OBSERVATION_UNIT
        || observedAt !== initialObservedAt.current
        || servicePrescriptionItemId
        || servicePrescriptionItem,
    );
    useRuntimeTwinPendingForm(hasPendingObservation);

    useEffect(() => {
        if (!prefill) return;
        const applied = applyObservationPrefill(prefill, loincOptions);
        setCode(applied.code);
        setUnitCode(applied.unitCode);
        setServicePrescriptionItemId(applied.servicePrescriptionItemId);
        setServicePrescriptionItem(applied.servicePrescriptionItem);
        requestAnimationFrame(() => {
            setFormOpen(true);
            valueInputRef.current?.focus();
        });
    }, [loincOptions, prefill]);

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
        setFormOpen(true);
        valueInputRef.current?.focus();
    };

    /* Etichetta italiana per un analita, con fallback al display grezzo
       (regge sia i record storici in inglese sia quelli nuovi). */
    const italianLoincLabel = (analyteCode: string, fallback: string) =>
        loincOptions.find((item) => item.code === analyteCode)?.displayIt ?? fallback;

    const observations = useLiveQuery(
        async () => {
            if (!patientId) return [];
            const items = await db.observations.query({ patientId }).toArray();
            return items.sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
        },
        [patientId],
        undefined,
        ['observations'],
    );

    type Observation = NonNullable<typeof observations>[number];

    /* Raggruppamento per analita: una sezione densa per parametro,
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

    useEffect(() => {
        if (!groups || selectionPatient.current === patientId) return;
        selectionPatient.current = patientId;
        setOpenGroups(new Set(groups[0] ? [groups[0].code] : []));
        setFullGroups(new Set());
    }, [groups, patientId]);

    /* WUL-UIUX (Fase 3): raggruppamento per giorno locale di observedAt,
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

        /* Accetta la virgola decimale italiana ("36,5") oltre al punto. */
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
                servicePrescriptionItemId,
            });

            /* WUL-UIUX Trascrizione referto multi-analita: conservare la
               data del prelievo e riportare il focus sul parametro, cosi la misura
               successiva dello stesso referto mantiene lo stesso timestamp. */
            setValue('');
            setNotes('');
            setRefLow('');
            setRefHigh('');
            setServicePrescriptionItemId(undefined);
            setServicePrescriptionItem(undefined);
            codeSelectRef.current?.focus();
        } catch (error) {
            console.error('Failed to save observation', error);
            showToast({ tone: 'error', title: 'Salvataggio osservazione fallito' });
        } finally {
            setIsSaving(false);
        }
    };

    const deleteObservation = async (id: string) => {
        const observation = observations?.find((item) => item.id === id);
        if (!observation || typeof observation.version !== 'number') {
            showToast({ tone: 'error', title: 'Versione osservazione non disponibile', description: 'Ricarica la pagina e riprova.' });
            return;
        }
        const { confirmed } = await confirm({
            title: 'Eliminare questa misura?',
            message: 'La misura verra rimossa dai parametri clinici del paziente.',
            confirmLabel: 'Elimina',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            await db.observations.delete(id, { version: observation.version });
        } catch (error) {
            console.error('Failed to delete observation', error);
            if (error instanceof ApiConflictError) {
                notifyDbChange('observations');
                showToast({ tone: 'error', title: 'Osservazione aggiornata altrove', description: 'I dati sono stati ricaricati. Controlla e riprova.' });
                return;
            }
            showToast({ tone: 'error', title: 'Eliminazione misura fallita' });
        }
    };

    return (
        <div className={styles.register} data-clinical-register="observations">
            {!embedded && <header className={styles.toolbar}><h2>Parametri clinici</h2></header>}
            <Disclosure open={formOpen} onOpenChange={setFormOpen} className={styles.formDisclosure} title="Nuova misura">
            <form onSubmit={saveObservation} className={styles.form + " grid grid-cols-1 gap-3 md:grid-cols-2"}>
                {servicePrescriptionItemId && servicePrescriptionItem ? (
                    <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-3.5 py-2.5">
                        <span className="text-sm text-[color:var(--lume-ink)]">
                            Collegata a: <strong>{servicePrescriptionItem.serviceName}</strong> (prescrizione del {new Date(servicePrescriptionItem.prescriptionDate).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })})
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                setServicePrescriptionItemId(undefined);
                                setServicePrescriptionItem(undefined);
                            }}
                            className="text-xs font-medium text-[color:var(--lume-ink-muted)] hover:text-[color:var(--lume-ink)] hover:underline"
                        >
                            Rimuovi collegamento
                        </button>
                    </div>
                ) : null}
                <label className="space-y-1">
                    <span className="section-kicker">Parametro</span>
                    <select
                        ref={codeSelectRef}
                        value={code}
                        onChange={(e) => {
                            const next = e.target.value;
                            setCode(next);
                            /* Imposta l'unita di default dell'analita
                               (resta modificabile), evita "Glicemia 90 mmHg". */
                            const option = loincOptions.find((item) => item.code === next);
                            if (option?.defaultUnit) setUnitCode(option.defaultUnit);
                        }}
                        className="mf-input"
                    >
                        <option value="">Seleziona parametro</option>
                        {loincOptions.map((item) => (
                            <option key={item.code} value={item.code}>
                                {item.displayIt ?? item.display}
                            </option>
                        ))}
                    </select>
                    {selectedLoinc ? (
                        <span className="block lume-code uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
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
                        <span className="block text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">{valueError}</span>
                    ) : null}
                </label>

                <label className="space-y-1">
                    <span className="section-kicker">Unita</span>
                    <select
                        value={unitCode}
                        onChange={(e) => setUnitCode(e.target.value)}
                        className="mf-input"
                    >
                        <option value="">Seleziona unità</option>
                        {ucumOptions.map((item) => (
                            <option key={item.code} value={item.code}>
                                {item.displayIt ?? item.display}
                            </option>
                        ))}
                    </select>
                    <span className="block lume-code uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
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
                        disabled={isSaving || value.trim().length === 0 || !code || !unitCode}
                        className="ui-btn-primary inline-flex h-10 items-center gap-1.5 px-4 text-sm font-semibold disabled:opacity-50"
                    >
                        <Plus className="w-4 h-4" />
                        {isSaving ? 'Salvataggio...' : 'Registra parametro'}
                    </button>
                </div>
            </form>
            </Disclosure>
            <div className={styles.toolbar}>
                <h2>Ultime misure <span className={styles.muted}>{groups?.length ?? ''}</span></h2>
                {groups && groups.length > 0 && <div role="group" aria-label="Vista parametri" className={styles.controls}>
                    <button type="button" aria-pressed={viewMode === 'parametro'} onClick={() => setViewMode('parametro')}>Per parametro</button>
                    <button type="button" aria-pressed={viewMode === 'data'} onClick={() => setViewMode('data')}>Per data</button>
                </div>}
            </div>
            {groups === undefined ? <div className={styles.loading} role="status" aria-label="Caricamento misure"><span className="sr-only">Caricamento misure…</span>{[0,1,2].map(row => <div key={row} className="mf-skeleton" aria-hidden />)}</div>
            : groups.length === 0 ? <p className={styles.empty}>Nessun parametro registrato. Apri “Nuova misura” per registrare la prima misura.</p>
            : viewMode === 'data' ? (byDay ?? []).map(day => <section key={day.key}>
                <header className={styles.sectionHead}><h3>Misure del {day.date.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}</h3><span>{day.items.length} misure</span></header>
                <table className={styles.table}><thead><tr><th>Misura</th><th className={styles.value}>Valore</th><th>Riferimento</th></tr></thead><tbody>
                    {day.items.map(item => { const flag = classifyObservationRange(item.value, item.refLow, item.refHigh); return <tr key={item.id}>
                        <td>{italianLoincLabel(item.code, item.display)}</td>
                        <td className={`${styles.value} ${flag ? styles.critical : ''}`}>{item.value} {item.unitCode}{flag && <small>{flag === 'alto' ? '▲ Alto' : '▼ Basso'}</small>}</td>
                        <td className={styles.muted}>{formatReferenceRange(item.refLow, item.refHigh, item.refText) || '—'}</td>
                    </tr>; })}
                </tbody></table>
            </section>) : <div className={styles.split}>
                <div><table className={styles.table}><thead><tr><th>Misura</th><th className={styles.value}>Valore</th><th>Data</th><th className={styles.secondaryColumn}>Variazione</th></tr></thead><tbody>
                    {groups.map(group => {
                        const latest = group.items[0]; const previous = group.items[1];
                        const latestNum = toNumeric(latest.value); const previousNum = previous ? toNumeric(previous.value) : null;
                        const delta = latestNum !== null && previousNum !== null ? latestNum - previousNum : null;
                        const flag = classifyObservationRange(latest.value, latest.refLow, latest.refHigh);
                        return <tr key={group.code} className={openGroups.has(group.code) ? styles.selected : undefined}>
                            <td><DisclosureControl onToggle={() => toggleGroup(group.code)} expanded={openGroups.has(group.code)} controls={`param-region-${group.code}`}>
                                {italianLoincLabel(group.code, group.display)}
                            </DisclosureControl></td>
                            <td className={`${styles.value} ${flag ? styles.critical : ''}`}>{latest.value} <span className={styles.muted}>{group.unitCode}</span>{flag && <small>{flag === 'alto' ? '▲ Alto' : '▼ Basso'}</small>}</td>
                            <td className={styles.muted}><time>{new Date(latest.observedAt).toLocaleDateString('it-IT')}</time></td>
                            <td className={styles.secondaryColumn}>{delta === null ? '—' : <span className="inline-flex items-center gap-1">{delta > 0 ? <TrendingUp size={14} aria-label="in aumento" /> : delta < 0 ? <TrendingDown size={14} aria-label="in calo" /> : <Minus size={14} aria-label="stabile" />}{delta > 0 ? '+' : ''}{delta.toLocaleString('it-IT')}</span>}</td>
                        </tr>;
                    })}
                </tbody></table></div>
                <aside className={styles.detail} aria-label="Andamento e storia delle misure">
                    {groups.every(group => !openGroups.has(group.code)) && <p className={styles.empty}>Scegli una misura per leggere l’andamento e le registrazioni precedenti. Puoi confrontare più parametri.</p>}
                    {groups.map(group => {
                        const isOpen = openGroups.has(group.code); const isFull = fullGroups.has(group.code);
                        const label = italianLoincLabel(group.code, group.display);
                        const chartValues = group.items.slice(0,12).reverse().map(item => toNumeric(item.value)).filter((n): n is number => n !== null);
                        const visibleItems = isFull ? group.items : group.items.slice(0,5);
                        return <section key={group.code} id={`param-region-${group.code}`} hidden={!isOpen}>
                            {isOpen && <>
                                <header className={styles.sectionHead}><h3>{label}</h3><span>{group.unitCode}</span></header>
                                <p className={`${styles.muted} lume-code`}>{group.codeSystem} {group.code}</p>
                                <div className={styles.trend}><Sparkline values={chartValues} /></div>
                                <table className={styles.table}><thead><tr><th>Data</th><th>Valore</th><th aria-label="Azioni" /></tr></thead><tbody>{visibleItems.map(item => {
                                    const flag = classifyObservationRange(item.value, item.refLow, item.refHigh); const range = formatReferenceRange(item.refLow, item.refHigh, item.refText);
                                    return <tr key={item.id}><td className={styles.muted}><time title={new Date(item.observedAt).toLocaleString('it-IT')}>{new Date(item.observedAt).toLocaleDateString('it-IT')}</time></td>
                                        <td><strong className={flag ? styles.critical : undefined}>{item.value}</strong>{flag && <span className={styles.critical}> {flag === 'alto' ? '▲ Alto' : '▼ Basso'}</span>}{range && <small>rif {range}</small>}{item.notes && <small>{item.notes}</small>}</td>
                                        <td><button type="button" onClick={() => deleteObservation(item.id)} className={styles.control} title="Elimina misura" aria-label={`Elimina misura ${label} del ${new Date(item.observedAt).toLocaleDateString('it-IT')}`}><Trash2 size={16} aria-hidden /></button></td>
                                    </tr>;
                                })}</tbody></table>
                                <div className={`${styles.controls} mt-3`}><button type="button" onClick={() => prefillGroup(group.code, group.unitCode)}>Registra nuova misura</button>{group.items.length > 5 && <button type="button" onClick={() => toggleFull(group.code)}>{isFull ? 'Ultime 5' : `Tutte (${group.items.length})`}</button>}</div>
                            </>}
                        </section>;
                    })}
                </aside>
            </div>}
        </div>
    );
}
