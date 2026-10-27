'use client';

import { Button } from '@/components/ui/button';
import { PatientSheetMenu } from '@/components/patient-sheet-menu';
import { CollapsibleSection } from '@/components/kree8/collapsible-section';
import { Disclosure } from '@/components/disclosure';
import { formatCountLabel } from '@/lib/format-count';
import styles from './clinical-register.module.css';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    CalendarClock,
    FileText,
    ListChecks,
    LoaderCircle,
    MoreHorizontal,
    Plus,
    Stethoscope,
} from 'lucide-react';
import {
    db,
    type ServicePrescription,
    type ServicePrescriptionCategory,
    type ServicePrescriptionItem,
    type ServicePrescriptionPriority,
    type ServicePrescriptionStatus,
} from '@/lib/db';
import { notifyDbChange, useLiveQuery } from '@/lib/live-query';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DocumentReferenceChip } from '@/components/document-reference-chip';
import { Badge } from '@/components/ui/badge';
import { useRuntimeTwinPendingForm } from '@/components/runtime-twin-design';
import {
    catalogMatchStatusSignal,
    type SemanticSignal,
} from '@/lib/ui-semantic-signal';

type Props = {
    patientId: string;
    embedded?: boolean;
    surfaceClassName?: string;
};

type FormState = {
    prescribedAt: string;
    status: ServicePrescriptionStatus;
    category: ServicePrescriptionCategory;
    priority: ServicePrescriptionPriority;
    codeSystem: string;
    serviceCode: string;
    serviceName: string;
    clinicalQuestion: string;
    provider: string;
    scheduledAt: string;
    performedAt: string;
    reportReceivedAt: string;
    outcomeNote: string;
    requestReference: string;
    source: 'manual' | 'document_review';
    documentRefs: string;
    notes: string;
    itemsText: string;
};

const STATUS_OPTIONS: Array<{ value: ServicePrescriptionStatus; label: string }> = [
    { value: 'prescribed', label: 'Prescritta' },
    { value: 'booked', label: 'Prenotata' },
    { value: 'performed', label: 'Eseguita' },
    { value: 'report_received', label: 'Referto ricevuto' },
    { value: 'cancelled', label: 'Annullata' },
];

const CATEGORY_OPTIONS: Array<{ value: ServicePrescriptionCategory; label: string }> = [
    { value: 'lab', label: 'Laboratorio' },
    { value: 'imaging', label: 'Imaging' },
    { value: 'visit', label: 'Visita' },
    { value: 'rehab', label: 'Riabilitazione' },
    { value: 'screening', label: 'Screening' },
    { value: 'procedure', label: 'Procedura' },
    { value: 'other', label: 'Altro' },
];

const PRIORITY_OPTIONS: Array<{ value: ServicePrescriptionPriority; label: string }> = [
    { value: 'routine', label: 'Routine' },
    { value: 'P', label: 'Programmata (P)' },
    { value: 'D', label: 'Differibile (D)' },
    { value: 'B', label: 'Breve (B)' },
    { value: 'U', label: 'Urgente (U)' },
    { value: 'unknown', label: 'Non indicata' },
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
        category: 'visit',
        priority: 'routine',
        codeSystem: '',
        serviceCode: '',
        serviceName: '',
        clinicalQuestion: '',
        provider: '',
        scheduledAt: '',
        performedAt: '',
        reportReceivedAt: '',
        outcomeNote: '',
        requestReference: '',
        source: 'manual',
        documentRefs: '',
        notes: '',
        itemsText: '',
    };
}

function optionalValue(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function optionalDate(value: string): Date | undefined {
    return value ? new Date(value) : undefined;
}

function statusLabel(value: ServicePrescriptionStatus): string {
    return STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function categoryLabel(value: ServicePrescriptionCategory): string {
    return CATEGORY_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function priorityLabel(value: ServicePrescriptionPriority): string {
    return PRIORITY_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function serviceStatusSignal(value: ServicePrescriptionStatus): SemanticSignal {
    return value === 'performed' || value === 'report_received' ? 'success' : 'neutral';
}

function servicePrioritySignal(value: ServicePrescriptionPriority): SemanticSignal {
    if (value === 'U') return 'critical';
    if (value === 'B') return 'warning';
    return 'neutral';
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

function formatDate(value: Date | string | undefined): string | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString('it-IT');
}

function parseItemDrafts(value: string, fallbackName: string): Array<{ serviceName: string; serviceCode?: string }> {
    const lines = value
        .split(/\n|;/)
        .map((line) => line.trim())
        .filter(Boolean);
    const source = lines.length > 0 ? lines : [fallbackName.trim()].filter(Boolean);
    return source.map((line) => {
        const match = line.match(/^([A-Za-z0-9._/-]{2,})\s+(.+)$/);
        const looksLikeCode = Boolean(match?.[1] && /[0-9._/-]/.test(match[1]));
        return match && looksLikeCode
            ? { serviceCode: match[1].trim(), serviceName: match[2].trim() }
            : { serviceName: line };
    });
}

function childServiceCodeForDraft(
    draft: { serviceName: string; serviceCode?: string },
    inheritedServiceCode: string | undefined,
): string | undefined {
    return draft.serviceCode ?? inheritedServiceCode;
}

export default function ServicePrescriptionManager({ patientId, embedded = false, surfaceClassName = 'patient-detail-section' }: Props) {
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
            const items = await db.servicePrescriptions
                .filter((item: ServicePrescription) => item.patientId === patientId)
                .toArray();
            return items.sort(
                (left, right) => new Date(right.prescribedAt).getTime() - new Date(left.prescribedAt).getTime(),
            );
        },
        [patientId],
        undefined,
        ['service_prescriptions'],
    );

    const prescriptionItems = useLiveQuery(
        async () => {
            const items = await db.servicePrescriptionItems
                .filter((item: ServicePrescriptionItem) => item.patientId === patientId)
                .toArray();
            return items.sort((left, right) => left.ordinal - right.ordinal);
        },
        [patientId],
        undefined,
        ['service_prescription_items'],
    );

    const itemsByPrescription = useMemo(() => {
        const map = new Map<string, ServicePrescriptionItem[]>();
        for (const item of prescriptionItems ?? []) {
            const current = map.get(item.prescriptionId) ?? [];
            current.push(item);
            map.set(item.prescriptionId, current);
        }
        return map;
    }, [prescriptionItems]);

    const parsedItemsPreview = useMemo(
        () => parseItemDrafts(form.itemsText, form.serviceName),
        [form.itemsText, form.serviceName],
    );

    const openCount = useMemo(
        () => prescriptions?.filter((item) => item.status !== 'performed' && item.status !== 'report_received' && item.status !== 'cancelled').length ?? 0,
        [prescriptions],
    );
    const reportCount = useMemo(
        () => prescriptions?.filter((item) => item.status === 'report_received').length ?? 0,
        [prescriptions],
    );

    const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);

        if (!form.serviceName.trim()) {
            setError('Indica il nome della prestazione.');
            return;
        }

        setIsSaving(true);
        try {
            const prescriptionId = crypto.randomUUID();
            await db.servicePrescriptions.add({
                id: prescriptionId,
                patientId,
                prescribedAt: new Date(form.prescribedAt),
                status: form.status,
                category: form.category,
                priority: form.priority,
                codeSystem: optionalValue(form.codeSystem),
                serviceCode: optionalValue(form.serviceCode),
                serviceName: form.serviceName.trim(),
                clinicalQuestion: optionalValue(form.clinicalQuestion),
                provider: optionalValue(form.provider),
                scheduledAt: optionalDate(form.scheduledAt),
                performedAt: optionalDate(form.performedAt),
                reportReceivedAt: optionalDate(form.reportReceivedAt),
                outcomeNote: optionalValue(form.outcomeNote),
                requestReference: optionalValue(form.requestReference),
                source: form.source,
                documentRefs: optionalValue(form.documentRefs),
                notes: optionalValue(form.notes),
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const itemDrafts = parseItemDrafts(form.itemsText, form.serviceName);
            const inheritedServiceCode = itemDrafts.length === 1 ? optionalValue(form.serviceCode) : undefined;
            await Promise.all(itemDrafts.map((draft, index) => {
                const serviceCode = childServiceCodeForDraft(draft, inheritedServiceCode);
                return db.servicePrescriptionItems.add({
                    id: crypto.randomUUID(),
                    patientId,
                    prescriptionId,
                    ordinal: index,
                    status: form.status,
                    category: form.category,
                    codeSystem: serviceCode ? optionalValue(form.codeSystem) : undefined,
                    serviceCode,
                    serviceName: draft.serviceName,
                    catalogDisplayName: undefined,
                    catalogEntryId: undefined,
                    matchStatus: serviceCode ? 'manual' : 'unmatched',
                    confidence: undefined,
                    evidence: undefined,
                    notes: undefined,
                    scheduledAt: optionalDate(form.scheduledAt),
                    performedAt: optionalDate(form.performedAt),
                    reportReceivedAt: optionalDate(form.reportReceivedAt),
                    outcomeNote: optionalValue(form.outcomeNote),
                    version: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });
            }));
            setForm(emptyForm());
            setIsFormOpen(false);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Salvataggio non riuscito.');
        } finally {
            setIsSaving(false);
        }
    };

    const updatePrescriptionAndItems = async (
        item: ServicePrescription,
        update: Partial<ServicePrescription>,
        childUpdate: Partial<ServicePrescriptionItem>,
    ) => {
        await db.servicePrescriptions.update(item.id, {
            ...update,
            version: item.version,
            updatedAt: new Date(),
        });
        const children = itemsByPrescription.get(item.id) ?? [];
        await Promise.all(children.map((child) => db.servicePrescriptionItems.update(child.id, {
            ...childUpdate,
            version: child.version,
            updatedAt: new Date(),
        })));
    };

    const markBooked = async (item: ServicePrescription) => {
        const scheduledAt = item.scheduledAt ?? new Date();
        await updatePrescriptionAndItems(item, {
            status: 'booked',
            scheduledAt,
        }, {
            status: 'booked',
            scheduledAt,
        });
    };

    const markPerformed = async (item: ServicePrescription) => {
        const performedAt = item.performedAt ?? new Date();
        await updatePrescriptionAndItems(item, {
            status: 'performed',
            performedAt,
        }, {
            status: 'performed',
            performedAt,
        });
    };

    const markReportReceived = async (item: ServicePrescription) => {
        const reportReceivedAt = item.reportReceivedAt ?? new Date();
        await updatePrescriptionAndItems(item, {
            status: 'report_received',
            reportReceivedAt,
        }, {
            status: 'report_received',
            reportReceivedAt,
        });
    };

    const cancelItem = async (item: ServicePrescription) => {
        await updatePrescriptionAndItems(item, {
            status: 'cancelled',
        }, {
            status: 'cancelled',
        });
    };

    const deleteItem = async (item: ServicePrescription) => {
        const { confirmed } = await confirm({
            title: `Eliminare la prestazione "${item.serviceName}"?`,
            confirmLabel: 'Elimina',
            tone: 'danger'
        });
        if (!confirmed) return;
        try {
            await db.servicePrescriptions.delete(item.id, { version: item.version });
        } catch (error) {
            notifyDbChange('service_prescriptions');
            throw error;
        } finally {
            // il delete atomico del parent rimuove anche i figli lato server.
            notifyDbChange('service_prescription_items');
        }
    };

    const count = prescriptions === undefined ? undefined : formatCountLabel(prescriptions.length, 'prestazione', 'prestazioni');
    const newButton = <Button ref={creationRef} variant="text" aria-expanded={isFormOpen} aria-controls={isFormOpen ? formId : undefined}
        onClick={() => setIsFormOpen(value => !value)}>Nuova prestazione</Button>;
    const content = (
        <section className={styles.register}>
            {!embedded && <header className={styles.therapyHeading}><h2>Prestazioni prescritte <span>{count}</span></h2>{newButton}</header>}
            {prescriptions && prescriptions.length > 0 ? <p className={styles.muted}>
                {prescriptionItems !== undefined ? <>{formatCountLabel(prescriptionItems.length, 'voce', 'voci')} · </> : null}
                {formatCountLabel(openCount, 'aperta', 'aperte')} · {formatCountLabel(reportCount, 'referto', 'referti')}
            </p> : null}

            {isFormOpen && (
                <form id={formId} ref={formRef} aria-label="Nuova prestazione"
                    onSubmit={handleSubmit}
                    className={styles.form}
                >
                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="md:col-span-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                            <Stethoscope className="h-3.5 w-3.5" aria-hidden />
                            Prestazione e voci richieste
                        </div>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)] md:col-span-2">
                            Nome prestazione (raggruppa le voci) <span aria-hidden className="text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">*</span>
                            <input
                                className="input-field"
                                value={form.serviceName}
                                onChange={(event) => updateForm('serviceName', event.target.value)}
                                placeholder="es. Esami ematochimici di controllo · Visita cardiologica · RX torace"
                                aria-required="true"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)] md:col-span-2">
                            <span className="flex items-center gap-1.5">
                                <ListChecks className="h-3.5 w-3.5" aria-hidden />
                                Voci richieste - una per riga, opzionale CODICE NOME
                            </span>
                            <textarea
                                className="input-field min-h-28 type-code"
                                value={form.itemsText}
                                onChange={(event) => updateForm('itemsText', event.target.value)}
                                placeholder={`EMOCROMO\nD-DIMERO\nLDH\nAST\nALT\nVITAMINA D`}
                            />
                            <p className="text-xs font-normal text-[color:var(--lume-ink-muted)]">
                                {form.itemsText.trim().length === 0
                                    ? 'Lascia vuoto per una singola voce con il nome della prestazione.'
                                    : `${formatCountLabel(parsedItemsPreview.length, 'voce pronta', 'voci pronte')} al salvataggio.`}
                            </p>
                        </label>
                        <div className="md:col-span-2 mt-1 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] pt-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                            Inquadramento e pianificazione
                        </div>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Data prescrizione
                            <input
                                className="input-field lume-registro"
                                type="date"
                                value={form.prescribedAt}
                                onChange={(event) => updateForm('prescribedAt', event.target.value)}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Stato
                            <select
                                className="input-field"
                                value={form.status}
                                onChange={(event) => updateForm('status', event.target.value as ServicePrescriptionStatus)}
                            >
                                {STATUS_OPTIONS.map((item) => (
                                    <option key={item.value} value={item.value}>{item.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Categoria
                            <select
                                className="input-field"
                                value={form.category}
                                onChange={(event) => updateForm('category', event.target.value as ServicePrescriptionCategory)}
                            >
                                {CATEGORY_OPTIONS.map((item) => (
                                    <option key={item.value} value={item.value}>{item.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Classe di priorità
                            <select
                                className="input-field"
                                value={form.priority}
                                onChange={(event) => updateForm('priority', event.target.value as ServicePrescriptionPriority)}
                            >
                                {PRIORITY_OPTIONS.map((item) => (
                                    <option key={item.value} value={item.value}>{item.label}</option>
                                ))}
                            </select>
                        </label>
                        <div className="md:col-span-2 mt-1 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_10%,transparent)] pt-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                            <FileText className="h-3.5 w-3.5" aria-hidden />
                            Codifica, contesto e note
                        </div>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Sistema codice
                            <input
                                className="input-field lume-registro"
                                value={form.codeSystem}
                                onChange={(event) => updateForm('codeSystem', event.target.value)}
                                placeholder="es. nomenclatore regionale, LOINC, SNOMED"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Codice prestazione
                            <input
                                className="input-field lume-registro"
                                value={form.serviceCode}
                                onChange={(event) => updateForm('serviceCode', event.target.value)}
                                placeholder="es. 89.7"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)] md:col-span-2">
                            Quesito clinico
                            <textarea
                                className="input-field min-h-20"
                                value={form.clinicalQuestion}
                                onChange={(event) => updateForm('clinicalQuestion', event.target.value)}
                                placeholder="Motivazione e quesito alla base della richiesta"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Struttura / erogatore
                            <input
                                className="input-field"
                                value={form.provider}
                                onChange={(event) => updateForm('provider', event.target.value)}
                                placeholder="es. Ambulatorio Cardiologia ASST"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Riferimento ricetta / impegnativa
                            <input
                                className="input-field lume-registro"
                                value={form.requestReference}
                                onChange={(event) => updateForm('requestReference', event.target.value)}
                                placeholder="es. NRE / numero pratica"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Data prenotazione
                            <input
                                className="input-field lume-registro"
                                type="date"
                                value={form.scheduledAt}
                                onChange={(event) => updateForm('scheduledAt', event.target.value)}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Data esecuzione
                            <input
                                className="input-field lume-registro"
                                type="date"
                                value={form.performedAt}
                                onChange={(event) => updateForm('performedAt', event.target.value)}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Data referto
                            <input
                                className="input-field lume-registro"
                                type="date"
                                value={form.reportReceivedAt}
                                onChange={(event) => updateForm('reportReceivedAt', event.target.value)}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Origine
                            <select
                                className="input-field"
                                value={form.source}
                                onChange={(event) => updateForm('source', event.target.value as FormState['source'])}
                            >
                                <option value="manual">Manuale</option>
                                <option value="document_review">Da documento revisionato</option>
                            </select>
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)] md:col-span-2">
                            Esito / sintesi referto
                            <textarea
                                className="input-field min-h-20"
                                value={form.outcomeNote}
                                onChange={(event) => updateForm('outcomeNote', event.target.value)}
                                placeholder="Sintesi dell'esito utile per il decorso clinico"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)]">
                            Allegati / riferimenti
                            <input
                                className="input-field"
                                value={form.documentRefs}
                                onChange={(event) => updateForm('documentRefs', event.target.value)}
                                placeholder="ID allegato, nome file o riferimento pratica"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--lume-ink-muted)] md:col-span-2">
                            Note operative
                            <textarea
                                className="input-field min-h-20"
                                value={form.notes}
                                onChange={(event) => updateForm('notes', event.target.value)}
                            />
                        </label>
                    </div>
                    {error && <p className="mt-3 text-xs font-medium text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">{error}</p>}
                    <div className="mt-4 flex justify-end gap-2">
                        <button
                            type="button"
                            className="ui-btn-secondary h-10 px-4 text-sm"
                            onClick={() => setIsFormOpen(false)}
                        >
                            Annulla
                        </button>
                        <button
                            type="submit"
                            className="ui-btn-primary h-10 px-4 text-sm"
                            disabled={isSaving}
                        >
                            {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Salva prestazione
                        </button>
                    </div>
                </form>
            )}

            {!prescriptions ? <p role="status" className={styles.empty}>Caricamento prescrizioni…</p> : prescriptions.length === 0 ? (
                <p className={styles.empty}>Nessuna prestazione prescritta registrata.</p>
            ) : (
                <div className="min-w-0">
                    <table className={`${styles.table} ${styles.therapyTable}`}><thead><tr><th>Prestazione</th><th className={styles.secondaryColumn}>Prescritta il</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>
                    {prescriptions.map((item) => {
                        const refs = parseDocumentRefs(item.documentRefs);
                        const isClosed = item.status === 'performed' || item.status === 'report_received' || item.status === 'cancelled';
                        const canBook = item.status === 'prescribed';
                        const canPerform = item.status === 'prescribed' || item.status === 'booked';
                        const canReceiveReport = item.status !== 'report_received' && item.status !== 'cancelled';
                        const canCancel = item.status !== 'cancelled' && item.status !== 'performed' && item.status !== 'report_received';
                        const priority = item.priority ?? 'unknown';
                        const childItems = itemsByPrescription.get(item.id) ?? [];
                        const primaryAction = canBook ? { label: 'Segna prenotata', run: () => void markBooked(item) }
                            : canPerform ? { label: 'Segna eseguita', run: () => void markPerformed(item) }
                                : canReceiveReport ? { label: 'Referto ricevuto', run: () => void markReportReceived(item) } : null;
                        return <tr key={item.id}>
                            <td><strong>{item.serviceName}</strong><small>{categoryLabel(item.category)}{childItems.length > 0 ? ` · ${formatCountLabel(childItems.length, 'voce', 'voci')}` : ''}</small>
                                <Disclosure className={styles.recordDetails} title="Dettagli, referti e documenti">
                                    <p>Prescritta il {formatDate(item.prescribedAt) ?? '–'}</p>
                                        <div className="mt-2 grid gap-2 text-sm text-[color:var(--lume-ink-muted)] md:grid-cols-2">
                                            {item.serviceCode && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--lume-ink)]">Codice:</span>{' '}
                                                    {item.serviceCode}
                                                    {item.codeSystem ? ` (${item.codeSystem})` : ''}
                                                </p>
                                            )}
                                            {item.provider && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--lume-ink)]">Erogatore:</span> {item.provider}
                                                </p>
                                            )}
                                            {item.requestReference && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--lume-ink)]">Ricetta:</span> {item.requestReference}
                                                </p>
                                            )}
                                            {item.scheduledAt && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--lume-ink)]">Prenotazione:</span>{' '}
                                                    <span className="lume-registro">{formatDate(item.scheduledAt)}</span>
                                                </p>
                                            )}
                                            {item.performedAt && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--lume-ink)]">Esecuzione:</span>{' '}
                                                    <span className="lume-registro">{formatDate(item.performedAt)}</span>
                                                </p>
                                            )}
                                            {item.reportReceivedAt && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--lume-ink)]">Referto:</span>{' '}
                                                    <span className="lume-registro">{formatDate(item.reportReceivedAt)}</span>
                                                </p>
                                            )}
                                            {item.clinicalQuestion && (
                                                <p className="md:col-span-2">
                                                    <span className="font-semibold text-[color:var(--lume-ink)]">Quesito:</span> {item.clinicalQuestion}
                                                </p>
                                            )}
                                        </div>
                                        {item.outcomeNote && (
                                            <p className="mt-2 text-sm leading-6 text-[color:var(--lume-ink-muted)]">{item.outcomeNote}</p>
                                        )}
                                        {childItems.length > 0 && (
                                            <div className="mt-3 border-t border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] pt-3">
                                                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                                                    <ListChecks className="h-3.5 w-3.5" aria-hidden />
                                                    Voci richieste · {childItems.length}
                                                </p>
                                                <ul className="divide-y divide-[color:color-mix(in_srgb,var(--lume-ink)_8%,transparent)]">
                                                    {childItems.map((child) => {
                                                        const matchLabel =
                                                            child.matchStatus === 'matched'
                                                                ? 'match'
                                                                : child.matchStatus === 'candidate'
                                                                    ? 'candidato'
                                                                    : child.matchStatus === 'manual'
                                                                        ? 'manuale'
                                                                        : 'da codificare';
                                                        return (
                                                            <li
                                                                key={child.id}
                                                                className="flex flex-col gap-1 py-1.5 text-sm md:flex-row md:items-center md:justify-between md:gap-3"
                                                            >
                                                                <div className="min-w-0 flex-1">
                                                                    <span className="font-medium text-[color:var(--lume-ink)]">{child.serviceName}</span>
                                                                    {child.serviceCode && (
                                                                        <span className="lume-code ml-2 text-[color:var(--lume-ink-muted)]">
                                                                            {child.serviceCode}
                                                                            {child.codeSystem ? ` · ${child.codeSystem}` : ''}
                                                                        </span>
                                                                    )}
                                                                    {!child.serviceCode && (
                                                                        <span className="ml-2 text-xs italic text-[color:var(--lume-ink-muted)]">in attesa di matching repertorio</span>
                                                                    )}
                                                                </div>
                                                                <Badge tone={catalogMatchStatusSignal(child.matchStatus)} size="xs" className="shrink-0">{matchLabel}</Badge>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </div>
                                        )}
                                        <DocumentReferenceChip references={refs} />
                                        {item.notes && (
                                            <p className="mt-3 text-sm leading-6 text-[color:var(--lume-ink-muted)]">{item.notes}</p>
                                        )}

                                </Disclosure>
                            </td>
                            <td className={`${styles.secondaryColumn} lume-registro`}>{formatDate(item.prescribedAt) ?? '–'}</td>
                            <td><Badge tone={serviceStatusSignal(item.status)} size="xs" className={styles.status}>{statusLabel(item.status)}</Badge>
                                {priority !== 'unknown' && <div><Badge tone={servicePrioritySignal(priority)} size="xs" className={styles.status}>{priorityLabel(priority)}</Badge></div>}
                                {item.source === 'document_review' && <small>Da documento</small>}{item.source === 'legacy_therapy_cleanup' && <small>Da pulizia diario</small>}
                            </td>
                            <td>
                                <div className={styles.therapyActions}>
                                    {primaryAction ? <Button variant="text" onClick={primaryAction.run}>{primaryAction.label}</Button> : null}
                                    <PatientSheetMenu label={`Azioni prestazione ${item.serviceName}`}
                                        trigger={props => <Button {...props} variant="icon" aria-label={`Azioni prestazione ${item.serviceName}`}><MoreHorizontal size={16} aria-hidden /></Button>}>
                                        {canPerform && canBook ? <button type="button" role="menuitem" onClick={() => void markPerformed(item)}>Segna eseguita</button> : null}
                                        {canReceiveReport && (canBook || canPerform) ? <button type="button" role="menuitem" onClick={() => void markReportReceived(item)}>Referto ricevuto</button> : null}
                                        {canCancel ? <button type="button" role="menuitem" onClick={() => void cancelItem(item)}>Annulla prestazione</button> : null}
                                        {isClosed ? <button type="button" role="menuitem" onClick={() => void deleteItem(item)}>Elimina prestazione</button> : null}
                                    </PatientSheetMenu>
                                </div>

                            </td>
                        </tr>;
                    })}
                    </tbody></table>
                </div>
            )}
        </section>
    );
    return embedded ? <CollapsibleSection id="prestazioni" title="Prestazioni prescritte" count={count}
        defaultOpen={isFormOpen} headerAction={newButton} surfaceClassName={`${surfaceClassName} ${styles.therapySection}`} keepMounted>
        {content}
    </CollapsibleSection> : content;
}
