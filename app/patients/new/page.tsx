'use client';

import { useState } from 'react';
import { db } from '@/lib/db';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { v4 as uuidv4 } from 'uuid';
import PatientForm from '@/components/patient-form';
import PdfImporter from '@/components/pdf-importer';

export default function NewPatientPage() {
    const router = useRouter();
    const [importedData, setImportedData] = useState<Record<string, unknown> | null>(null);

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
                setImportedData({
                    firstName: data.firstName,
                    lastName: data.lastName,
                    taxCode: data.taxCode,
                    birthDate: data.birthDate,
                    address: data.address,
                    notes: data.notes
                });
            }} />

            <PatientForm
                onSubmit={onSubmit}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                defaultValues={(importedData as any) || undefined}
                key={importedData ? 'loaded' : 'empty'}
            />
        </div>
    );
}
