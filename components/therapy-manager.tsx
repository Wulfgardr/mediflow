'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Therapy } from '@/lib/db';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Plus, Pill, X, Clock, StopCircle, Trash2, Shield, Ban, Database, Pencil, Play, Beaker } from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import ICDAutocomplete from './icd-autocomplete';
import DrugAutocomplete from './drug-autocomplete';
import { AifaDrug } from '@/lib/db';

const therapySchema = z.object({
    drugName: z.string().min(2, "Il nome del farmaco è richiesto"),
    activePrinciple: z.string().optional(),
    dosage: z.string().min(1, "La posologia è richiesta"),
    motivation: z.string().optional(),
    status: z.enum(['active', 'suspended', 'completed']).default('active'),
});

type TherapyFormValues = z.infer<typeof therapySchema>;

export default function TherapyManager({ patientId }: { patientId: string }) {
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isGalenic, setIsGalenic] = useState(false); // Toggle for Free Text vs AIFA
    const [selectedDiagnosis, setSelectedDiagnosis] = useState<{ code: string; title: string } | null>(null);

    const therapies = useLiveQuery(
        async () => {
            const items = await db.therapies.filter((t: any) => t.patientId === patientId).toArray();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return items.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        },
        [patientId]
    );

    const patient = useLiveQuery(
        () => db.patients.get(patientId),
        [patientId]
    );

    const visibleTherapies = therapies || [];

    const activeTherapies = visibleTherapies.filter(t => t.status === 'active');
    const suspendedTherapies = visibleTherapies.filter(t => t.status === 'suspended');
    const endedTherapies = visibleTherapies.filter(t => t.status === 'completed');

    const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<TherapyFormValues>({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolver: zodResolver(therapySchema) as any
    });

    const startEditing = (therapy: Therapy) => {
        setEditingId(therapy.id);
        setIsAdding(true);
        setValue('drugName', therapy.drugName);
        setValue('activePrinciple', therapy.activePrinciple);
        setValue('dosage', therapy.dosage);
        setValue('motivation', therapy.motivation);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((therapy as any).diagnosisCode && (therapy as any).diagnosisName) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setSelectedDiagnosis({ code: (therapy as any).diagnosisCode, title: (therapy as any).diagnosisName });
        } else {
            setSelectedDiagnosis(null);
        }
        setIsGalenic(!therapy.activePrinciple);
    };

    const cancelEditing = () => {
        setIsAdding(false);
        setEditingId(null);
        reset();
        setSelectedDiagnosis(null);
        setIsGalenic(false);
    };

    const onSubmit = async (data: TherapyFormValues) => {
        try {
            if (editingId) {
                // UPDATE EXISTING
                await db.therapies.update(editingId, {
                    ...data,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    diagnosisCode: selectedDiagnosis?.code as any,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    diagnosisName: selectedDiagnosis?.title as any,
                    updatedAt: new Date()
                });
            } else {
                // CREATE NEW
                await db.therapies.add({
                    id: uuidv4(),
                    patientId,
                    ...data,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    diagnosisCode: selectedDiagnosis?.code as any,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    diagnosisName: selectedDiagnosis?.title as any,
                    startDate: new Date(),
                    createdAt: new Date(),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    updatedAt: new Date() as any
                });

                if (selectedDiagnosis?.code &&
                    selectedDiagnosis.code !== 'PREV' &&
                    selectedDiagnosis.code !== 'NONE' &&
                    patient) {

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const exists = (patient as any).diagnoses?.some((d: any) => d.code === selectedDiagnosis.code);

                    if (!exists) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const currentDiagnoses = (patient as any).diagnoses || [];
                        await db.patients.update(patientId, {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            diagnoses: [...currentDiagnoses, {
                                code: selectedDiagnosis.code,
                                description: selectedDiagnosis.title,
                                system: 'ICD-11',
                                date: new Date()
                            }] as any
                        });
                    }
                }
            }

            cancelEditing();
        } catch (error) {
            console.error("Failed to save therapy", error);
        }
    };

    const updateStatus = async (id: string, status: Therapy['status']) => {
        await db.therapies.update(id, { status, updatedAt: new Date() }); // updatedAt not in interface but in schema
    };

    const handleSoftDelete = async (id: string) => {
        if (confirm('Eliminare questo farmaco? (Usare questa opzione solo per errori di inserimento. Per interrompere una terapia, usare "Termina" o "Sospendi")')) {
            await db.therapies.delete(id);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                    <Pill className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    Terapia Farmacologica
                </h3>
                {!isAdding && (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Aggiungi Farmaco
                    </button>
                )}
            </div>

            {isAdding && (
                <div className="glass-panel p-4 animate-in fade-in slide-in-from-top-4">
                    <div className="flex justify-between items-center mb-4 border-b border-gray-100 pb-2">
                        <h4 className="font-semibold text-gray-700">{editingId ? 'Modifica Terapia' : 'Nuova Prescrizione'}</h4>
                        <button onClick={cancelEditing} aria-label="Chiudi"><X className="w-5 h-5 text-gray-400 hover:text-gray-600" /></button>
                    </div>

                    <div className="flex items-center gap-4 mb-4">
                        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">
                            <input
                                type="checkbox"
                                checked={isGalenic}
                                onChange={(e) => setIsGalenic(e.target.checked)}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300"
                            />
                            <Beaker className="w-4 h-4" />
                            Modalità Galenica / Manuale
                        </label>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center justify-between">
                                    <span>Nome Farmaco</span>
                                    {!isGalenic && <span className="text-[10px] text-indigo-500 flex items-center gap-1"><Database className="w-3 h-3" /> Database AIFA</span>}
                                </label>

                                {isGalenic ? (
                                    <input {...register('drugName')} className="w-full p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Es. Preparazione Magistrale..." />
                                ) : (
                                    <div className="relative">
                                        <DrugAutocomplete
                                            onSelect={(drug: AifaDrug) => {
                                                setValue('drugName', drug.name);
                                                setValue('activePrinciple', drug.activePrinciple);
                                            }}
                                            placeholder="Cerca per Nome o Principio Attivo..."
                                            autoFocus
                                            defaultValue={editingId ? undefined : undefined} // Could pass initial value but simple reload is usually safer
                                        />
                                        {/* Hidden input to bind react-hook-form validation */}
                                        <input type="hidden" {...register('drugName')} />
                                    </div>
                                )}

                                {errors.drugName && <p className="text-xs text-red-500">{errors.drugName.message}</p>}
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-gray-500 uppercase">Principio Attivo</label>
                                <input {...register('activePrinciple')} className="w-full p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Es. Furosemide" readOnly={!isGalenic} />
                            </div>
                            <div className="col-span-full space-y-1">
                                <label className="text-xs font-semibold text-gray-500 uppercase">Posologia</label>
                                <input {...register('dosage')} className="w-full p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Es. 1 cp ore 8:00, 1/2 cp ore 20:00" />
                                {errors.dosage && <p className="text-xs text-red-500">{errors.dosage.message}</p>}
                            </div>
                            <div className="col-span-full space-y-1">
                                <label className="text-xs font-semibold text-gray-500 uppercase">Motivazione / Note</label>
                                <textarea {...register('motivation')} className="w-full p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Per scompenso cardiaco..." />
                            </div>

                            <div className="col-span-full space-y-1">
                                <label className="text-xs font-semibold text-gray-500 uppercase">Indicazione (ICD-11)</label>

                                {/* Quick Suggestions */}
                                {patient && (
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {patient.diagnoses?.map(d => (
                                            <button
                                                key={d.code}
                                                type="button"
                                                onClick={() => setSelectedDiagnosis({ code: d.code, title: d.description })}
                                                className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${selectedDiagnosis?.code === d.code ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                                            >
                                                {d.description}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setSelectedDiagnosis({ code: 'PREV', title: 'Prevenzione' })}
                                            className={`text-[10px] px-2 py-1 rounded-full border flex items-center gap-1 transition-colors ${selectedDiagnosis?.code === 'PREV' ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-green-200 text-green-600 hover:bg-green-50'}`}
                                        >
                                            <Shield className="w-3 h-3" /> Prevenzione
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedDiagnosis(null)}
                                            className={`text-[10px] px-2 py-1 rounded-full border flex items-center gap-1 transition-colors ${!selectedDiagnosis ? 'bg-gray-200 border-gray-300 text-gray-700' : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-50'}`}
                                        >
                                            <Ban className="w-3 h-3" /> Nessuna
                                        </button>
                                    </div>
                                )}

                                <ICDAutocomplete
                                    onSelect={(code, title) => setSelectedDiagnosis({ code, title })}
                                    initialValue={selectedDiagnosis}
                                />
                                <p className="text-[10px] text-gray-400">
                                    {selectedDiagnosis?.code === 'PREV'
                                        ? "Indicazione: Prevenzione"
                                        : (selectedDiagnosis ? "Nuove diagnosi verranno aggiunte alla scheda paziente." : "Opzionale: Collega a una diagnosi")}
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end pt-2 gap-2">
                            <button type="button" onClick={cancelEditing} className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">Annulla</button>
                            <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700">
                                {editingId ? 'Aggiorna Terapia' : 'Salva Terapia'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="space-y-4">
                {activeTherapies.length === 0 && suspendedTherapies.length === 0 ? (
                    <div className="p-8 text-center bg-gray-50/50 dark:bg-white/5 rounded-xl border border-dashed border-gray-200 dark:border-white/10">
                        <p className="text-gray-500 dark:text-gray-400 text-sm">Nessuna terapia attiva.</p>
                    </div>
                ) : (
                    <>
                        {/* ACTIVE */}
                        {activeTherapies.map(t => (
                            <div key={t.id} className="p-4 bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl shadow-sm hover:shadow-md transition-shadow flex flex-col sm:flex-row justify-between items-start gap-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <h4 className="font-bold text-gray-800 dark:text-white text-lg">{t.drugName}</h4>
                                        {t.activePrinciple && <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-300 rounded-full font-mono">{t.activePrinciple}</span>}
                                    </div>
                                    <p className="text-indigo-600 dark:text-indigo-300 font-medium mt-1">{t.dosage}</p>

                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                    {(t as any).diagnosisCode && (
                                        <div className="mt-1 flex items-center gap-1.5">
                                            <span className="text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded border border-blue-100 dark:border-blue-500/20 font-medium">
                                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                ICD: {(t as any).diagnosisCode}
                                            </span>
                                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]" title={(t as any).diagnosisName}>
                                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                {(t as any).diagnosisName}
                                            </span>
                                        </div>
                                    )}

                                    {t.motivation && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 italic">&quot;{t.motivation}&quot;</p>}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        onClick={() => startEditing(t)}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 rounded-lg text-xs font-medium transition-colors border border-gray-200 hover:border-indigo-200"
                                        title="Modifica prescrizione"
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                        Modifica
                                    </button>

                                    <button
                                        onClick={() => updateStatus(t.id, 'suspended')}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-lg text-xs font-medium transition-colors border border-orange-100"
                                        title="Sospendi temporaneamente"
                                    >
                                        <Clock className="w-3.5 h-3.5" />
                                        Sospendi
                                    </button>

                                    <button
                                        onClick={() => updateStatus(t.id, 'completed')}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg text-xs font-medium transition-colors border border-gray-200"
                                        title="Termina terapia"
                                    >
                                        <StopCircle className="w-3.5 h-3.5" />
                                        Termina
                                    </button>

                                    <button
                                        onClick={() => handleSoftDelete(t.id)}
                                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Elimina (Errore Inserimento)"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}

                        {/* SUSPENDED */}
                        {suspendedTherapies.length > 0 && (
                            <div className="space-y-2 mt-4">
                                <h5 className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <Clock className="w-3 h-3" /> Terapie Sospese
                                </h5>
                                {suspendedTherapies.map(t => (
                                    <div key={t.id} className="p-3 bg-orange-50 dark:bg-orange-900/10 border border-orange-100 dark:border-orange-500/20 rounded-lg flex flex-col sm:flex-row justify-between items-center gap-3 opacity-90 transition-opacity">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-orange-900 dark:text-orange-100">{t.drugName}</span>
                                                <span className="text-xs bg-orange-200 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 px-1.5 py-0.5 rounded">SOSPESO</span>
                                            </div>
                                            <p className="text-xs text-orange-800 dark:text-orange-200 mt-0.5">{t.dosage}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => updateStatus(t.id, 'active')}
                                                className="flex items-center gap-1 px-3 py-1 bg-white hover:bg-orange-100 border border-orange-200 text-orange-700 rounded-md text-xs font-medium shadow-sm"
                                            >
                                                <Play className="w-3 h-3" /> Riprendi
                                            </button>
                                            <button
                                                onClick={() => updateStatus(t.id, 'completed')}
                                                className="flex items-center gap-1 px-3 py-1 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 rounded-md text-xs font-medium"
                                            >
                                                <StopCircle className="w-3 h-3" /> Termina
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {endedTherapies.length > 0 && (
                <div className="pt-4 border-t border-gray-100">
                    <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Storico Terapie Concluse</h5>
                    <div className="space-y-2 opacity-60 hover:opacity-100 transition-opacity">
                        {endedTherapies.map(t => (
                            <div key={t.id} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-white/5 rounded-lg grayscale hover:grayscale-0 transition-all group">
                                <div>
                                    <span className="font-semibold text-gray-700 dark:text-gray-400 line-through decoration-gray-400">{t.drugName}</span>
                                    <div className="text-xs text-gray-500 dark:text-gray-500">
                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                        Terminato il {format(new Date((t as any).updatedAt || t.createdAt), 'dd/MM/yyyy', { locale: it })}
                                    </div>
                                </div>
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => updateStatus(t.id, 'active')}
                                        className="text-xs px-2 py-1 border border-indigo-200 bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100"
                                    >
                                        Prescrivi di nuovo
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
