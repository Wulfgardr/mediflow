'use client';

/* @Codex */
import { type FormEvent, useMemo, useState } from 'react';
import { Accessibility, CheckCircle2, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { db, type ProstheticPrescription, type ProstheticPrescriptionCategory, type ProstheticPrescriptionStatus } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DocumentReferenceChip } from '@/components/document-reference-chip';
import { Badge } from '@/components/ui/badge';
import type { SemanticSignal } from '@/lib/ui-semantic-signal';

type Props = {
    patientId: string;
    embedded?: boolean;
};

type FormState = {
    prescribedAt: string;
    status: ProstheticPrescriptionStatus;
    category: ProstheticPrescriptionCategory;
    isoCode: string;
    description: string;
    measures: string;
    clinicalReason: string;
    regionalPrescriptionId: string;
    supplier: string;
    collaudoAt: string;
    collaudoOutcome: string;
    source: 'manual' | 'document_review';
    documentRefs: string;
    notes: string;
};

const STATUS_OPTIONS: Array<{ value: ProstheticPrescriptionStatus; label: string }> = [
    { value: 'draft', label: 'Bozza' },
    { value: 'prescribed', label: 'Prescritta' },
    { value: 'submitted', label: 'Inviata' },
    { value: 'authorized', label: 'Autorizzata' },
    { value: 'delivered', label: 'Consegnata' },
    { value: 'tested', label: 'Collaudata' },
    { value: 'cancelled', label: 'Annullata' },
];

const CATEGORY_OPTIONS: Array<{ value: ProstheticPrescriptionCategory; label: string }> = [
    { value: 'standard', label: 'Ausilio standard' },
    { value: 'oxygen', label: 'Ossigenoterapia' },
    { value: 'repair', label: 'Riparazione' },
    { value: 'replacement', label: 'Sostituzione' },
    { value: 'trial', label: 'Prova/valutazione' },
    { value: 'other', label: 'Altro' },
];

function todayInputValue(): string {
    return new Date().toISOString().slice(0, 10);
}

function emptyForm(): FormState {
    return {
        prescribedAt: todayInputValue(),
        status: 'prescribed',
        category: 'standard',
        isoCode: '',
        description: '',
        measures: '',
        clinicalReason: '',
        regionalPrescriptionId: '',
        supplier: '',
        collaudoAt: '',
        collaudoOutcome: '',
        source: 'manual',
        documentRefs: '',
        notes: '',
    };
}

function optionalValue(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function statusLabel(value: ProstheticPrescriptionStatus): string {
    return STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function categoryLabel(value: ProstheticPrescriptionCategory): string {
    return CATEGORY_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function prostheticStatusSignal(value: ProstheticPrescriptionStatus): SemanticSignal {
    return value === 'authorized' || value === 'delivered' || value === 'tested'
        ? 'success'
        : 'neutral';
}

function parseDocumentRefs(value: string | undefined): string[] {
    if (!value?.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [value];
    } catch {
        return value
            .split(/\n|,/)
            .map((item) => item.trim())
            .filter(Boolean);
    }
}

export default function ProstheticPrescriptionManager({ patientId, embedded = false }: Props) {
    const confirm = useConfirm();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(() => emptyForm());

    /* @Codex */
    const prescriptions = useLiveQuery(
        async () => {
            const items = await db.prostheticPrescriptions
                .filter((item: ProstheticPrescription) => item.patientId === patientId)
                .toArray();
            return items.sort((left, right) => new Date(right.prescribedAt).getTime() - new Date(left.prescribedAt).getTime());
        },
        [patientId],
        undefined,
        ['prosthetic_prescriptions'],
    );

    const testedCount = useMemo(
        () => prescriptions?.filter((item) => item.status === 'tested').length ?? 0,
        [prescriptions],
    );

    const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);

        if (!form.description.trim()) {
            setError('Descrizione ausilio obbligatoria.');
            return;
        }

        setIsSaving(true);
        try {
            await db.prostheticPrescriptions.add({
                id: crypto.randomUUID(),
                patientId,
                prescribedAt: new Date(form.prescribedAt),
                status: form.status,
                category: form.category,
                isoCode: optionalValue(form.isoCode),
                description: form.description.trim(),
                measures: optionalValue(form.measures),
                clinicalReason: optionalValue(form.clinicalReason),
                regionalPrescriptionId: optionalValue(form.regionalPrescriptionId),
                supplier: optionalValue(form.supplier),
                collaudoAt: form.collaudoAt ? new Date(form.collaudoAt) : undefined,
                collaudoOutcome: optionalValue(form.collaudoOutcome),
                source: form.source,
                documentRefs: optionalValue(form.documentRefs),
                notes: optionalValue(form.notes),
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            setForm(emptyForm());
            setIsFormOpen(false);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Salvataggio non riuscito.');
        } finally {
            setIsSaving(false);
        }
    };

    const markTested = async (item: ProstheticPrescription) => {
        await db.prostheticPrescriptions.update(item.id, {
            status: 'tested',
            collaudoAt: item.collaudoAt ?? new Date(),
            collaudoOutcome: item.collaudoOutcome ?? 'Collaudo registrato in MediFlow.',
            version: item.version,
            updatedAt: new Date(),
        });
    };

    const deleteItem = async (item: ProstheticPrescription) => {
        const { confirmed } = await confirm({
            title: `Eliminare la voce protesica "${item.description}"?`,
            confirmLabel: 'Elimina',
            tone: 'danger'
        });
        if (!confirmed) return;
        await db.prostheticPrescriptions.delete(item.id, { version: item.version });
    };

    const headerActions = (
        <>
            <span className="apple-chip">{prescriptions?.length ?? 0} voci</span>
            <span className="apple-chip">{testedCount} collaudi</span>
            <button
                type="button"
                onClick={() => setIsFormOpen((value) => !value)}
                className="ui-btn-primary h-10 px-4 text-sm font-semibold"
            >
                <Plus className="h-4 w-4" />
                Nuova voce
            </button>
        </>
    );

    return (
        <section className={embedded ? '' : 'patient-detail-section rounded-[20px] border p-5 md:p-6'}>
            {embedded ? (
                <div className="mb-4 flex flex-wrap items-center justify-end gap-2">{headerActions}</div>
            ) : (
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className="section-kicker">Protesica</p>
                        <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-[color:var(--lume-ink)]">
                            <Accessibility className="h-5 w-5 text-[color:var(--lume-accent)]" />
                            Diario ausili e prescrizioni
                        </h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                            Registra cosa è stato prescritto, con codice ISO, misure, documenti prodotti e collaudo. Le voci da allegati restano da revisione operatore.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">{headerActions}</div>
                </div>
            )}

            {isFormOpen && (
                <form onSubmit={handleSubmit} className="mb-5 rounded-[18px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Data prescrizione
                            <input className="input-field lume-registro" type="date" value={form.prescribedAt} onChange={(event) => updateForm('prescribedAt', event.target.value)} />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Stato
                            <select className="input-field" value={form.status} onChange={(event) => updateForm('status', event.target.value as ProstheticPrescriptionStatus)}>
                                {STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Tipo
                            <select className="input-field" value={form.category} onChange={(event) => updateForm('category', event.target.value as ProstheticPrescriptionCategory)}>
                                {CATEGORY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Codice ISO
                            <input className="input-field lume-registro" value={form.isoCode} onChange={(event) => updateForm('isoCode', event.target.value)} placeholder="es. 12.22.03.006" />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)] md:col-span-2">
                            Descrizione ausilio <span aria-hidden className="text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">*</span>
                            <input className="input-field" value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder="Carrozzina ad autospinta..." aria-required="true" />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Misure / configurazione
                            <textarea className="input-field min-h-24" value={form.measures} onChange={(event) => updateForm('measures', event.target.value)} />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Motivazione clinico-funzionale
                            <textarea className="input-field min-h-24" value={form.clinicalReason} onChange={(event) => updateForm('clinicalReason', event.target.value)} />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Numero pratica / prescrizione
                            <input className="input-field lume-registro" value={form.regionalPrescriptionId} onChange={(event) => updateForm('regionalPrescriptionId', event.target.value)} />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Fornitore / struttura
                            <input className="input-field" value={form.supplier} onChange={(event) => updateForm('supplier', event.target.value)} />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Data collaudo
                            <input className="input-field lume-registro" type="date" value={form.collaudoAt} onChange={(event) => updateForm('collaudoAt', event.target.value)} />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Esito collaudo
                            <input className="input-field" value={form.collaudoOutcome} onChange={(event) => updateForm('collaudoOutcome', event.target.value)} />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Origine
                            <select className="input-field" value={form.source} onChange={(event) => updateForm('source', event.target.value as FormState['source'])}>
                                <option value="manual">Manuale</option>
                                <option value="document_review">Da documento revisionato</option>
                            </select>
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Allegati / riferimenti
                            <input className="input-field" value={form.documentRefs} onChange={(event) => updateForm('documentRefs', event.target.value)} placeholder="ID allegato, nome file o riferimento pratica" />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)] md:col-span-2">
                            Note operative
                            <textarea className="input-field min-h-20" value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} />
                        </label>
                    </div>
                    {error && <p className="mt-3 text-xs font-medium text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">{error}</p>}
                    <div className="mt-4 flex justify-end gap-2">
                        <button type="button" className="ui-btn-secondary h-10 px-4 text-sm" onClick={() => setIsFormOpen(false)}>Annulla</button>
                        <button type="submit" className="ui-btn-primary h-10 px-4 text-sm" disabled={isSaving}>
                            {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Salva voce
                        </button>
                    </div>
                </form>
            )}

            {!prescriptions ? null : prescriptions.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-[color:color-mix(in_srgb,var(--lume-ink)_18%,transparent)] px-4 py-6 text-center">
                    <p className="text-sm text-[color:var(--lume-ink-muted)]">
                        Nessuna prescrizione protesica registrata per questo paziente.
                    </p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {prescriptions.map((item) => {
                        const refs = parseDocumentRefs(item.documentRefs);
                        return (
                            <article key={item.id} className="rounded-[18px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="apple-chip lume-registro">{new Date(item.prescribedAt).toLocaleDateString('it-IT')}</span>
                                            <Badge tone={prostheticStatusSignal(item.status)} size="xs">{statusLabel(item.status)}</Badge>
                                            <Badge tone="plum" size="xs">{categoryLabel(item.category)}</Badge>
                                            {item.source === 'document_review' && <Badge tone="plum" size="xs">document-backed</Badge>}
                                        </div>
                                        <h3 className="mt-3 text-base font-semibold text-[color:var(--lume-ink)]">{item.description}</h3>
                                        <div className="mt-2 grid gap-2 text-sm text-[color:var(--lume-ink-muted)] md:grid-cols-2">
                                            {item.isoCode && <p><span className="font-semibold text-[color:var(--lume-ink)]">ISO:</span> <span className="lume-registro">{item.isoCode}</span></p>}
                                            {item.regionalPrescriptionId && <p><span className="font-semibold text-[color:var(--lume-ink)]">Pratica:</span> <span className="lume-registro">{item.regionalPrescriptionId}</span></p>}
                                            {item.measures && <p><span className="font-semibold text-[color:var(--lume-ink)]">Misure:</span> {item.measures}</p>}
                                            {item.clinicalReason && <p><span className="font-semibold text-[color:var(--lume-ink)]">Motivo:</span> {item.clinicalReason}</p>}
                                            {item.supplier && <p><span className="font-semibold text-[color:var(--lume-ink)]">Fornitore:</span> {item.supplier}</p>}
                                            {item.collaudoAt && <p><span className="font-semibold text-[color:var(--lume-ink)]">Collaudo:</span> <span className="lume-registro">{new Date(item.collaudoAt).toLocaleDateString('it-IT')}</span></p>}
                                        </div>
                                        {item.collaudoOutcome && <p className="mt-2 text-sm text-[color:var(--lume-ink-muted)]">{item.collaudoOutcome}</p>}
                                        <DocumentReferenceChip references={refs} />
                                        {item.notes && <p className="mt-3 text-sm leading-6 text-[color:var(--lume-ink-muted)]">{item.notes}</p>}
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        {item.status !== 'tested' && (
                                            <button type="button" className="ui-btn-secondary h-9 px-3 text-xs" onClick={() => void markTested(item)}>
                                                <CheckCircle2 className="h-4 w-4" />
                                                Collaudo
                                            </button>
                                        )}
                                        <button type="button" aria-label={`Elimina ${item.description}`} className="ui-btn-secondary h-9 px-3 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]" onClick={() => void deleteItem(item)}>
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
