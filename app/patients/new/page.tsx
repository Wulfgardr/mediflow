'use client';

import { useState } from 'react';
import { db } from '@/lib/db';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { v4 as uuidv4 } from 'uuid';
import PatientForm from '@/components/patient-form';
import PdfImporter from '@/components/pdf-importer';
import type { ExtractedPatientData } from '@/lib/pdf-service';
/* @Codex */
import PatientDocumentImportReview from '@/components/patient-document-import-review';
/* @Codex */
import {
    buildPatientDocumentReviewDraft,
    type PatientDocumentReviewDraft,
    type ReviewedPatientImportDefaults,
} from '@/lib/patient-document-review';

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
};

export default function NewPatientPage() {
    const router = useRouter();
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
                    const confirmMsg = `Attenzione: Esiste già un paziente con questo Codice Fiscale.\n\n${existing.lastName} ${existing.firstName}\nID: ${existing.id}\n\nVuoi aprire la scheda esistente invece di crearne una nuova?`;
                    if (confirm(confirmMsg)) {
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

            router.push('/');
        } catch (error) {
            console.error("Failed to save patient", error);
            alert("Errore durante il salvataggio. Controlla i dati e riprova.");
        }
    };

    return (
        <div className="max-w-4xl mx-auto pb-20 px-4 md:px-0">
            <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6 pt-4">
                <div className="flex items-center gap-5">
                    {/* @Codex WUL-229 — patient creation header follows the liquid command surface */}
                    <Link href="/" className="mf-btn-secondary !h-12 !w-12 !p-0" aria-label="Torna alla home">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="w-2 h-2 rounded-full bg-[color:var(--mf-primary)]" />
                            <p className="mf-eyebrow">Pazienti</p>
                        </div>
                        <h1 className="text-3xl font-black tracking-tight" style={{ color: 'var(--mf-ink)' }}>Nuova Anagrafica</h1>
                    </div>
                </div>
            </div>

            <div className="mb-10">
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
            </div>

            {/* @Codex */}
            {importMeta && (
                <div className={`mf-alert mb-10 animate-in fade-in slide-in-from-top-4 duration-500 !p-6 ${
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
                            <h3 className="text-lg font-bold" style={{ color: 'var(--mf-ink)' }}>
                                {importMeta.reviewPending ? 'Importazione assistita pronta per review' : 'Importazione assistita applicata al form'}
                            </h3>
                            <p className="text-sm font-medium leading-relaxed" style={{ color: 'var(--mf-muted)' }}>
                                {importMeta.diagnosisCount > 0
                                    ? `Sono stati estratti ${importMeta.diagnosisCount} quesiti diagnostici${importMeta.medicationCount > 0 ? ` e ${importMeta.medicationCount} terapie candidate` : ''}. Verificare i contenuti nel passaggio intermedio prima della conferma finale.`
                                    : importMeta.medicationCount > 0
                                        ? `Sono state estratte ${importMeta.medicationCount} terapie candidate. Conferma o correggi i gruppi proposti prima di applicarli al form.`
                                        : 'Il documento è stato analizzato correttamente, ma non sono stati individuati campi clinici strutturabili automaticamente.'}
                            </p>
                            {importMeta.quality?.reason && (
                                <p className="mt-2 text-[11px] font-bold uppercase" style={{ color: 'var(--mf-muted)' }}>
                                    Qualita documento: {importMeta.quality.reason}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

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
                        });
                        setPendingImportReview(null);
                        setImportMeta((current) => current ? { ...current, reviewPending: false } : current);
                        setFormSeed((current) => current + 1);
                    }}
                />
            )}

            <PatientForm
                onSubmit={onSubmit}
                defaultValues={importedData || undefined}
                key={`patient-form-${formSeed}-${importedData ? 'loaded' : 'empty'}`}
            />
        </div>
    );
}
