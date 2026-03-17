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
type ImportedPatientDraft = {
    firstName?: string;
    lastName?: string;
    taxCode?: string;
    birthDate?: Date;
    address?: string;
    notes?: string;
    diagnoses?: {
        code: string;
        description: string;
        system: 'ICD-9' | 'ICD-10' | 'ICD-11';
        date: Date;
    }[];
};

export default function NewPatientPage() {
    const router = useRouter();
    const [importedData, setImportedData] = useState<ImportedPatientDraft | null>(null);
    /* @Codex */
    const [importMeta, setImportMeta] = useState<{
        quality?: { level: string; reason?: string };
        diagnosisCount: number;
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

            router.push('/');
        } catch (error) {
            console.error("Failed to save patient", error);
            alert("Errore durante il salvataggio. Controlla i dati e riprova.");
        }
    };

    return (
        <div className="max-w-4xl mx-auto pb-10">
            <div className="mb-6 flex items-center gap-4">
                <Link href="/" className="p-2 hover:bg-white/50 dark:hover:bg-white/10 rounded-full transition-colors">
                    <ArrowLeft className="w-6 h-6 text-gray-600 dark:text-gray-200" />
                </Link>
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Nuovo Paziente</h1>
            </div>

            <PdfImporter onDataExtracted={(data) => {
                const imported = data as ExtractedPatientData;
                /* @Codex */
                setImportedData({
                    firstName: imported.firstName,
                    lastName: imported.lastName,
                    taxCode: imported.taxCode,
                    birthDate: imported.birthDate,
                    address: imported.address,
                    notes: imported.documentSummary || imported.notes,
                    diagnoses: (imported.diagnoses || []).map((diagnosis) => ({
                        code: diagnosis.code,
                        description: diagnosis.description,
                        system: diagnosis.system,
                        date: new Date()
                    }))
                });
                setImportMeta({
                    quality: imported.documentQuality,
                    diagnosisCount: imported.diagnoses?.length || 0
                });
            }} />

            {/* @Codex */}
            {importMeta && (
                <div className={`mb-6 rounded-2xl border p-4 ${importMeta.quality?.level === 'red'
                    ? 'border-red-200 bg-red-50'
                    : importMeta.quality?.level === 'green'
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-amber-200 bg-amber-50'
                    }`}>
                    <div className="flex items-start gap-3">
                        {importMeta.quality?.level === 'red' ? (
                            <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600 shrink-0" />
                        ) : (
                            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600 shrink-0" />
                        )}
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-gray-800">
                                Import documentale completato
                            </p>
                            <p className="text-sm text-gray-700">
                                {importMeta.diagnosisCount > 0
                                    ? `Ho precompilato ${importMeta.diagnosisCount} diagnosi ICD nel form. Verificale e rimuovi quelle non corrette prima di salvare.`
                                    : 'Non sono state precompilate diagnosi ICD esplicite dal documento.'}
                            </p>
                            {importMeta.quality?.reason && (
                                <p className="text-xs text-gray-600">
                                    Qualita documento: {importMeta.quality.reason}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <PatientForm
                onSubmit={onSubmit}
                defaultValues={importedData || undefined}
                key={importedData ? 'loaded' : 'empty'}
            />
        </div>
    );
}
