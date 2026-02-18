'use client';

/* @Codex */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { Activity, Droplets, Plus, Trash2 } from 'lucide-react';
import { db } from '@/lib/db';
import { searchStaticTerminology } from '@/lib/terminology';

/* @Codex */
function toLocalDateTimeInput(date: Date): string {
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/* @Codex */
export default function ObservationManager({ patientId }: { patientId: string }) {
    const [code, setCode] = useState('8480-6');
    const [unitCode, setUnitCode] = useState('mm[Hg]');
    const [value, setValue] = useState('');
    const [observedAt, setObservedAt] = useState(toLocalDateTimeInput(new Date()));
    const [notes, setNotes] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const loincOptions = useMemo(() => searchStaticTerminology('LOINC', '', 200), []);
    const ucumOptions = useMemo(() => searchStaticTerminology('UCUM', '', 200), []);

    const observations = useLiveQuery(
        async () => {
            const items = await db.observations.filter((o) => o.patientId === patientId).toArray();
            return items.sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
        },
        [patientId],
    );

    const selectedLoinc = loincOptions.find((item) => item.code === code);

    const saveObservation = async (event: React.FormEvent) => {
        event.preventDefault();
        if (isSaving) return;

        const numericValue = Number(value);
        const observedDate = new Date(observedAt);
        if (!Number.isFinite(numericValue) || Number.isNaN(observedDate.getTime()) || !selectedLoinc) {
            return;
        }

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
        if (!confirm('Eliminare questa osservazione codificata?')) return;
        try {
            await db.observations.delete(id);
        } catch (error) {
            console.error('Failed to delete observation', error);
            alert('Eliminazione osservazione fallita');
        }
    };

    return (
        <div className="glass-panel p-6 space-y-5">
            <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <h3 className="font-bold text-gray-800 dark:text-gray-100">Osservazioni Codificate (LOINC + UCUM)</h3>
            </div>

            <form onSubmit={saveObservation} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase text-gray-500">Parametro (LOINC)</span>
                    <select
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="w-full p-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 text-sm"
                    >
                        {loincOptions.map((item) => (
                            <option key={item.code} value={item.code}>
                                {item.code} - {item.display}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase text-gray-500">Data/Ora</span>
                    <input
                        type="datetime-local"
                        value={observedAt}
                        onChange={(e) => setObservedAt(e.target.value)}
                        className="w-full p-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 text-sm dark:[color-scheme:dark]"
                    />
                </label>

                <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase text-gray-500">Valore</span>
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="Es. 120"
                        inputMode="decimal"
                        className="w-full p-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 text-sm"
                    />
                </label>

                <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase text-gray-500">Unità (UCUM)</span>
                    <select
                        value={unitCode}
                        onChange={(e) => setUnitCode(e.target.value)}
                        className="w-full p-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 text-sm"
                    >
                        {ucumOptions.map((item) => (
                            <option key={item.code} value={item.code}>
                                {item.code} - {item.display}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="md:col-span-2 space-y-1">
                    <span className="text-[11px] font-semibold uppercase text-gray-500">Note (opzionale)</span>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        className="w-full p-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 text-sm"
                        placeholder="Contesto rilevazione, paziente a riposo, ecc."
                    />
                </label>

                <div className="md:col-span-2 flex justify-end">
                    <button
                        type="submit"
                        disabled={isSaving || value.trim().length === 0}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
                    >
                        <Plus className="w-4 h-4" />
                        {isSaving ? 'Salvataggio...' : 'Aggiungi Osservazione'}
                    </button>
                </div>
            </form>

            <div className="space-y-2">
                {!observations || observations.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">Nessuna osservazione codificata registrata.</p>
                ) : (
                    observations.map((item) => (
                        <div
                            key={item.id}
                            className="rounded-xl border border-emerald-100 dark:border-emerald-700/30 bg-emerald-50/40 dark:bg-emerald-900/10 p-3"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                    <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                                        {item.display}
                                    </p>
                                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-mono">
                                        {item.codeSystem}: {item.code}
                                    </p>
                                    <p className="text-sm text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                                        <Droplets className="w-3.5 h-3.5 text-emerald-500" />
                                        {item.value} {item.unitCode}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {new Date(item.observedAt).toLocaleString('it-IT')}
                                    </p>
                                    {item.notes && (
                                        <p className="text-xs text-gray-600 dark:text-gray-300 italic">{item.notes}</p>
                                    )}
                                </div>
                                <button
                                    onClick={() => deleteObservation(item.id)}
                                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                                    title="Elimina osservazione"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
