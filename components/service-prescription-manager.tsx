'use client';

import { type FormEvent, useMemo, useState } from 'react';
import {
    CalendarCheck,
    CalendarClock,
    CheckCircle2,
    ClipboardList,
    FileText,
    ListChecks,
    LoaderCircle,
    Plus,
    Stethoscope,
    Trash2,
    XCircle,
} from 'lucide-react';
import {
    db,
    type ServicePrescription,
    type ServicePrescriptionCategory,
    type ServicePrescriptionItem,
    type ServicePrescriptionPriority,
    type ServicePrescriptionStatus,
} from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';

type Props = {
    patientId: string;
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
    return new Date().toISOString().slice(0, 10);
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

/* @Codex */
function childServiceCodeForDraft(
    draft: { serviceName: string; serviceCode?: string },
    inheritedServiceCode: string | undefined,
): string | undefined {
    return draft.serviceCode ?? inheritedServiceCode;
}

export default function ServicePrescriptionManager({ patientId }: Props) {
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(() => emptyForm());

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
    );

    const prescriptionItems = useLiveQuery(
        async () => {
            const items = await db.servicePrescriptionItems
                .filter((item: ServicePrescriptionItem) => item.patientId === patientId)
                .toArray();
            return items.sort((left, right) => left.ordinal - right.ordinal);
        },
        [patientId],
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

    /* @Codex */
    const updatePrescriptionAndItems = async (
        item: ServicePrescription,
        update: Partial<ServicePrescription>,
        childUpdate: Partial<ServicePrescriptionItem>,
    ) => {
        await db.servicePrescriptions.update(item.id, {
            ...update,
            updatedAt: new Date(),
        });
        const children = itemsByPrescription.get(item.id) ?? [];
        await Promise.all(children.map((child) => db.servicePrescriptionItems.update(child.id, {
            ...childUpdate,
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
        const confirmed = confirm(`Eliminare la prestazione "${item.serviceName}"?`);
        if (!confirmed) return;
        const children = itemsByPrescription.get(item.id) ?? [];
        await Promise.all(children.map((child) => db.servicePrescriptionItems.delete(child.id, { suppressNotify: true })));
        await db.servicePrescriptions.delete(item.id);
    };

    return (
        <section id="prestazioni" className="patient-detail-section border p-5 md:p-6">
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <p className="section-kicker">Prestazioni</p>
                    <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-[color:var(--mf-ink)]">
                        <Stethoscope className="h-5 w-5 text-[color:var(--mf-primary)]" />
                        Prestazioni prescritte
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--mf-muted)]">
                        Visite, esami, imaging, riabilitazione e screening richiesti. Non sono terapie farmacologiche.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <span className="apple-chip">{prescriptions?.length ?? 0} prestazioni</span>
                    <span className="apple-chip">{prescriptionItems?.length ?? 0} voci</span>
                    <span className="apple-chip">{openCount} aperte</span>
                    <span className="apple-chip">{reportCount} referti</span>
                    <button
                        type="button"
                        onClick={() => setIsFormOpen((value) => !value)}
                        className="ui-btn-primary h-10 px-4 text-sm font-semibold"
                    >
                        <Plus className="h-4 w-4" />
                        Nuova prestazione
                    </button>
                </div>
            </div>

            {isFormOpen && (
                <form
                    onSubmit={handleSubmit}
                    className="mb-5 rounded-[8px] border border-[color:rgba(112,106,100,0.12)] bg-white/78 p-4"
                >
                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="md:col-span-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            <Stethoscope className="h-3.5 w-3.5" aria-hidden />
                            Prestazione e voci richieste
                        </div>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)] md:col-span-2">
                            Nome prestazione (raggruppa le voci) <span aria-hidden className="text-rose-600">*</span>
                            <input
                                className="input-field"
                                value={form.serviceName}
                                onChange={(event) => updateForm('serviceName', event.target.value)}
                                placeholder="es. Esami ematochimici di controllo · Visita cardiologica · RX torace"
                                aria-required="true"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)] md:col-span-2">
                            <span className="flex items-center gap-1.5">
                                <ListChecks className="h-3.5 w-3.5" aria-hidden />
                                Voci richieste - una per riga, opzionale CODICE NOME
                            </span>
                            <textarea
                                className="input-field min-h-28 font-mono text-xs"
                                value={form.itemsText}
                                onChange={(event) => updateForm('itemsText', event.target.value)}
                                placeholder={`EMOCROMO\nD-DIMERO\nLDH\nAST\nALT\nVITAMINA D`}
                            />
                            <p className="text-[11px] font-normal text-[color:var(--mf-muted)]">
                                {form.itemsText.trim().length === 0
                                    ? 'Lascia vuoto per una singola voce con il nome della prestazione.'
                                    : `${parsedItemsPreview.length} voci pronte al salvataggio.`}
                            </p>
                        </label>
                        <div className="md:col-span-2 mt-1 border-t border-[color:rgba(112,106,100,0.1)] pt-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                            Inquadramento e pianificazione
                        </div>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Data prescrizione
                            <input
                                className="input-field"
                                type="date"
                                value={form.prescribedAt}
                                onChange={(event) => updateForm('prescribedAt', event.target.value)}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
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
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
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
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
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
                        <div className="md:col-span-2 mt-1 border-t border-[color:rgba(112,106,100,0.1)] pt-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                            <FileText className="h-3.5 w-3.5" aria-hidden />
                            Codifica, contesto e note
                        </div>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Sistema codice
                            <input
                                className="input-field"
                                value={form.codeSystem}
                                onChange={(event) => updateForm('codeSystem', event.target.value)}
                                placeholder="es. nomenclatore regionale, LOINC, SNOMED"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Codice prestazione
                            <input
                                className="input-field"
                                value={form.serviceCode}
                                onChange={(event) => updateForm('serviceCode', event.target.value)}
                                placeholder="es. 89.7"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)] md:col-span-2">
                            Quesito clinico
                            <textarea
                                className="input-field min-h-20"
                                value={form.clinicalQuestion}
                                onChange={(event) => updateForm('clinicalQuestion', event.target.value)}
                                placeholder="Motivazione e quesito alla base della richiesta"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Struttura / erogatore
                            <input
                                className="input-field"
                                value={form.provider}
                                onChange={(event) => updateForm('provider', event.target.value)}
                                placeholder="es. Ambulatorio Cardiologia ASST"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Riferimento ricetta / impegnativa
                            <input
                                className="input-field"
                                value={form.requestReference}
                                onChange={(event) => updateForm('requestReference', event.target.value)}
                                placeholder="es. NRE / numero pratica"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Data prenotazione
                            <input
                                className="input-field"
                                type="date"
                                value={form.scheduledAt}
                                onChange={(event) => updateForm('scheduledAt', event.target.value)}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Data esecuzione
                            <input
                                className="input-field"
                                type="date"
                                value={form.performedAt}
                                onChange={(event) => updateForm('performedAt', event.target.value)}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Data referto
                            <input
                                className="input-field"
                                type="date"
                                value={form.reportReceivedAt}
                                onChange={(event) => updateForm('reportReceivedAt', event.target.value)}
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
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
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)] md:col-span-2">
                            Esito / sintesi referto
                            <textarea
                                className="input-field min-h-20"
                                value={form.outcomeNote}
                                onChange={(event) => updateForm('outcomeNote', event.target.value)}
                                placeholder="Sintesi dell'esito utile per il decorso clinico"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)]">
                            Allegati / riferimenti
                            <input
                                className="input-field"
                                value={form.documentRefs}
                                onChange={(event) => updateForm('documentRefs', event.target.value)}
                                placeholder="ID allegato, nome file o riferimento pratica"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold text-[color:var(--mf-muted)] md:col-span-2">
                            Note operative
                            <textarea
                                className="input-field min-h-20"
                                value={form.notes}
                                onChange={(event) => updateForm('notes', event.target.value)}
                            />
                        </label>
                    </div>
                    {error && <p className="mt-3 text-xs font-medium text-rose-700">{error}</p>}
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

            {!prescriptions ? null : prescriptions.length === 0 ? (
                <div className="rounded-[8px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-4 py-6 text-center">
                    <ClipboardList className="mx-auto mb-2 h-5 w-5 text-[color:var(--mf-muted)]" aria-hidden />
                    <p className="text-sm text-[color:var(--mf-muted)]">
                        Nessuna prestazione prescritta registrata. Aggiungi visite, esami o riabilitazione quando vuoi seguirne stato ed esito.
                    </p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {prescriptions.map((item) => {
                        const refs = parseDocumentRefs(item.documentRefs);
                        const isClosed = item.status === 'performed' || item.status === 'report_received' || item.status === 'cancelled';
                        const canBook = item.status === 'prescribed';
                        const canPerform = item.status === 'prescribed' || item.status === 'booked';
                        const canReceiveReport = item.status !== 'report_received' && item.status !== 'cancelled';
                        const canCancel = item.status !== 'cancelled' && item.status !== 'performed' && item.status !== 'report_received';
                        const priority = item.priority ?? 'unknown';
                        const childItems = itemsByPrescription.get(item.id) ?? [];
                        return (
                            <article
                                key={item.id}
                                className="rounded-[8px] border border-[color:rgba(112,106,100,0.12)] bg-white/78 p-4"
                            >
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="apple-chip">{formatDate(item.prescribedAt) ?? '—'}</span>
                                            <span className="apple-chip">{statusLabel(item.status)}</span>
                                            <span className="apple-chip">{categoryLabel(item.category)}</span>
                                            {priority !== 'unknown' && <span className="apple-chip">{priorityLabel(priority)}</span>}
                                            {childItems.length > 0 && (
                                                <span className="apple-chip inline-flex items-center gap-1">
                                                    <ListChecks className="h-3 w-3" aria-hidden />
                                                    {childItems.length} {childItems.length === 1 ? 'voce' : 'voci'}
                                                </span>
                                            )}
                                            {item.source === 'document_review' && <span className="apple-chip">document-backed</span>}
                                            {item.source === 'legacy_therapy_cleanup' && <span className="apple-chip">da pulizia diario</span>}
                                        </div>
                                        <h3 className="mt-3 text-base font-semibold text-[color:var(--mf-ink)]">{item.serviceName}</h3>
                                        <div className="mt-2 grid gap-2 text-sm text-[color:var(--mf-muted)] md:grid-cols-2">
                                            {item.serviceCode && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--mf-ink)]">Codice:</span>{' '}
                                                    {item.serviceCode}
                                                    {item.codeSystem ? ` (${item.codeSystem})` : ''}
                                                </p>
                                            )}
                                            {item.provider && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--mf-ink)]">Erogatore:</span> {item.provider}
                                                </p>
                                            )}
                                            {item.requestReference && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--mf-ink)]">Ricetta:</span> {item.requestReference}
                                                </p>
                                            )}
                                            {item.scheduledAt && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--mf-ink)]">Prenotazione:</span>{' '}
                                                    {formatDate(item.scheduledAt)}
                                                </p>
                                            )}
                                            {item.performedAt && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--mf-ink)]">Esecuzione:</span>{' '}
                                                    {formatDate(item.performedAt)}
                                                </p>
                                            )}
                                            {item.reportReceivedAt && (
                                                <p>
                                                    <span className="font-semibold text-[color:var(--mf-ink)]">Referto:</span>{' '}
                                                    {formatDate(item.reportReceivedAt)}
                                                </p>
                                            )}
                                            {item.clinicalQuestion && (
                                                <p className="md:col-span-2">
                                                    <span className="font-semibold text-[color:var(--mf-ink)]">Quesito:</span> {item.clinicalQuestion}
                                                </p>
                                            )}
                                        </div>
                                        {item.outcomeNote && (
                                            <p className="mt-2 text-sm leading-6 text-[color:var(--mf-muted)]">{item.outcomeNote}</p>
                                        )}
                                        {childItems.length > 0 && (
                                            <div className="mt-3 border-t border-[color:rgba(112,106,100,0.12)] pt-3">
                                                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                                    <ListChecks className="h-3.5 w-3.5" aria-hidden />
                                                    Voci richieste · {childItems.length}
                                                </p>
                                                <ul className="divide-y divide-[color:rgba(112,106,100,0.08)]">
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
                                                                    <span className="font-medium text-[color:var(--mf-ink)]">{child.serviceName}</span>
                                                                    {child.serviceCode && (
                                                                        <span className="ml-2 font-mono text-xs text-[color:var(--mf-muted)]">
                                                                            {child.serviceCode}
                                                                            {child.codeSystem ? ` · ${child.codeSystem}` : ''}
                                                                        </span>
                                                                    )}
                                                                    {!child.serviceCode && (
                                                                        <span className="ml-2 text-xs italic text-[color:var(--mf-muted)]">in attesa di matching repertorio</span>
                                                                    )}
                                                                </div>
                                                                <span className="apple-chip shrink-0 text-[10px]">{matchLabel}</span>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </div>
                                        )}
                                        {refs.length > 0 && (
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {refs.map((ref) => (
                                                    <span
                                                        key={ref}
                                                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
                                                    >
                                                        <FileText className="h-3 w-3" />
                                                        {ref}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {item.notes && (
                                            <p className="mt-3 text-sm leading-6 text-[color:var(--mf-muted)]">{item.notes}</p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 flex-wrap gap-2 md:flex-col md:items-stretch">
                                        {canBook && (
                                            <button
                                                type="button"
                                                className="ui-btn-secondary h-9 px-3 text-xs"
                                                onClick={() => void markBooked(item)}
                                            >
                                                <CalendarClock className="h-4 w-4" />
                                                Segna prenotata
                                            </button>
                                        )}
                                        {canPerform && (
                                            <button
                                                type="button"
                                                className="ui-btn-secondary h-9 px-3 text-xs"
                                                onClick={() => void markPerformed(item)}
                                            >
                                                <CalendarCheck className="h-4 w-4" />
                                                Segna eseguita
                                            </button>
                                        )}
                                        {canReceiveReport && (
                                            <button
                                                type="button"
                                                className="ui-btn-secondary h-9 px-3 text-xs"
                                                onClick={() => void markReportReceived(item)}
                                            >
                                                <CheckCircle2 className="h-4 w-4" />
                                                Referto ricevuto
                                            </button>
                                        )}
                                        {canCancel && (
                                            <button
                                                type="button"
                                                className="ui-btn-secondary h-9 px-3 text-xs text-rose-700"
                                                onClick={() => void cancelItem(item)}
                                            >
                                                <XCircle className="h-4 w-4" />
                                                Annulla
                                            </button>
                                        )}
                                        {isClosed && (
                                            <button
                                                type="button"
                                                className="ui-btn-secondary h-9 px-3 text-xs text-rose-700"
                                                onClick={() => void deleteItem(item)}
                                                aria-label="Elimina voce"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        )}
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
