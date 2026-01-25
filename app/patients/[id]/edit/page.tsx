'use client';

import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save, Trash2, Archive, Download, AlertTriangle, ShieldAlert, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import PatientForm from '@/components/patient-form';
import { useLiveQuery } from 'dexie-react-hooks';
import PatientActionModal, { ActionData } from '@/components/patient-action-modal';
import { useState } from 'react';

export default function EditPatientPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;

    const patient = useLiveQuery(async () => {
        const p = await db.patients.get(id);
        if (!p) return null;

        // Fetch relations
        const checkups = await db.checkups.filter((c: any) => c.patientId === id).toArray();
        return { ...p, checkups };
    }, [id]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onSubmit = async (data: any) => {
        try {
            const { statusReason, checkups, ...cleanData } = data;

            await db.patients.update(id, {
                ...cleanData,
                birthDate: new Date(cleanData.birthDate),
                updatedAt: new Date(),
            });

            // Handle Checkups (Diffing)
            // 1. Get current IDs to find deletions
            const existingCheckups = await db.checkups.filter((c: any) => c.patientId === id).toArray();
            const existingIds = new Set(existingCheckups.map(c => c.id));
            const comingIds = new Set(checkups.filter((c: any) => c.id).map((c: any) => c.id));

            // Delete removed
            const toDelete = existingCheckups.filter(c => !comingIds.has(c.id)).map(c => c.id);
            if (toDelete.length > 0) {
                await db.checkups.bulkDelete(toDelete);
            }

            // Upsert
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toPut = checkups.map((c: any) => ({
                id: c.id || uuidv4(),
                patientId: id,
                date: new Date(c.date),
                title: c.title,
                notes: c.notes,
                status: c.status || 'pending',
                source: c.source || 'manual',
                createdAt: c.id ? existingCheckups.find(ex => ex.id === c.id)?.createdAt || new Date() : new Date()
            }));

            if (toPut.length > 0) {
                await db.checkups.bulkPut(toPut);
            }

            router.push(`/patients/${id}`);
        } catch (error) {
            console.error("Failed to update patient", error);
            alert("Errore durante l'aggiornamento.");
        }
    };

    const [isActionModalOpen, setIsActionModalOpen] = useState(false);
    const [actionType, setActionType] = useState<'delete' | 'archive' | 'export'>('archive');

    const handleAction = async (data: ActionData) => {
        if (!patient) return;

        if (actionType === 'export') {
            try {
                // Dynamic import for bundle generator
                const { generatePatientBundle } = await import('@/lib/fhir/bundle-generator');
                const bundle = await generatePatientBundle(id);

                const jsonString = JSON.stringify(bundle, null, 2);
                const blob = new Blob([jsonString], { type: 'application/json' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                a.download = `patient-${patient?.lastName}-${patient?.firstName}-fhir.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                alert("Esportazione FHIR completata con successo!");
            } catch (error) {
                console.error("Export failed", error);
                alert("Errore durante l'esportazione.");
            }
            return;
        }

        if (actionType === 'delete') {
            await db.patients.delete(id);
            router.push('/'); // Redirect to dashboard
        } else { // This is for archive
            await db.patients.update(id, {
                isArchived: true,
                updatedAt: new Date()
            });
            router.push('/'); // Redirect to dashboard
        }
    };

    const handleRestore = async () => {
        if (!confirm("Sei sicuro di voler ripristinare questo paziente tra quelli attivi?")) return;

        await db.patients.update(id, {
            isArchived: false,
            updatedAt: new Date()
        });
        // Stay on page but refresh UI (automatic via liveQuery)
    };

    if (!patient) return <div className="p-8 text-center text-gray-500">Caricamento...</div>;

    return (
        <div className="max-w-4xl mx-auto pb-10">
            <div className="mb-6 flex items-center gap-4">
                <Link href={`/patients/${id}`} className="p-2 hover:bg-white/50 rounded-full transition-colors">
                    <ArrowLeft className="w-6 h-6 text-gray-600" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Modifica Paziente</h1>
                    <p className="text-gray-500 text-sm">Aggiorna le informazioni anagrafiche e di contatto</p>
                </div>
            </div>

            {patient.isArchived && (
                <div className="mb-8 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                    <Archive className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                        <h3 className="font-bold text-amber-800">Paziente Archiviato</h3>
                        <p className="text-sm text-amber-700 mt-1">
                            Questo paziente è attualmente in archivio.
                        </p>
                        <button
                            onClick={handleRestore}
                            className="mt-3 text-sm font-semibold text-amber-700 hover:text-amber-800 underline"
                        >
                            Ripristina in elenco Attivi
                        </button>
                    </div>
                </div>
            )}

            <PatientForm
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                defaultValues={patient as any}
                onSubmit={onSubmit}
                isEditMode={true}
            />

            {/* Danger Zone */}
            <div className="mt-12 pt-8 border-t border-gray-200">
                <h3 className="text-lg font-bold text-red-600 flex items-center gap-2 mb-4">
                    <ShieldAlert className="w-5 h-5" />
                    Zona Pericolo
                </h3>

                <div className="bg-red-50 p-6 rounded-2xl border border-red-100 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div>
                        <h4 className="font-bold text-gray-800">Gestione Stato Paziente</h4>
                        <p className="text-sm text-gray-600 mt-1">
                            Puoi archiviare il paziente se non è più in carico, oppure eliminarlo (spostandolo nel cestino).
                        </p>
                    </div>

                    <div className="flex gap-3 w-full md:w-auto">
                        <button
                            type="button"
                            onClick={() => {
                                setActionType('export');
                                setIsActionModalOpen(true);
                            }}
                            className="px-4 py-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors border border-blue-200 flex items-center gap-2"
                        >
                            <Download className="w-4 h-4" />
                            JSON
                        </button>

                        {!patient.isArchived ? (
                            <button
                                onClick={() => {
                                    setActionType('archive');
                                    setIsActionModalOpen(true);
                                }}
                                className="flex-1 md:flex-none px-4 py-2 bg-white text-amber-600 font-bold border-2 border-amber-200 rounded-xl hover:bg-amber-50 hover:border-amber-300 transition-all flex items-center justify-center gap-2"
                            >
                                <Archive className="w-4 h-4" />
                                Archivia
                            </button>
                        ) : (
                            <button
                                onClick={handleRestore}
                                className="flex-1 md:flex-none px-4 py-2 bg-white text-green-600 font-bold border-2 border-green-200 rounded-xl hover:bg-green-50 hover:border-green-300 transition-all flex items-center justify-center gap-2"
                            >
                                <RotateCcw className="w-4 h-4" />
                                Ripristina
                            </button>
                        )}
                        <button
                            onClick={() => {
                                setActionType('delete');
                                setIsActionModalOpen(true);
                            }}
                            className="flex-1 md:flex-none px-4 py-2 bg-red-600 text-white font-bold rounded-xl shadow-lg shadow-red-500/20 hover:bg-red-700 hover:scale-105 transition-all flex items-center justify-center gap-2"
                        >
                            <Trash2 className="w-4 h-4" />
                            Elimina
                        </button>
                    </div>
                </div>
            </div>

            <PatientActionModal
                isOpen={isActionModalOpen}
                onClose={() => setIsActionModalOpen(false)}
                onConfirm={handleAction}
                patientName={`${patient.firstName} ${patient.lastName}`}
                actionType={actionType}
            />
        </div>
    );
}
