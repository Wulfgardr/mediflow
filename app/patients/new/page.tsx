'use client';

import { useState } from 'react';
import { db } from '@/lib/db';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, FileSearch } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import PatientForm from '@/components/patient-form';
import PdfImporter from '@/components/pdf-importer';
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

    const statusLabel = pendingImportReview
        ? 'Documento pronto: scegli cosa portare nella scheda.'
        : importedData
            ? 'Dati applicati alla scheda: controlla i campi e conferma.'
            : 'Nessun dato è stato salvato: la scheda viene creata solo quando confermi.';

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
            subtitle="Crea una scheda partendo da un documento clinico oppure inserendo i dati manualmente. Ogni dato importato passa da un controllo prima del salvataggio."
            backHref="/"
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
                                PDF e immagini vengono letti localmente. MediFlow propone dati anagrafici,
                                diagnosi e terapie, ma non scrive nulla finché non confermi cosa usare.
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
                                <h3 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--mf-ink)' }}>
                                    {importMeta.reviewPending ? 'Documento pronto: scegli cosa portare nella scheda' : 'Dati importati nella scheda'}
                                </h3>
                                <p className="text-sm font-medium leading-relaxed" style={{ color: 'var(--mf-muted)' }}>
                                    {importMeta.diagnosisCount > 0
                                        ? `Ho trovato ${importMeta.diagnosisCount} diagnosi candidate${importMeta.medicationCount > 0 ? ` e ${importMeta.medicationCount} terapie da valutare` : ''}. Controlla cosa tenere prima di compilare la scheda.`
                                        : importMeta.medicationCount > 0
                                            ? `Ho trovato ${importMeta.medicationCount} terapie da valutare. Conferma, correggi o escludi le terapie prima di portarle nella scheda.`
                                            : 'Il documento è stato letto, ma non contiene dati clinici abbastanza strutturati da proporre automaticamente.'}
                                </p>
                                {importMeta.quality?.reason && (
                                    <p className="mt-2 text-[11px] font-bold uppercase" style={{ color: 'var(--mf-muted)' }}>
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
