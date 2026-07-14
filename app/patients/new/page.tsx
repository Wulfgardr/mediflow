'use client';

import { useState } from 'react';
import {
    db,
    type ServicePrescriptionCategory,
    type ServicePrescriptionPriority,
} from '@/lib/db';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, FileSearch } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import PatientForm from '@/components/patient-form';
import PdfImporter from '@/components/pdf-importer';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { ExtractedPatientData } from '@/lib/pdf-service';
/* @Codex */
import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
/* @Codex */
import PatientDocumentImportReview from '@/components/patient-document-import-review';
/* @Codex */
import {
    buildPatientDocumentReviewDraft,
    type PatientDocumentReviewDraft,
    type ReviewedPatientImportDefaults,
} from '@/lib/domain/documents/patient-document-review';

/* @Codex */
type ImportedServicePrescriptionDraft = NonNullable<ReviewedPatientImportDefaults['servicePrescriptions']>[number];

/* @Codex */
type ImportedPatientDraft = {
    firstName?: string;
    lastName?: string;
    taxCode?: string;
    birthDate?: Date;
    address?: string;
    phone?: string;
    notes?: string;
    diagnoses?: {
        code: string;
        description: string;
        system: 'ICD-9' | 'ICD-10' | 'ICD-11';
        date: Date;
    }[];
    therapies?: Array<{
        drugName: string;
        dosage: string;
        activePrinciple?: string;
        motivation?: string;
        aic?: string;
        atc?: string;
    }>;
    servicePrescriptions?: ImportedServicePrescriptionDraft[];
};

/* @Codex */
const SERVICE_PRESCRIPTION_CATEGORIES = new Set<ServicePrescriptionCategory>([
    'lab',
    'imaging',
    'visit',
    'rehab',
    'screening',
    'procedure',
    'other',
]);

/* @Codex */
const SERVICE_PRESCRIPTION_PRIORITIES = new Set<ServicePrescriptionPriority>([
    'U',
    'B',
    'D',
    'P',
    'routine',
    'unknown',
]);

/* @Codex */
function normalizeServicePrescriptionCategory(
    value: ImportedServicePrescriptionDraft['category'],
): ServicePrescriptionCategory {
    return value && SERVICE_PRESCRIPTION_CATEGORIES.has(value) ? value : 'other';
}

/* @Codex */
function normalizeServicePrescriptionPriority(value: string | undefined): ServicePrescriptionPriority {
    return value && SERVICE_PRESCRIPTION_PRIORITIES.has(value as ServicePrescriptionPriority)
        ? value as ServicePrescriptionPriority
        : 'unknown';
}

/* @Codex */
function parseImportedServicePrescriptionDate(value: string | undefined, fallback: Date): Date {
    if (!value) return fallback;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export default function NewPatientPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [importedData, setImportedData] = useState<ImportedPatientDraft | null>(null);
    /* @Codex */
    const [pendingImportReview, setPendingImportReview] = useState<PatientDocumentReviewDraft | null>(null);
    /* @Codex */
    const [formSeed, setFormSeed] = useState(0);
    /* @Codex */
    const [importMeta, setImportMeta] = useState<{
        quality?: { level: string; reason?: string };
        diagnosisCount: number;
        medicationCount: number;
        reviewPending: boolean;
    } | null>(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onSubmit = async (data: any) => {
        try {
            // DUPLICATE CHECK: Enforce uniqueness on Tax Code
            // We check manually here because the DB schema (historical reasons) might not have unique index
            if (data.taxCode) {
                const existing = (await db.patients.filter((p: any) => p.taxCode === data.taxCode).toArray())[0];
                if (existing) {
                    const { confirmed } = await confirm({
                        title: 'Scheda già esistente',
                        message: `Esiste già una scheda con questo codice fiscale: ${existing.lastName} ${existing.firstName}. Vuoi aprire la scheda esistente invece di crearne una nuova?`,
                        confirmLabel: 'Apri scheda esistente',
                        cancelLabel: 'Annulla',
                    });
                    if (confirmed) {
                        router.push(`/patients/${existing.id}`);
                        return;
                    } else {
                        // If they say Cancel, we abort the save to prevent duplicate
                        return;
                    }
                }
            }

            const patientId = uuidv4();
            const { checkups, ...patientData } = data;

            await db.patients.add({
                id: patientId,
                ...patientData,
                birthDate: new Date(patientData.birthDate),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Checkups
            if (checkups && checkups.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const toPut = checkups.map((c: any) => ({
                    id: uuidv4(),
                    patientId: patientId,
                    date: new Date(c.date),
                    title: c.title,
                    notes: c.notes,
                    status: c.status || 'pending',
                    source: c.source || 'manual',
                    createdAt: new Date()
                }));
                await db.checkups.bulkPut(toPut);
            }

            if (Array.isArray(importedData?.therapies) && importedData.therapies.length > 0) {
                const therapyItems = importedData.therapies.map((therapy) => ({
                    id: uuidv4(),
                    patientId,
                    drugName: therapy.drugName,
                    aic: therapy.aic,
                    atc: therapy.atc,
                    activePrinciple: therapy.activePrinciple,
                    dosage: therapy.dosage,
                    motivation: therapy.motivation,
                    status: 'active' as const,
                    startDate: new Date(),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }));
                await db.therapies.bulkPut(therapyItems);
            }

            if (Array.isArray(importedData?.servicePrescriptions) && importedData.servicePrescriptions.length > 0) {
                const now = new Date();
                const servicePrescriptionItems = importedData.servicePrescriptions
                    .filter((item) => item.serviceName.trim().length > 0)
                    .map((item) => ({
                        id: uuidv4(),
                        patientId,
                        prescribedAt: parseImportedServicePrescriptionDate(item.prescribedAt, now),
                        status: 'prescribed' as const,
                        category: normalizeServicePrescriptionCategory(item.category),
                        priority: normalizeServicePrescriptionPriority(item.priority),
                        codeSystem: item.codeSystem,
                        serviceCode: item.serviceCode,
                        serviceName: item.serviceName.trim(),
                        clinicalQuestion: item.clinicalQuestion,
                        provider: item.provider,
                        requestReference: item.requestReference,
                        source: 'document_review' as const,
                        notes: item.evidence ? `Evidenza documento: ${item.evidence}` : undefined,
                        version: 1,
                        createdAt: now,
                        updatedAt: now,
                    }));
                await db.servicePrescriptions.bulkPut(servicePrescriptionItems);
            }

            router.push('/');
        } catch (error) {
            console.error("Failed to save patient", error);
            showToast({ tone: 'error', title: 'Errore durante il salvataggio', description: 'Controlla i dati e riprova.' });
        }
    };

    const statusLabel = pendingImportReview
        ? 'Documento letto: controllo in corso.'
        : importedData
            ? 'Dati applicati alla scheda: controlla i campi e conferma.'
            : 'La scheda viene creata solo quando salvi.';

    const navItems = [
        { href: '#documento', label: 'Documento', meta: 'opzionale' },
        ...(importMeta ? [{
            href: '#controllo',
            label: 'Controllo',
            meta: pendingImportReview ? 'pre-compilazione' : 'completato',
        }] : []),
        { href: '#dati', label: 'Dati', meta: 'scheda' },
    ];

    return (
        <Kree8WorkspaceShell
            eyebrow="Paziente"
            title="Nuova scheda"
            subtitle="Da documento clinico o con inserimento manuale."
            backHref="/?area=incarico"
            backLabel="Torna alla lista"
            statusLabel={statusLabel}
            navItems={navItems}
        >
            <section id="documento" className="patient-detail-section mf-section p-6 md:p-8 space-y-5 scroll-mt-40">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                            <FileSearch className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                            <p className="mf-eyebrow">Documento clinico</p>
                            <h2 className="text-xl font-semibold tracking-tight text-slate-950">
                                Usa un documento quando è utile
                            </h2>
                            <p className="max-w-3xl text-sm leading-relaxed text-slate-600">
                                MediFlow propone anagrafica, diagnosi e terapie dal documento: confermi tu cosa usare.
                            </p>
                        </div>
                    </div>
                </div>
                <PdfImporter onDataExtracted={(data) => {
                    const imported = data as ExtractedPatientData;
                    /* @Codex */
                    setPendingImportReview(buildPatientDocumentReviewDraft(imported));
                    setImportMeta({
                        quality: imported.documentQuality,
                        diagnosisCount: imported.reviewDiagnoses?.length || imported.diagnoses?.length || 0,
                        medicationCount: imported.reviewTherapies?.length || imported.medications?.length || 0,
                        reviewPending: true,
                    });
                }} />
            </section>

            {/* @Codex */}
            {importMeta && (
                <section id="controllo" className="space-y-4 scroll-mt-40">
                    <div className={`mf-alert animate-in fade-in slide-in-from-top-4 duration-500 !p-6 ${
                        importMeta.quality?.level === 'red'
                            ? 'mf-alert-critical'
                            : importMeta.quality?.level === 'green'
                                ? 'mf-alert-success'
                                : 'mf-alert-info'
                        }`}>
                        <div className="flex items-start gap-4">
                            <div className="mf-icon-disc h-12 w-12 shrink-0">
                                {importMeta.quality?.level === 'red' ? (
                                    <AlertTriangle className="h-6 w-6 shrink-0" />
                                ) : (
                                    <CheckCircle2 className="h-6 w-6 shrink-0" />
                                )}
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--lume-ink)' }}>
                                    {importMeta.reviewPending ? 'Documento pronto: scegli cosa portare nella scheda' : 'Dati importati nella scheda'}
                                </h3>
                                <p className="text-sm font-medium leading-relaxed" style={{ color: 'var(--lume-ink-muted)' }}>
                                    {importMeta.diagnosisCount > 0
                                        ? `Trovate ${importMeta.diagnosisCount} diagnosi candidate${importMeta.medicationCount > 0 ? ` e ${importMeta.medicationCount} terapie da valutare` : ''}: scegli cosa tenere prima di compilare la scheda.`
                                        : importMeta.medicationCount > 0
                                            ? `Trovate ${importMeta.medicationCount} terapie da valutare: conferma, correggi o escludi prima di portarle nella scheda.`
                                            : 'Il documento è stato letto, ma non contiene dati clinici abbastanza strutturati da proporre automaticamente.'}
                                </p>
                                {importMeta.quality?.reason && (
                                    <p className="mt-2 text-[11px] font-bold uppercase" style={{ color: 'var(--lume-ink-muted)' }}>
                                        Qualità documento: {importMeta.quality.reason}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* @Codex */}
                    {pendingImportReview && (
                        <PatientDocumentImportReview
                            draft={pendingImportReview}
                            onDismiss={() => {
                                setPendingImportReview(null);
                                setImportMeta(null);
                            }}
                            onApply={(reviewedDefaults: ReviewedPatientImportDefaults) => {
                                setImportedData({
                                    firstName: reviewedDefaults.firstName,
                                    lastName: reviewedDefaults.lastName,
                                    taxCode: reviewedDefaults.taxCode,
                                    birthDate: reviewedDefaults.birthDate,
                                    address: reviewedDefaults.address,
                                    phone: reviewedDefaults.phone,
                                    notes: reviewedDefaults.notes,
                                    diagnoses: reviewedDefaults.diagnoses,
                                    therapies: reviewedDefaults.therapies,
                                    servicePrescriptions: reviewedDefaults.servicePrescriptions,
                                });
                                setPendingImportReview(null);
                                setImportMeta((current) => current ? { ...current, reviewPending: false } : current);
                                setFormSeed((current) => current + 1);
                            }}
                        />
                    )}
                </section>
            )}

            <div id="dati" className="scroll-mt-40">
                <PatientForm
                    onSubmit={onSubmit}
                    defaultValues={importedData || undefined}
                    key={`patient-form-${formSeed}-${importedData ? 'loaded' : 'empty'}`}
                />
            </div>
        </Kree8WorkspaceShell>
    );
}
