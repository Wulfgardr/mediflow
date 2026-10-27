'use client';

import { Button } from '@/components/ui/button';
import { PatientSheetMenu } from '@/components/patient-sheet-menu';
import { CollapsibleSection } from '@/components/kree8/collapsible-section';
import { formatCountLabel } from '@/lib/format-count';
import { Disclosure } from '@/components/disclosure';

import styles from './clinical-register.module.css';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { LoaderCircle, MoreHorizontal, Plus } from 'lucide-react';
import { db, type ProstheticPrescription, type ProstheticPrescriptionCategory, type ProstheticPrescriptionStatus } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DocumentReferenceChip } from '@/components/document-reference-chip';
import { ProstheticsOriginalLinks } from './prosthetics-source-documents';
import type { ProstheticsCatalogSelection } from '@/lib/reference-data/prosthetics-catalog-contract';
import { ProstheticsCatalogLookup } from '@/components/prosthetics-catalog-manager-lookup';
import { Badge } from '@/components/ui/badge';
import { useRuntimeTwinPendingForm } from '@/components/runtime-twin-design';
import type { SemanticSignal } from '@/lib/ui-semantic-signal';

type Props = {
    patientId: string;
    embedded?: boolean;
    surfaceClassName?: string;
};

type FormState = {
    catalogSelection?: ProstheticsCatalogSelection;
    catalogLabel?: string;
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
    // the form asks for the operator's calendar day, not the UTC day.
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
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

export default function ProstheticPrescriptionManager({ patientId, embedded = false, surfaceClassName = 'patient-detail-section' }: Props) {
    const confirm = useConfirm();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(() => emptyForm());
    const formId = useId();
    const creationRef = useRef<HTMLButtonElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const wasFormOpen = useRef(false);
    useEffect(() => {
        if (isFormOpen) formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
        else if (wasFormOpen.current) creationRef.current?.focus();
        wasFormOpen.current = isFormOpen;
    }, [isFormOpen]);

    /* the conditional form's open state is the pending-form signal. */
    useRuntimeTwinPendingForm(isFormOpen);

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
        setForm((current) => ({ ...current, [key]: value, ...(key === 'description' ? { catalogSelection: undefined, catalogLabel: undefined } : {}) }));
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
                catalogSelection: form.catalogSelection,
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

    const count = prescriptions === undefined ? undefined : formatCountLabel(prescriptions.length, 'voce', 'voci');
    const newButton = <Button ref={creationRef} variant="text" aria-expanded={isFormOpen} aria-controls={formId}
        onClick={() => setIsFormOpen(value => !value)}>Nuova voce protesica</Button>;
    const content = (
        <section className={styles.register}>
            {!embedded && <header className={styles.therapyHeading}><h2>Diario ausili e prescrizioni <span>{count}</span></h2>{newButton}</header>}
            {prescriptions && prescriptions.length > 0 ? <p className={styles.muted}>{formatCountLabel(testedCount, 'collaudo', 'collaudi')}</p> : null}

            {isFormOpen && (
                <Disclosure className="mb-4" title="Cerca un ausilio nel repertorio">
                    <div className="pb-4">
                        <ProstheticsCatalogLookup onSelect={(entry, revision) => setForm(current => ({ ...current, description: entry.description,
                            catalogSelection: { entryId: entry.id, revision }, catalogLabel: `${entry.source} · ${entry.version} · ${entry.codeSystem} ${entry.code}` }))} />
                        {form.catalogLabel && <p className="text-sm">Fonte scelta: {form.catalogLabel}</p>}
                    </div>
                </Disclosure>
            )}

            {isFormOpen && (
                <form id={formId} ref={formRef} aria-label="Nuova voce protesica" onSubmit={handleSubmit} className={styles.form}>
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
                    <div className="mt-4 flex justify-end gap-3">
                        <button type="button" className="ui-btn-secondary h-10 px-4 text-sm" onClick={() => setIsFormOpen(false)}>Annulla</button>
                        <button type="submit" className="ui-btn-primary h-10 px-4 text-sm" disabled={isSaving}>
                            {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Salva voce
                        </button>
                    </div>
                </form>
            )}

            {!prescriptions ? <p role="status" className={styles.empty}>Caricamento prescrizioni…</p> : prescriptions.length === 0 ? (
                <div className={styles.empty}>
                    <p className="text-sm text-[color:var(--lume-ink-muted)]">
                        Nessuna prescrizione protesica registrata per questo paziente.
                    </p>
                </div>
            ) : (
                <div className="min-w-0">
                    <table className={`${styles.table} ${styles.therapyTable}`}><thead><tr><th>Ausilio</th><th className={styles.secondaryColumn}>Prescritta il</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>
                    {prescriptions.map((item) => {
                        const refs = parseDocumentRefs(item.documentRefs);
                         return <tr key={item.id}>
                            <td><strong>{item.description}</strong><small>{categoryLabel(item.category)}</small>
                                {item.catalogSnapshot && <div className="space-y-2 text-sm">
                                    <p>{item.catalogSnapshot.codeSystem} · {item.catalogSnapshot.code}</p>
                                    <p>Fonte: {item.catalogSnapshot.source.name} · {item.catalogSnapshot.source.version}</p>
                                    <Disclosure title="Provenienza registrata"><p className="break-all">SHA-256: {item.catalogSnapshot.source.sha256}</p><p>{item.catalogSnapshot.description}</p></Disclosure>
                                    <ProstheticsOriginalLinks documents={item.catalogSnapshot.documents} />
                                </div>}
                                {item.source === 'document_review' && <small>Da documento</small>}
                                <Disclosure className={styles.recordDetails} title="Misure, collaudo e documenti">
                                    <p>Prescritta il {new Date(item.prescribedAt).toLocaleDateString('it-IT')}</p>
                                        <div className="mt-2 grid gap-2 text-sm text-[color:var(--lume-ink-muted)] md:grid-cols-2">
                                            {item.isoCode && <p><span className="font-semibold text-[color:var(--lume-ink)]">ISO:</span> <span className="lume-code">{item.isoCode}</span></p>}
                                            {item.regionalPrescriptionId && <p><span className="font-semibold text-[color:var(--lume-ink)]">Pratica:</span> <span className="lume-code">{item.regionalPrescriptionId}</span></p>}
                                            {item.measures && <p><span className="font-semibold text-[color:var(--lume-ink)]">Misure:</span> {item.measures}</p>}
                                            {item.clinicalReason && <p><span className="font-semibold text-[color:var(--lume-ink)]">Motivo:</span> {item.clinicalReason}</p>}
                                            {item.supplier && <p><span className="font-semibold text-[color:var(--lume-ink)]">Fornitore:</span> {item.supplier}</p>}
                                            {item.collaudoAt && <p><span className="font-semibold text-[color:var(--lume-ink)]">Collaudo:</span> <span className="lume-registro">{new Date(item.collaudoAt).toLocaleDateString('it-IT')}</span></p>}
                                        </div>
                                        {item.collaudoOutcome && <p className="mt-2 text-sm text-[color:var(--lume-ink-muted)]">{item.collaudoOutcome}</p>}
                                        <DocumentReferenceChip references={refs} />
                                        {item.notes && <p className="mt-3 text-sm leading-6 text-[color:var(--lume-ink-muted)]">{item.notes}</p>}

                                </Disclosure>
                            </td>
                            <td className={`${styles.secondaryColumn} lume-registro`}>{new Date(item.prescribedAt).toLocaleDateString('it-IT')}</td>
                            <td><Badge tone={prostheticStatusSignal(item.status)} size="xs" className={styles.status}>{statusLabel(item.status)}</Badge></td>
                            <td>
                                <div className={styles.therapyActions}>
                                    {item.status !== 'tested' ? <Button variant="text" onClick={() => void markTested(item)}>Collaudo</Button> : null}
                                    <PatientSheetMenu label={`Azioni voce protesica ${item.description}`}
                                        trigger={props => <Button {...props} variant="icon" aria-label={`Azioni voce protesica ${item.description}`}><MoreHorizontal size={16} aria-hidden /></Button>}>
                                        <button type="button" role="menuitem" onClick={() => void deleteItem(item)}>Elimina voce protesica</button>
                                    </PatientSheetMenu>
                                </div>

                            </td>
                        </tr>;                    })}
                    </tbody></table>
                </div>
            )}
        </section>
    );
    return embedded ? <CollapsibleSection id="protesica" title="Diario ausili e prescrizioni" count={count}
        defaultOpen={isFormOpen} headerAction={newButton} surfaceClassName={`${surfaceClassName} ${styles.therapySection}`} keepMounted>
        {content}
    </CollapsibleSection> : content;
}
