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
        <div className="max-w-4xl mx-auto pb-20 px-4 md:px-0">
            <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6 pt-4">
                <div className="flex items-center gap-5">
                    <Link href="/" className="group p-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-blue-500/50 rounded-2xl transition-all shadow-sm">
                        <ArrowLeft className="w-6 h-6 text-slate-600 dark:text-slate-300 group-hover:text-blue-500 group-hover:-translate-x-1 transition-all" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Pazienti</p>
                        </div>
                        <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Nuova Anagrafica</h1>
                    </div>
                </div>
            </div>

            <div className="mb-10">
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
            </div>

            {/* @Codex */}
            {importMeta && (
                <div className={`mb-10 animate-in fade-in slide-in-from-top-4 duration-500 rounded-[28px] border-2 p-6 shadow-xl ${
                    importMeta.quality?.level === 'red'
                        ? 'border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-950/20 shadow-red-500/5'
                        : importMeta.quality?.level === 'green'
                            ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/30 dark:bg-emerald-950/20 shadow-emerald-500/5'
                            : 'border-blue-200 bg-blue-50/50 dark:border-blue-900/30 dark:bg-blue-950/20 shadow-blue-500/5'
                    }`}>
                    <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-2xl ${
                            importMeta.quality?.level === 'red' ? 'bg-red-100 dark:bg-red-900/40 text-red-600' : 
                            importMeta.quality?.level === 'green' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600' : 
                            'bg-blue-100 dark:bg-blue-900/40 text-blue-600'
                        }`}>
                            {importMeta.quality?.level === 'red' ? (
                                <AlertTriangle className="h-6 w-6 shrink-0" />
                            ) : (
                                <CheckCircle2 className="h-6 w-6 shrink-0" />
                            )}
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                Importazione assistita completata
                            </h3>
                            <p className="text-sm font-medium text-slate-600 dark:text-slate-400 leading-relaxed">
                                {importMeta.diagnosisCount > 0
                                    ? `Sono stati estratti ${importMeta.diagnosisCount} quesiti diagnostici. Verificare la correttezza della codifica ICD prima della conferma finale.`
                                    : 'Il documento è stato analizzato correttamente, ma non sono state individuate diagnosi codificabili automaticamente.'}
                            </p>
                            {importMeta.quality?.reason && (
                                <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 mt-2 uppercase tracking-wide">
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
