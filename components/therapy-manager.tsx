'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createTherapyDeleteRecovery, type DeleteRecovery } from '@/lib/therapy-delete-recovery';
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
import { useRuntimeTwinPendingForm } from '@/components/runtime-twin-design';

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
type TherapyDraft = { patientId: string; id: string; version?: number; editing: boolean };
type TherapyRecovery = {
    title: string;
    message: string;
    current?: Therapy | null;
    readComplete?: boolean;
};

const fieldLabelClassName = 'section-kicker flex items-center justify-between gap-2 text-[11px]';
const inputClassName = 'w-full rounded-[14px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-3 py-2.5 text-sm text-[color:var(--lume-ink)] outline-none transition-colors placeholder:text-[color:var(--lume-ink-muted)] focus-visible:border-[color:color-mix(in_srgb,var(--lume-ink)_28%,transparent)] focus-visible:shadow-[var(--lume-focus-ring)] read-only:bg-[color:var(--lume-surface-focal)]';
const textareaClassName = `${inputClassName} min-h-[88px] resize-y`;
const quietButtonClassName = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] px-3 text-xs font-semibold text-[color:var(--lume-ink)] transition-colors hover:border-[color:color-mix(in_srgb,var(--lume-ink)_26%,transparent)] hover:bg-[color:var(--lume-surface-focal)]';
const recoveryButtonClassName = `${quietButtonClassName.replace('h-9', 'min-h-11')} whitespace-normal py-2 text-left`;
const statusButtonClassName = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-[11px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-focal)] px-3 text-xs font-semibold text-[color:var(--lume-ink-muted)] transition-colors hover:border-[color:color-mix(in_srgb,var(--lume-ink)_24%,transparent)] hover:text-[color:var(--lume-ink)]';
const chipClassName = 'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors';

export default function TherapyManager({ patientId, embedded = false }: { patientId: string; embedded?: boolean }) {
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isGalenic, setIsGalenic] = useState(false); // Toggle for Free Text vs AIFA
    const [selectedDiagnosis, setSelectedDiagnosis] = useState<{ code: string; title: string } | null>(null);
    /* @Codex WUL-UIUX: protezione doppio submit e nome farmaco corrente in edit. */
    const [isSaving, setIsSaving] = useState(false);
    const saving = useRef(false);
    const [editingDrugName, setEditingDrugName] = useState('');
    const [draft, setDraft] = useState<TherapyDraft | null>(null);
    const activeDraft = useRef<TherapyDraft | null>(null);
    const currentPatientId = useRef(patientId);
    const [recovery, setRecovery] = useState<TherapyRecovery | null>(null);
    const [isReading, setIsReading] = useState(false);
    const recoveryRef = useRef<HTMLDivElement>(null);
    useEffect(() => { currentPatientId.current = patientId; }, [patientId]);
    useEffect(() => () => { activeDraft.current = null; }, []);
    useEffect(() => { if (recovery) recoveryRef.current?.focus(); }, [recovery]);
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [deleteState, setDeleteState] = useState<{
        owner: ReturnType<typeof createTherapyDeleteRecovery<Therapy>>;
        value: DeleteRecovery<Therapy> | null;
    } | null>(null);
    const deleteRef = useRef<HTMLDivElement>(null);
    const statusWriting = useRef(false);
    const deletion = useMemo(() => {
        const controller = createTherapyDeleteRecovery<Therapy>({
            patientId,
            isCurrent: () => currentPatientId.current === patientId,
            signal: () => db.getSessionReadSignal(),
            readParent: (id, signal) => db.patients.get(id, { signal }),
            readTherapies: (id, signal) => db.therapies.query({ patientId: id }).toArray({ signal, rejectAuthUnavailable: true }),
            remove: (id, options) => db.therapies.delete(id, { ...options, suppressNotify: true }),
            isConflict: (error) => error instanceof ApiConflictError,
            changed: (value) => setDeleteState({ owner: controller, value }),
            succeeded: () => notifyDbChange('therapies'),
        });
        return controller;
    }, [patientId]);
    useLayoutEffect(() => {
        currentPatientId.current = patientId;
        deletion.activate();
        return () => deletion.dispose();
    }, [deletion, patientId]);
    const deleteRecovery = deleteState?.owner === deletion ? deleteState.value : null;
    const deleteBusy = !!deleteRecovery && ['prompt', 'writing', 'reading', 'confirming'].includes(deleteRecovery.phase);
    useRuntimeTwinPendingForm(isAdding || !!deleteRecovery);
    useEffect(() => { if (deleteRecovery && !deleteBusy) deleteRef.current?.focus(); }, [deleteRecovery, deleteBusy]);

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
        if (deletion.blocked || statusWriting.current || isSaving || isReading || therapy.patientId !== patientId) return;
        const context = { patientId, id: therapy.id, version: therapy.version, editing: true };
        activeDraft.current = context;
        setDraft(context);
        setRecovery(null);
        setEditingId(therapy.id);
        setIsAdding(true);
        setEditingDrugName(therapy.drugName);
        setValue('drugName', therapy.drugName);
        /* @Codex */
        setValue('aic', therapy.aic || '');
        /* @Codex */
        setValue('atc', therapy.atc || '');
        setValue('activePrinciple', therapy.activePrinciple || '');
        setValue('dosage', therapy.dosage);
        setValue('motivation', therapy.motivation || '');
        if (therapy.diagnosisCode && therapy.diagnosisName) {
            setSelectedDiagnosis({ code: therapy.diagnosisCode, title: therapy.diagnosisName });
        } else {
            setSelectedDiagnosis(null);
        }
        setIsGalenic(!therapy.activePrinciple);
    };

    const cancelEditing = () => {
        activeDraft.current = null;
        setDraft(null);
        setRecovery(null);
        setIsAdding(false);
        setEditingId(null);
        setEditingDrugName('');
        reset();
        setSelectedDiagnosis(null);
        setIsGalenic(false);
    };

    const startAdding = () => {
        if (deletion.blocked || statusWriting.current || saving.current || isReading) return;
        cancelEditing();
        const context = { patientId, id: uuidv4(), editing: false };
        activeDraft.current = context;
        setDraft(context);
        setIsAdding(true);
    };

    const isCurrentDraft = (context: TherapyDraft) => activeDraft.current === context
        && currentPatientId.current === context.patientId;

    const rereadTherapy = async () => {
        const context = activeDraft.current;
        if (!context || context.patientId !== patientId || isSaving || isReading) return;
        setIsReading(true);
        try {
            // The facade returns [] on expired auth. Require an authenticated
            // parent and keep both completions inside the same live session.
            const signal = db.getSessionReadSignal();
            signal.throwIfAborted();
            const [items, parent] = await Promise.all([
                db.therapies.query({ patientId: context.patientId }).toArray(),
                db.patients.get(context.patientId, { signal }),
            ]);
            signal.throwIfAborted();
            if (!isCurrentDraft(context)) return;
            const current = items.find(item => item.id === context.id) ?? null;
            if (!parent || parent.id !== context.patientId
                || (current && (current.patientId !== context.patientId || !Number.isSafeInteger(current.version) || (current.version ?? 0) < 1))) {
                throw new Error('Therapy read unavailable');
            }
            setRecovery({
                title: 'Dati riletti dalla cartella',
                message: current
                    ? context.editing
                        ? 'Confronta questi dati con la bozza conservata prima di salvare di nuovo.'
                        : 'La terapia risulta già registrata. Controlla i dati e chiudi la bozza; non verrà inserita di nuovo. Se avevi collegato una diagnosi, controllala nella scheda del paziente.'
                    : context.editing
                        ? 'La terapia non è disponibile nella cartella. La bozza è conservata; verifica il paziente e la terapia prima di continuare.'
                        : 'La terapia non compare nella cartella. La bozza è conservata: puoi autorizzare un nuovo tentativo dopo questa verifica.',
                current, readComplete: true,
            });
            notifyDbChange('therapies');
        } catch {
            if (isCurrentDraft(context)) setRecovery({
                title: 'Rilettura non riuscita',
                message: 'La bozza è conservata. Il salvataggio resta bloccato: riprova a rileggere la cartella prima di continuare.',
            });
        } finally {
            if (isCurrentDraft(context)) setIsReading(false);
        }
    };

    const keepReviewedDraft = () => {
        if (!draft || draft.patientId !== patientId || isReading || !recovery?.readComplete) return;
        if (draft.editing && !recovery.current) return;
        if (!draft.editing && recovery.current) return;
        const context = { ...draft, version: recovery.current?.version };
        activeDraft.current = context;
        setDraft(context);
        setRecovery(null);
        document.getElementById(`therapy-dosage-${patientId}`)?.focus();
    };

    const onSubmit = async (data: TherapyFormValues) => {
        const context = activeDraft.current;
        if (deletion.blocked || statusWriting.current || saving.current || recovery || !context || context.patientId !== patientId) return;
        saving.current = true;
        setIsSaving(true);
        let therapyCreated = false;
        try {
            if (context.editing) {
                if (typeof context.version !== 'number') {
                    setRecovery({ title: 'Versione terapia non disponibile', message: 'La bozza è conservata. Rileggi la terapia e confronta i dati prima di salvare.' });
                    return;
                }
                // UPDATE EXISTING
                await db.therapies.update(context.id, {
                    ...data,
                    // Status is edited by the separate explicit row actions.
                    // The form must not restore its implicit 'active' default.
                    status: undefined,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    diagnosisCode: selectedDiagnosis?.code as any,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    diagnosisName: selectedDiagnosis?.title as any,
                    updatedAt: new Date(),
                    version: context.version,
                });
            } else {
                // CREATE NEW
                await db.therapies.add({
                    id: context.id,
                    patientId: context.patientId,
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
                therapyCreated = true;
                if (!isCurrentDraft(context)) return;

                if (selectedDiagnosis?.code &&
                    selectedDiagnosis.code !== 'PREV' &&
                    selectedDiagnosis.code !== 'NONE' &&
                    patient && patient.id === context.patientId) {

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const exists = (patient as any).diagnoses?.some((d: any) => d.code === selectedDiagnosis.code);

                    if (!exists) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const currentDiagnoses = (patient as any).diagnoses || [];
                        await db.patients.update(context.patientId, {
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

            if (isCurrentDraft(context)) cancelEditing();
        } catch (error) {
            if (!isCurrentDraft(context)) return;
            setRecovery(therapyCreated ? {
                title: 'Terapia registrata; diagnosi non confermata',
                message: 'La terapia è stata salvata, ma il collegamento della diagnosi nella scheda del paziente non è confermato. La bozza è conservata: rileggi la terapia e controlla la diagnosi nella scheda prima di chiudere.',
            } : error instanceof ApiConflictError ? {
                title: 'Terapia aggiornata altrove',
                message: 'Queste modifiche non sono state salvate. La bozza è conservata: rileggi la terapia e confronta i dati prima di un nuovo salvataggio.',
            } : {
                title: 'Esito del salvataggio non confermato',
                message: 'La richiesta potrebbe essere stata registrata. La bozza è conservata: rileggi la terapia prima di decidere come continuare.',
            });
        } finally {
            saving.current = false;
            setIsSaving(false);
        }
    };

    const updateStatus = async (id: string, status: Therapy['status']) => {
        if (deletion.blocked || statusWriting.current || saving.current || isReading) return;
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
        statusWriting.current = true;
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
        } finally {
            statusWriting.current = false;
        }
    };

    const handleSoftDelete = async (id: string) => {
        if (deletion.blocked || statusWriting.current || saving.current || isReading || isAdding) return;
        const therapy = visibleTherapies.find((item) => item.id === id);
        if (!therapy || therapy.patientId !== patientId || !Number.isSafeInteger(therapy.version) || (therapy.version ?? 0) < 1) {
            showToast({ tone: 'error', title: 'Versione terapia non disponibile', description: 'Ricarica la pagina e riprova.' });
            return;
        }
        await deletion.begin(therapy, () => confirm({
            title: 'Eliminare questo farmaco dalla cartella?',
            message: 'Usa Elimina solo per errori di inserimento; per una terapia interrotta scegli Sospendi o Concludi.',
            confirmLabel: 'Elimina',
            tone: 'danger',
            requireReason: true,
            reasonLabel: "Motivazione dell'eliminazione",
            reasonPlaceholder: 'Es. inserimento duplicato',
        }));
    };

    const newButton = !isAdding ? (
        <button
            onClick={startAdding}
            disabled={!!deleteRecovery}
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
                        <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-[color:var(--lume-ink)]">
                            <Pill className="h-5 w-5 text-[color:var(--lume-ink-muted)]" />
                            Terapie farmacologiche
                        </h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                            Farmaci attivi, sospesi e conclusi restano nello stesso registro locale della cartella.
                        </p>
                    </div>
                    {newButton}
                </div>
            )}

            {deleteRecovery && deleteRecovery.phase !== 'prompt' && (
                <div ref={deleteRef} role="alert" aria-atomic="true" aria-label="Recupero eliminazione terapia" tabIndex={-1} className="mb-6 rounded-[14px] border border-[color:var(--lume-signal-critical)] p-4 text-sm leading-6 focus-visible:shadow-[var(--lume-focus-ring)]">
                    <p className="font-semibold">{deleteRecovery.phase === 'conflict' ? 'Eliminazione rifiutata: terapia aggiornata altrove' : 'Eliminazione da verificare'}</p>
                    <p>{deleteRecovery.phase === 'conflict'
                        ? 'La richiesta è stata rifiutata. La motivazione è conservata: rileggi la terapia e confronta i dati prima di decidere.'
                        : deleteRecovery.phase === 'ready'
                            ? 'Terapia riletta. Confronta i dati attuali prima di decidere. Un nuovo invio richiede una motivazione e la tua conferma.'
                            : deleteRecovery.phase === 'absent'
                                ? 'La terapia non compare nella cartella. Questo non conferma che la richiesta di eliminazione sia riuscita. Non puoi inviarla di nuovo; verifica la cartella.'
                                : deleteRecovery.phase === 'unavailable'
                                    ? 'Verifica non riuscita, dati non leggibili o sessione non più valida. Un nuovo invio resta bloccato finché la rilettura non riesce.'
                                    : deleteRecovery.phase === 'writing' ? 'Invio dell’eliminazione in corso…'
                                        : deleteRecovery.phase === 'reading' ? 'Rilettura della cartella in corso…'
                                            : 'L’esito non è confermato: la richiesta potrebbe essere stata registrata. Rileggi la terapia prima di continuare.'}</p>
                    <p className="mt-3 break-words">{deleteRecovery.reason
                        ? <><strong>Motivazione conservata:</strong> {deleteRecovery.reason}</>
                        : 'La motivazione precedente è stata scartata. Dopo la rilettura, un nuovo invio richiede una nuova motivazione.'}</p>
                    <div className="my-3 grid gap-3 md:grid-cols-2">
                        {[{ title: 'Terapia prima della richiesta', therapy: deleteRecovery.original }, ...(deleteRecovery.current ? [{ title: 'Terapia attualmente registrata', therapy: deleteRecovery.current }] : [])].map(({ title, therapy }) => (
                            <div key={title} className="space-y-1 break-words" aria-label={title}>
                                <p className="font-semibold">{title}</p>
                                <p><strong>Farmaco:</strong> {therapy.drugName}</p>
                                <p><strong>Principio attivo:</strong> {therapy.activePrinciple || 'Non indicato'}</p>
                                {therapy.aic && <p><strong>Codice AIC:</strong> {therapy.aic}</p>}
                                <p><strong>Posologia:</strong> {therapy.dosage}</p>
                                <p><strong>Stato:</strong> {therapy.status === 'active' ? 'Attiva' : therapy.status === 'suspended' ? 'Sospesa' : 'Conclusa'}</p>
                                <p><strong>Indicazione o nota:</strong> {therapy.motivation || 'Non indicata'}</p>
                                <p><strong>Diagnosi:</strong> {therapy.diagnosisName || 'Non collegata'}</p>
                            </div>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={deleteBusy} onClick={() => deletion.reread()} className={recoveryButtonClassName}>Rileggi terapia</button>
                        {deleteRecovery.phase === 'ready' && (
                            <button type="button" onClick={() => deletion.retry(() => confirm({
                                title: 'Confermi l’eliminazione della terapia riletta?',
                                message: deleteRecovery.reason
                                    ? 'Hai confrontato i dati attuali. Il nuovo invio userà la motivazione conservata e riguarderà la terapia appena riletta.'
                                    : 'Hai confrontato i dati attuali. Indica una nuova motivazione per eliminare la terapia appena riletta.',
                                confirmLabel: 'Conferma nuovo invio', tone: 'danger',
                                requireReason: !deleteRecovery.reason,
                                reasonLabel: "Motivazione dell'eliminazione",
                                reasonPlaceholder: 'Es. inserimento duplicato',
                            }))} className={recoveryButtonClassName}>{deleteRecovery.reason
                                ? 'Ho confrontato i dati: elimina con questa motivazione'
                                : 'Ho confrontato i dati: indica una nuova motivazione'}</button>
                        )}
                        <button type="button" disabled={deleteBusy} onClick={() => deletion.cancel()} className={recoveryButtonClassName}>Annulla recupero e scarta la motivazione</button>
                    </div>
                    <p className="mt-2">Annullare il recupero elimina solo la motivazione conservata in questa vista; non annulla un’eventuale eliminazione già registrata.</p>
                </div>
            )}

            {isAdding && (
                <div className="mb-6 rounded-[18px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-4 shadow-[var(--lume-shadow-focal)] animate-in fade-in slide-in-from-top-4 md:p-5">
                    <div className="mb-5 flex items-start justify-between gap-3 border-b border-[color:color-mix(in_srgb,var(--lume-ink)_11%,transparent)] pb-4">
                        <div>
                            <p className="section-kicker">Registro terapia</p>
                            <h3 className="mt-1 text-lg font-semibold text-[color:var(--lume-ink)]">
                                {editingId ? 'Modifica terapia' : 'Nuova terapia'}
                            </h3>
                        </div>
                        <button
                            type="button"
                            onClick={cancelEditing}
                            disabled={isSaving || isReading}
                            aria-label="Chiudi scheda terapia"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)] transition-colors hover:text-[color:var(--lume-ink)]"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="mb-4">
                        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[13px] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] px-3 text-sm font-semibold text-[color:var(--lume-ink)]">
                            <input
                                type="checkbox"
                                disabled={isSaving}
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
                                className="h-4 w-4 rounded border-[color:color-mix(in_srgb,var(--lume-ink)_22%,transparent)] text-[color:var(--lume-ink)] focus:ring-[color:color-mix(in_srgb,var(--lume-ink)_16%,transparent)]"
                            />
                            <Beaker className="w-4 h-4" />
                            Farmaco manuale o galenico
                        </label>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        {draft?.patientId !== patientId && (
                            <p role="alert">Questa bozza appartiene a un altro paziente. Torna alla sua cartella prima di continuare.</p>
                        )}
                        <fieldset disabled={isSaving} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className={fieldLabelClassName}>
                                    <span>Farmaco</span>
                                    {!isGalenic && <span className="inline-flex items-center gap-1 text-[10px] text-[color:var(--lume-ink-muted)]"><Database className="w-3 h-3" /> Banca dati AIFA</span>}
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

                                {errors.drugName && <p className="text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">{errors.drugName.message}</p>}
                            </div>
                            <div className="space-y-1">
                                <label className={fieldLabelClassName}>Principio attivo</label>
                                <input {...register('activePrinciple')} className={inputClassName} placeholder="Es. Furosemide" readOnly={!isGalenic} />
                            </div>
                            <div className="col-span-full space-y-1">
                                <label htmlFor={`therapy-dosage-${patientId}`} className={fieldLabelClassName}>Posologia</label>
                                <input id={`therapy-dosage-${patientId}`} {...register('dosage')} className={inputClassName} placeholder="Es. 1 cp ore 8:00, 1/2 cp ore 20:00" />
                                {errors.dosage && <p className="text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">{errors.dosage.message}</p>}
                            </div>
                            <div className="col-span-full space-y-1">
                                <label htmlFor={`therapy-motivation-${patientId}`} className={fieldLabelClassName}>Indicazione o nota clinica</label>
                                <textarea id={`therapy-motivation-${patientId}`} {...register('motivation')} className={textareaClassName} placeholder="Es. scompenso cardiaco, dolore cronico, prevenzione..." />
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
                                                className={`${chipClassName} ${selectedDiagnosis?.code === d.code ? 'border-[color:color-mix(in_srgb,var(--lume-ink)_22%,transparent)] bg-[color:var(--lume-surface-focal)] text-[color:var(--lume-ink)]' : 'border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)] hover:text-[color:var(--lume-ink)]'}`}
                                            >
                                                {d.description}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setSelectedDiagnosis({ code: 'PREV', title: 'Prevenzione' })}
                                            className={`${chipClassName} ${selectedDiagnosis?.code === 'PREV' ? 'border-[color:color-mix(in_srgb,var(--lume-ink)_22%,transparent)] bg-[color:var(--lume-surface-focal)] text-[color:var(--lume-ink)]' : 'border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)] hover:bg-[color:var(--lume-surface-focal)] hover:text-[color:var(--lume-ink)]'}`}
                                        >
                                            <Shield className="w-3 h-3" /> Prevenzione
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedDiagnosis(null)}
                                            className={`${chipClassName} ${!selectedDiagnosis ? 'border-[color:color-mix(in_srgb,var(--lume-ink)_20%,transparent)] bg-[color:var(--lume-surface-focal)] text-[color:var(--lume-ink)]' : 'border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] text-[color:var(--lume-ink-muted)] hover:text-[color:var(--lume-ink)]'}`}
                                        >
                                            <Ban className="w-3 h-3" /> Nessuna
                                        </button>
                                    </div>
                                )}

                                <ICDAutocomplete
                                    onSelect={(code, title) => setSelectedDiagnosis({ code, title })}
                                    initialValue={selectedDiagnosis}
                                />
                                <p className="text-xs leading-5 text-[color:var(--lume-ink-muted)]">
                                    {selectedDiagnosis?.code === 'PREV'
                                        ? 'Indicazione: prevenzione.'
                                        : (selectedDiagnosis ? 'La diagnosi selezionata viene mantenuta come contesto della terapia.' : 'Opzionale: collega una diagnosi o lascia la terapia senza indicazione codificata.')}
                                </p>
                            </div>
                        </fieldset>
                        {/* @Codex */}
                        <input type="hidden" {...register('aic')} />
                        {/* @Codex */}
                        <input type="hidden" {...register('atc')} />
                        {recovery && (
                            <div ref={recoveryRef} role="alert" aria-atomic="true" tabIndex={-1} className="rounded-[14px] border border-[color:var(--lume-signal-critical)] p-4 text-sm leading-6 focus-visible:shadow-[var(--lume-focus-ring)]">
                                <p className="font-semibold">{recovery.title}</p>
                                <p>{recovery.message}</p>
                                {recovery.current && (
                                    <div className="my-3 space-y-1 break-words" aria-label="Terapia attualmente registrata">
                                        <p><strong>Farmaco:</strong> {recovery.current.drugName}</p>
                                        <p><strong>Principio attivo:</strong> {recovery.current.activePrinciple || 'Non indicato'}</p>
                                        {recovery.current.aic && <p><strong>Codice AIC:</strong> {recovery.current.aic}</p>}
                                        <p><strong>Posologia:</strong> {recovery.current.dosage}</p>
                                        <p><strong>Stato:</strong> {recovery.current.status === 'active' ? 'Attiva' : recovery.current.status === 'suspended' ? 'Sospesa' : 'Conclusa'}</p>
                                        <p><strong>Indicazione o nota:</strong> {recovery.current.motivation || 'Non indicata'}</p>
                                        <p><strong>Diagnosi:</strong> {recovery.current.diagnosisName || 'Non collegata'}</p>
                                    </div>
                                )}
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button type="button" onClick={rereadTherapy} disabled={isReading || draft?.patientId !== patientId} className={`${quietButtonClassName} h-auto min-h-11 whitespace-normal text-left`}>
                                        {isReading ? 'Rilettura...' : 'Rileggi terapia'}
                                    </button>
                                    {recovery.readComplete && (draft?.editing ? !!recovery.current : !recovery.current) && (
                                        <button type="button" onClick={keepReviewedDraft} disabled={isReading || draft?.patientId !== patientId} className={`${quietButtonClassName} h-auto min-h-11 whitespace-normal text-left`}>
                                            {draft?.editing ? 'Ho confrontato i dati: mantieni la bozza' : 'Ho verificato: continua con la bozza'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="flex justify-end pt-2 gap-2">
                            <button type="button" onClick={cancelEditing} disabled={isSaving || isReading} className={quietButtonClassName}>Annulla</button>
                            <button type="submit" disabled={isSaving || !!recovery || draft?.patientId !== patientId} className="ui-btn-primary inline-flex h-10 items-center gap-1.5 px-4 text-sm font-semibold disabled:opacity-50">
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
                    <div className="rounded-[18px] border border-dashed border-[color:color-mix(in_srgb,var(--lume-ink)_16%,transparent)] bg-[color:var(--lume-surface-focal)] p-8 text-center">
                        <p className="text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                            Nessuna terapia attiva registrata. Aggiungi una terapia quando serve tenere traccia di farmaco e posologia.
                        </p>
                    </div>
                ) : (
                    <>
                        {activeTherapies.length > 0 && (
                            <h5 className="flex flex-wrap items-baseline gap-2 text-base font-semibold text-[color:var(--lume-ink)]">
                                {/* @Codex WUL-678: therapy counts use the heading baseline and UI type. */}
                                Terapie attive <span className="tabular-nums">{activeTherapies.length}</span>
                            </h5>
                        )}
                        {/* ACTIVE */}
                        {activeTherapies.map(t => (
                            <div key={t.id} className="flex flex-col items-start justify-between gap-4 rounded-[18px] border border-[color:color-mix(in_srgb,var(--lume-ink)_13%,transparent)] bg-[color:var(--lume-surface-field)] p-4 shadow-[var(--lume-shadow-focal)] sm:flex-row">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="text-base font-semibold text-[color:var(--lume-ink)]">{t.drugName}</h4>
                                        <span className="inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_18%,transparent)] bg-[color:var(--lume-surface-field)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--lume-ink-muted)]">
                                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--lume-ink-muted)]" aria-hidden />
                                            Attiva
                                        </span>
                                        {t.activePrinciple && <span className="rounded-full bg-[color:var(--lume-surface-focal)] px-2 py-0.5 text-xs font-medium text-[color:var(--lume-ink-muted)]">{t.activePrinciple}</span>}
                                    </div>
                                    <p className="mt-1 text-base leading-6 font-medium text-[color:var(--lume-ink)]">{t.dosage}</p>
                                    {t.startDate && (
                                        <p className="mt-0.5 text-xs text-[color:var(--lume-ink-muted)]">
                                            In corso dal <span className="lume-registro">{format(new Date(t.startDate), 'dd/MM/yyyy', { locale: it })}</span>
                                        </p>
                                    )}

                                    {t.diagnosisCode && (
                                        <div className="mt-1 flex items-center gap-1.5">
                                            <span className="rounded border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-focal)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--lume-ink-muted)]">
                                                {t.diagnosisCode}
                                            </span>
                                            <span className="max-w-[220px] truncate text-xs text-[color:var(--lume-ink-muted)]" title={t.diagnosisName}>
                                                {t.diagnosisName}
                                            </span>
                                        </div>
                                    )}

                                    {t.motivation && <p className="mt-2 text-sm leading-6 text-[color:var(--lume-ink-muted)]">{t.motivation}</p>}

                                    {(t.atc || t.aic) && (
                                        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] font-mono uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                            {t.atc ? <span>ATC {t.atc}</span> : null}
                                            {t.aic ? <span>AIC {t.aic}</span> : null}
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        disabled={!!deleteRecovery}
                                        onClick={() => startEditing(t)}
                                        className={quietButtonClassName}
                                        title="Modifica terapia"
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                        Modifica
                                    </button>

                                    <button
                                        disabled={!!deleteRecovery}
                                        onClick={() => updateStatus(t.id, 'suspended')}
                                        className={statusButtonClassName}
                                        title="Sospendi temporaneamente"
                                    >
                                        <Clock className="w-3.5 h-3.5" />
                                        Sospendi
                                    </button>

                                    <button
                                        disabled={!!deleteRecovery}
                                        onClick={() => updateStatus(t.id, 'completed')}
                                        className={statusButtonClassName}
                                        title="Termina terapia"
                                    >
                                        <StopCircle className="w-3.5 h-3.5" />
                                        Concludi
                                    </button>

                                    <button
                                        disabled={!!deleteRecovery || isAdding}
                                        onClick={() => handleSoftDelete(t.id)}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-[11px] text-[color:var(--lume-ink-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] hover:text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]"
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
                                    <div key={t.id} className="flex flex-col items-start justify-between gap-3 rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-3 sm:flex-row sm:items-center">
                                        <div className="min-w-0 flex-1 break-words">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-semibold text-[color:var(--lume-ink)]">{t.drugName}</span>
                                                <span className="rounded-full border border-[color:color-mix(in_srgb,var(--lume-ink)_18%,transparent)] bg-[color:var(--lume-surface-field)] px-2 py-0.5 text-xs font-semibold text-[color:var(--lume-ink-muted)]">Sospesa</span>
                                            </div>
                                            <p className="mt-0.5 whitespace-pre-wrap text-sm text-[color:var(--lume-ink-muted)]">{t.dosage}</p>
                                            {t.motivation && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[color:var(--lume-ink-muted)]">{t.motivation}</p>}
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                disabled={!!deleteRecovery}
                                                onClick={() => updateStatus(t.id, 'active')}
                                                className={quietButtonClassName}
                                            >
                                                <Play className="w-3 h-3" /> Riprendi
                                            </button>
                                            <button
                                                disabled={!!deleteRecovery}
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
                <div className="mt-6 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_11%,transparent)] pt-4">
                    <h5 className="section-kicker mb-3">Terapie concluse</h5>
                    <div className="space-y-2">
                        {endedTherapies.map(t => (
                            <div key={t.id} className="group flex items-center justify-between gap-3 rounded-[16px] border border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_11%,var(--lume-surface-field))] p-3">
                                <div>
                                    <span className="font-semibold text-[color:var(--lume-ink-muted)] line-through decoration-[color:color-mix(in_srgb,var(--lume-ink)_42%,transparent)]">{t.drugName}</span>
                                    <div className="text-xs text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]">
                                        Conclusa il <span className="lume-registro">{format(new Date(t.endDate || t.updatedAt || t.createdAt), 'dd/MM/yyyy', { locale: it })}</span>
                                    </div>
                                </div>
                                <div className="flex gap-2 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                                    <button
                                        disabled={!!deleteRecovery}
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
