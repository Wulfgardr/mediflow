'use client';

import { useState } from 'react';
import { useLiveQuery } from '@/lib/live-query';
import { ApiConflictError, db, Therapy } from '@/lib/db';
import { notifyDbChange } from '@/lib/live-query';
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
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';

const therapySchema = z.object({
    drugName: z.string().min(2, "Il nome del farmaco è richiesto"),
    /* @Codex */
    aic: z.string().optional(),
    /* @Codex */
    atc: z.string().optional(),
    activePrinciple: z.string().optional(),
    dosage: z.string().min(1, "La posologia è richiesta"),
    motivation: z.string().optional(),
    status: z.enum(['active', 'suspended', 'completed']).default('active'),
});

type TherapyFormValues = z.infer<typeof therapySchema>;

const fieldLabelClassName = 'section-kicker flex items-center justify-between gap-2 text-[11px]';
const inputClassName = 'w-full rounded-[14px] border border-[color:rgba(15,23,42,0.12)] bg-white/88 px-3 py-2.5 text-sm text-[color:var(--mf-ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[color:rgba(100,116,139,0.58)] focus:border-[color:rgba(15,23,42,0.28)] focus:shadow-[0_0_0_4px_rgba(15,23,42,0.08)] read-only:bg-[color:rgba(248,250,252,0.72)] dark:border-white/10 dark:bg-white/5 dark:read-only:bg-white/4';
const textareaClassName = `${inputClassName} min-h-[88px] resize-y`;
const quietButtonClassName = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] border border-[color:rgba(15,23,42,0.12)] bg-white/88 px-3 text-xs font-semibold text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(15,23,42,0.26)] hover:bg-white dark:bg-white/6';
const statusButtonClassName = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] border border-[color:rgba(15,23,42,0.12)] bg-[color:rgba(248,250,252,0.82)] px-3 text-xs font-semibold text-[color:var(--mf-muted)] transition-colors hover:border-[color:rgba(15,23,42,0.24)] hover:text-[color:var(--mf-ink)] dark:bg-white/5';
const chipClassName = 'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors';

export default function TherapyManager({ patientId, embedded = false }: { patientId: string; embedded?: boolean }) {
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isGalenic, setIsGalenic] = useState(false); // Toggle for Free Text vs AIFA
    const [selectedDiagnosis, setSelectedDiagnosis] = useState<{ code: string; title: string } | null>(null);
    /* @Codex WUL-UIUX: protezione doppio submit e nome farmaco corrente in edit. */
    const [isSaving, setIsSaving] = useState(false);
    const [editingDrugName, setEditingDrugName] = useState('');
    const { showToast } = useToast();
    const confirm = useConfirm();

    const therapies = useLiveQuery(
        async () => {
            const items = await db.therapies.query({ patientId }).toArray();
            return items
                .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
        },
        [patientId],
        undefined,
        ['therapies'],
    );

    const patient = useLiveQuery(
        () => db.patients.get(patientId),
        [patientId],
        undefined,
        ['patients'],
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
        setEditingDrugName(therapy.drugName);
        setValue('drugName', therapy.drugName);
        /* @Codex */
        setValue('aic', therapy.aic || '');
        /* @Codex */
        setValue('atc', therapy.atc || '');
        setValue('activePrinciple', therapy.activePrinciple);
        setValue('dosage', therapy.dosage);
        setValue('motivation', therapy.motivation);
        if (therapy.diagnosisCode && therapy.diagnosisName) {
            setSelectedDiagnosis({ code: therapy.diagnosisCode, title: therapy.diagnosisName });
        } else {
            setSelectedDiagnosis(null);
        }
        setIsGalenic(!therapy.activePrinciple);
    };

    const cancelEditing = () => {
        setIsAdding(false);
        setEditingId(null);
        setEditingDrugName('');
        reset();
        setSelectedDiagnosis(null);
        setIsGalenic(false);
    };

    const onSubmit = async (data: TherapyFormValues) => {
        if (isSaving) return;
        setIsSaving(true);
        try {
            if (editingId) {
                const therapy = visibleTherapies.find((item) => item.id === editingId);
                if (!therapy || typeof therapy.version !== 'number') {
                    showToast({ tone: 'error', title: 'Versione terapia non disponibile', description: 'Ricarica la pagina e riprova.' });
                    return;
                }
                // UPDATE EXISTING
                await db.therapies.update(editingId, {
                    ...data,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    diagnosisCode: selectedDiagnosis?.code as any,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    diagnosisName: selectedDiagnosis?.title as any,
                    updatedAt: new Date(),
                    version: therapy.version,
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
                            diagnoses: [...currentDiagnoses, {
                                code: selectedDiagnosis.code,
                                description: selectedDiagnosis.title,
                                system: 'ICD-11',
                                date: new Date()
                            }] as any,
                            version: patient.version
                        });
                    }
                }
            }

            cancelEditing();
        } catch (error) {
            console.error("Failed to save therapy", error);
            if (error instanceof ApiConflictError) {
                notifyDbChange('therapies');
                showToast({ tone: 'error', title: 'Terapia aggiornata altrove', description: 'I dati sono stati ricaricati. Controlla e riprova.' });
                return;
            }
            showToast({ tone: 'error', title: 'Salvataggio terapia fallito', description: 'Controlla i dati e riprova.' });
        } finally {
            setIsSaving(false);
        }
    };

    const updateStatus = async (id: string, status: Therapy['status']) => {
        const therapy = visibleTherapies.find((item) => item.id === id);
        if (!therapy || typeof therapy.version !== 'number') {
            showToast({ tone: 'error', title: 'Versione terapia non disponibile', description: 'Ricarica la pagina e riprova.' });
            return;
        }
        const patch: { status: Therapy['status']; updatedAt: Date; endDate?: Date | null } = { status, updatedAt: new Date() };
        /* @Codex WUL-UIUX: endDate esiste in schema ma non veniva mai valorizzata;
           la conclusione la registra. Alla riattivazione va azzerata con null
           ESPLICITO: undefined verrebbe eliminato da JSON.stringify e il backend
           non lo cancellerebbe (la route pulisce endDate solo su null o ''). */
        if (status === 'completed') patch.endDate = new Date();
        if (status === 'active') patch.endDate = null;
        try {
            await db.therapies.update(id, { ...patch, version: therapy.version });
        } catch (error) {
            console.error('Failed to update therapy status', error);
            if (error instanceof ApiConflictError) {
                notifyDbChange('therapies');
                showToast({ tone: 'error', title: 'Terapia aggiornata altrove', description: 'I dati sono stati ricaricati. Controlla e riprova.' });
                return;
            }
            showToast({ tone: 'error', title: 'Aggiornamento terapia fallito' });
        }
    };

    const handleSoftDelete = async (id: string) => {
        const therapy = visibleTherapies.find((item) => item.id === id);
        if (!therapy || typeof therapy.version !== 'number') {
            showToast({ tone: 'error', title: 'Versione terapia non disponibile', description: 'Ricarica la pagina e riprova.' });
            return;
        }
        const { confirmed, reason } = await confirm({
            title: 'Eliminare questo farmaco dalla cartella?',
            message: 'Usa Elimina solo per errori di inserimento; per una terapia interrotta scegli Sospendi o Concludi.',
            confirmLabel: 'Elimina',
            tone: 'danger',
            requireReason: true,
            reasonLabel: 'Motivazione dell\'eliminazione',
            reasonPlaceholder: 'Es. inserimento duplicato',
        });
        if (!confirmed || !reason) return;
        try {
            await db.therapies.delete(id, { version: therapy.version, deletionReason: reason });
        } catch (error) {
            console.error('Failed to delete therapy', error);
            if (error instanceof ApiConflictError) {
                notifyDbChange('therapies');
                showToast({ tone: 'error', title: 'Terapia aggiornata altrove', description: 'I dati sono stati ricaricati. Controlla e riprova.' });
                return;
            }
            showToast({ tone: 'error', title: 'Eliminazione terapia fallita' });
        }
    };

    const newButton = !isAdding ? (
        <button
            onClick={() => setIsAdding(true)}
            className="ui-btn-primary inline-flex h-10 items-center gap-1.5 px-4 text-sm font-semibold"
        >
            <Plus className="w-4 h-4" />
            Nuova terapia
        </button>
    ) : null;

    return (
        <section className={embedded ? '' : 'patient-detail-section border p-5 md:p-6'}>
            {embedded ? (
                newButton ? <div className="mb-4 flex justify-end">{newButton}</div> : null
            ) : (
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className="section-kicker">Terapie</p>
                        <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-[color:var(--mf-ink)]">
                            <Pill className="h-5 w-5 text-[color:var(--mf-muted)]" />
                            Terapie farmacologiche
                        </h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--mf-muted)]">
                            Farmaci attivi, sospesi e conclusi restano nello stesso registro locale della cartella.
                        </p>
                    </div>
                    {newButton}
                </div>
            )}

            {isAdding && (
                <div className="mb-6 rounded-[18px] border border-[color:rgba(112,106,100,0.14)] bg-[color:rgba(255,255,255,0.72)] p-4 shadow-[0_18px_45px_rgba(54,45,38,0.06)] animate-in fade-in slide-in-from-top-4 dark:border-white/10 dark:bg-white/5 md:p-5">
                    <div className="mb-5 flex items-start justify-between gap-3 border-b border-[color:rgba(112,106,100,0.11)] pb-4 dark:border-white/10">
                        <div>
                            <p className="section-kicker">Registro terapia</p>
                            <h3 className="mt-1 text-lg font-semibold text-[color:var(--mf-ink)]">
                                {editingId ? 'Modifica terapia' : 'Nuova terapia'}
                            </h3>
                        </div>
                        <button
                            type="button"
                            onClick={cancelEditing}
                            aria-label="Chiudi scheda terapia"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:rgba(112,106,100,0.14)] bg-white/86 text-[color:var(--mf-muted)] transition-colors hover:text-[color:var(--mf-ink)] dark:bg-white/6"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="mb-4">
                        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[13px] border border-[color:rgba(112,106,100,0.14)] bg-white/76 px-3 text-sm font-semibold text-[color:var(--mf-ink)] dark:border-white/10 dark:bg-white/5">
                            <input
                                type="checkbox"
                                checked={isGalenic}
                                onChange={(e) => {
                                    const next = e.target.checked;
                                    setIsGalenic(next);
                                    if (next) {
                                        /* @Codex */
                                        setValue('aic', '');
                                        /* @Codex */
                                        setValue('atc', '');
                                    }
                                }}
                                className="h-4 w-4 rounded border-[color:rgba(15,23,42,0.22)] text-[color:var(--mf-ink)] focus:ring-[color:rgba(15,23,42,0.16)]"
                            />
                            <Beaker className="w-4 h-4" />
                            Farmaco manuale o galenico
                        </label>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className={fieldLabelClassName}>
                                    <span>Farmaco</span>
                                    {!isGalenic && <span className="inline-flex items-center gap-1 text-[10px] text-[color:var(--mf-muted)]"><Database className="w-3 h-3" /> Banca dati AIFA</span>}
                                </label>

                                {isGalenic ? (
                                    <input {...register('drugName')} className={inputClassName} placeholder="Es. preparazione magistrale..." />
                                ) : (
                                    <div className="relative">
                                        <DrugAutocomplete
                                            /* @Codex WUL-UIUX: key legata alla riga in modifica: passando da
                                               una terapia all'altra con form aperto, React rimonta il combobox
                                               e rilegge defaultValue (query e useState(defaultValue), letto solo
                                               al mount) evitando di mostrare il farmaco della terapia precedente. */
                                            key={editingId ?? 'new'}
                                            onSelect={(drug: AifaDrug) => {
                                                setValue('drugName', drug.name);
                                                /* @Codex */
                                                setValue('aic', drug.aic);
                                                /* @Codex */
                                                setValue('atc', drug.atc || '');
                                                setValue('activePrinciple', drug.activePrinciple);
                                            }}
                                            placeholder="Cerca per nome o principio attivo..."
                                            autoFocus
                                            defaultValue={editingDrugName || undefined}
                                        />
                                        {/* Hidden input to bind react-hook-form validation */}
                                        <input type="hidden" {...register('drugName')} />
                                    </div>
                                )}

                                {errors.drugName && <p className="text-xs text-red-500">{errors.drugName.message}</p>}
                            </div>
                            <div className="space-y-1">
                                <label className={fieldLabelClassName}>Principio attivo</label>
                                <input {...register('activePrinciple')} className={inputClassName} placeholder="Es. Furosemide" readOnly={!isGalenic} />
                            </div>
                            <div className="col-span-full space-y-1">
                                <label className={fieldLabelClassName}>Posologia</label>
                                <input {...register('dosage')} className={inputClassName} placeholder="Es. 1 cp ore 8:00, 1/2 cp ore 20:00" />
                                {errors.dosage && <p className="text-xs text-red-500">{errors.dosage.message}</p>}
                            </div>
                            <div className="col-span-full space-y-1">
                                <label className={fieldLabelClassName}>Indicazione o nota clinica</label>
                                <textarea {...register('motivation')} className={textareaClassName} placeholder="Es. scompenso cardiaco, dolore cronico, prevenzione..." />
                            </div>

                            <div className="col-span-full space-y-1">
                                <label className={fieldLabelClassName}>Collegamento clinico</label>

                                {/* Quick Suggestions */}
                                {patient && (
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {patient.diagnoses?.map(d => (
                                            <button
                                                key={d.code}
                                                type="button"
                                                onClick={() => setSelectedDiagnosis({ code: d.code, title: d.description })}
                                                className={`${chipClassName} ${selectedDiagnosis?.code === d.code ? 'border-[color:rgba(15,23,42,0.22)] bg-[color:rgba(248,250,252,0.96)] text-[color:var(--mf-ink)]' : 'border-[color:rgba(15,23,42,0.12)] bg-white/82 text-[color:var(--mf-muted)] hover:text-[color:var(--mf-ink)] dark:bg-white/5'}`}
                                            >
                                                {d.description}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setSelectedDiagnosis({ code: 'PREV', title: 'Prevenzione' })}
                                            className={`${chipClassName} ${selectedDiagnosis?.code === 'PREV' ? 'border-[color:rgba(15,23,42,0.22)] bg-[color:rgba(248,250,252,0.96)] text-[color:var(--mf-ink)]' : 'border-[color:rgba(15,23,42,0.12)] bg-white/82 text-[color:var(--mf-muted)] hover:bg-[color:rgba(248,250,252,0.86)] hover:text-[color:var(--mf-ink)] dark:bg-white/5'}`}
                                        >
                                            <Shield className="w-3 h-3" /> Prevenzione
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedDiagnosis(null)}
                                            className={`${chipClassName} ${!selectedDiagnosis ? 'border-[color:rgba(15,23,42,0.20)] bg-[color:rgba(248,250,252,0.96)] text-[color:var(--mf-ink)]' : 'border-[color:rgba(15,23,42,0.12)] bg-white/82 text-[color:var(--mf-muted)] hover:text-[color:var(--mf-ink)] dark:bg-white/5'}`}
                                        >
                                            <Ban className="w-3 h-3" /> Nessuna
                                        </button>
                                    </div>
                                )}

                                <ICDAutocomplete
                                    onSelect={(code, title) => setSelectedDiagnosis({ code, title })}
                                    initialValue={selectedDiagnosis}
                                />
                                <p className="text-xs leading-5 text-[color:var(--mf-muted)]">
                                    {selectedDiagnosis?.code === 'PREV'
                                        ? 'Indicazione: prevenzione.'
                                        : (selectedDiagnosis ? 'La diagnosi selezionata viene mantenuta come contesto della terapia.' : 'Opzionale: collega una diagnosi o lascia la terapia senza indicazione codificata.')}
                                </p>
                            </div>
                        </div>
                        {/* @Codex */}
                        <input type="hidden" {...register('aic')} />
                        {/* @Codex */}
                        <input type="hidden" {...register('atc')} />
                        <div className="flex justify-end pt-2 gap-2">
                            <button type="button" onClick={cancelEditing} className={quietButtonClassName}>Annulla</button>
                            <button type="submit" disabled={isSaving} className="ui-btn-primary inline-flex h-10 items-center gap-1.5 px-4 text-sm font-semibold disabled:opacity-50">
                                {isSaving ? 'Salvataggio...' : editingId ? 'Aggiorna terapia' : 'Salva terapia'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="space-y-4">
                {therapies === undefined ? (
                    <div className="space-y-2" aria-hidden>
                        {[0, 1, 2].map((row) => (
                            <div key={row} className="mf-skeleton h-20" />
                        ))}
                    </div>
                ) : activeTherapies.length === 0 && suspendedTherapies.length === 0 ? (
                    <div className="rounded-[18px] border border-dashed border-[color:rgba(15,23,42,0.16)] bg-[color:rgba(248,250,252,0.64)] p-8 text-center dark:border-white/12 dark:bg-white/5">
                        <p className="text-sm leading-6 text-[color:var(--mf-muted)]">
                            Nessuna terapia attiva registrata. Aggiungi una terapia quando serve tenere traccia di farmaco e posologia.
                        </p>
                    </div>
                ) : (
                    <>
                        {activeTherapies.length > 0 && (
                            <h5 className="section-kicker flex items-center gap-2">
                                <span className="inline-block h-2 w-2 rounded-full bg-[color:var(--mf-success)]" aria-hidden />
                                Terapie attive · {activeTherapies.length}
                            </h5>
                        )}
                        {/* ACTIVE */}
                        {activeTherapies.map(t => (
                            <div key={t.id} className="flex flex-col items-start justify-between gap-4 rounded-[18px] border border-[color:rgba(112,106,100,0.13)] bg-white/86 p-4 shadow-[0_18px_45px_rgba(54,45,38,0.05)] dark:border-white/10 dark:bg-white/5 sm:flex-row">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="text-base font-semibold text-[color:var(--mf-ink)]">{t.drugName}</h4>
                                        <span className="inline-flex items-center gap-1 rounded-full bg-[color:rgba(45,122,90,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--mf-success)]">
                                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--mf-success)]" aria-hidden />
                                            Attiva
                                        </span>
                                        {t.activePrinciple && <span className="rounded-full bg-[color:rgba(248,250,252,0.92)] px-2 py-0.5 text-xs font-medium text-[color:var(--mf-muted)] dark:bg-white/10">{t.activePrinciple}</span>}
                                    </div>
                                    <p className="text-[color:var(--mf-ink)] dark:text-slate-100 font-medium mt-1">{t.dosage}</p>
                                    {t.startDate && (
                                        <p className="mt-0.5 text-xs text-[color:var(--mf-muted)]">
                                            In corso dal {format(new Date(t.startDate), 'dd/MM/yyyy', { locale: it })}
                                        </p>
                                    )}

                                    {t.diagnosisCode && (
                                        <div className="mt-1 flex items-center gap-1.5">
                                            <span className="rounded border border-[color:rgba(15,23,42,0.12)] bg-[color:rgba(248,250,252,0.72)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--mf-muted)] dark:border-white/10 dark:bg-white/5">
                                                {t.diagnosisCode}
                                            </span>
                                            <span className="max-w-[220px] truncate text-xs text-[color:var(--mf-muted)]" title={t.diagnosisName}>
                                                {t.diagnosisName}
                                            </span>
                                        </div>
                                    )}

                                    {t.motivation && <p className="mt-2 text-sm leading-6 text-[color:var(--mf-muted)]">{t.motivation}</p>}

                                    {(t.atc || t.aic) && (
                                        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] font-mono uppercase tracking-wide text-[color:rgba(112,106,100,0.72)]">
                                            {t.atc ? <span>ATC {t.atc}</span> : null}
                                            {t.aic ? <span>AIC {t.aic}</span> : null}
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        onClick={() => startEditing(t)}
                                        className={quietButtonClassName}
                                        title="Modifica terapia"
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                        Modifica
                                    </button>

                                    <button
                                        onClick={() => updateStatus(t.id, 'suspended')}
                                        className={statusButtonClassName}
                                        title="Sospendi temporaneamente"
                                    >
                                        <Clock className="w-3.5 h-3.5" />
                                        Sospendi
                                    </button>

                                    <button
                                        onClick={() => updateStatus(t.id, 'completed')}
                                        className={statusButtonClassName}
                                        title="Termina terapia"
                                    >
                                        <StopCircle className="w-3.5 h-3.5" />
                                        Concludi
                                    </button>

                                    <button
                                        onClick={() => handleSoftDelete(t.id)}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-[11px] text-[color:rgba(112,106,100,0.46)] transition-colors hover:bg-red-50 hover:text-red-600"
                                        title="Elimina solo se inserito per errore"
                                        aria-label={`Elimina ${t.drugName} solo se inserito per errore`}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}

                        {/* SUSPENDED */}
                        {suspendedTherapies.length > 0 && (
                            <div className="space-y-2 mt-4">
                                <h5 className="section-kicker mb-2 flex items-center gap-2">
                                    <Clock className="w-3 h-3" /> Terapie sospese
                                </h5>
                                {suspendedTherapies.map(t => (
                                    <div key={t.id} className="flex flex-col items-start justify-between gap-3 rounded-[16px] border border-[color:rgba(15,23,42,0.12)] bg-[color:rgba(248,250,252,0.78)] p-3 dark:border-white/10 dark:bg-white/5 sm:flex-row sm:items-center">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-[color:var(--mf-ink)]">{t.drugName}</span>
                                                <span className="rounded-full bg-white/78 px-2 py-0.5 text-xs font-semibold text-[color:var(--mf-muted)] dark:bg-white/10">Sospesa</span>
                                            </div>
                                            <p className="mt-0.5 text-xs text-[color:var(--mf-muted)]">{t.dosage}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => updateStatus(t.id, 'active')}
                                                className={quietButtonClassName}
                                            >
                                                <Play className="w-3 h-3" /> Riprendi
                                            </button>
                                            <button
                                                onClick={() => updateStatus(t.id, 'completed')}
                                                className={statusButtonClassName}
                                            >
                                                <StopCircle className="w-3 h-3" /> Concludi
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
                <div className="mt-6 border-t border-[color:rgba(112,106,100,0.11)] pt-4 dark:border-white/10">
                    <h5 className="section-kicker mb-3">Terapie concluse</h5>
                    <div className="space-y-2">
                        {endedTherapies.map(t => (
                            <div key={t.id} className="group flex items-center justify-between gap-3 rounded-[16px] border border-[color:rgba(15,23,42,0.10)] bg-[color:rgba(248,250,252,0.62)] p-3 dark:border-white/10 dark:bg-white/5">
                                <div>
                                    <span className="font-semibold text-[color:var(--mf-muted)] line-through decoration-[color:rgba(112,106,100,0.42)]">{t.drugName}</span>
                                    <div className="text-xs text-[color:var(--mf-muted)]">
                                        Conclusa il {format(new Date(t.endDate || t.updatedAt || t.createdAt), 'dd/MM/yyyy', { locale: it })}
                                    </div>
                                </div>
                                <div className="flex gap-2 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                                    <button
                                        onClick={() => updateStatus(t.id, 'active')}
                                        className={quietButtonClassName}
                                    >
                                        Riattiva
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
}
