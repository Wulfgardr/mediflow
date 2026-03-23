'use client';

import { ApiConflictError, db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Trash2, Archive, Download, ShieldAlert, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import PatientForm from '@/components/patient-form';
import { useLiveQuery } from '@/lib/live-query';
import PatientActionModal, { ActionData } from '@/components/patient-action-modal';
import { useState } from 'react';

/* @Codex */
type ValidationSummary = {
    total: number;
    withErrors: number;
    withWarnings: number;
    errorCount: number;
    warningCount: number;
};

/* @Codex */
type ValidatePatientExportResponse = {
    patientId: string;
    hasErrors: boolean;
    hasWarnings: boolean;
    therapyMedication: ValidationSummary;
    observationVitals: ValidationSummary;
};

/* @Codex */
function buildValidationMessage(validation: ValidatePatientExportResponse): string {
    return [
        `Terapie: ${validation.therapyMedication.total} record, ${validation.therapyMedication.errorCount} errori, ${validation.therapyMedication.warningCount} warning`,
        `Osservazioni: ${validation.observationVitals.total} record, ${validation.observationVitals.errorCount} errori, ${validation.observationVitals.warningCount} warning`,
    ].join('\n');
}

/* @Codex */
function messageFromError(error: unknown, fallback: string): string {
    if (error instanceof ApiConflictError) return error.message;
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

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
        if (!patient || typeof patient.version !== 'number') {
            alert("Versione paziente non disponibile. Ricarica la pagina e riprova.");
            return;
        }

        try {
            const { statusReason, checkups, ...cleanData } = data;
            const patientVersion = patient.version;

            await db.patients.update(id, {
                ...cleanData,
                birthDate: new Date(cleanData.birthDate),
                version: patientVersion,
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
            alert(messageFromError(error, "Errore durante l'aggiornamento."));
        }
    };

    const [isActionModalOpen, setIsActionModalOpen] = useState(false);
    const [actionType, setActionType] = useState<'delete' | 'archive' | 'export'>('archive');

    const handleAction = async (data: ActionData) => {
        if (!patient) return;
        if (typeof patient.version !== 'number') {
            alert("Versione paziente non disponibile. Ricarica la pagina e riprova.");
            return;
        }
        const patientVersion = patient.version;

        if (actionType === 'export') {
            try {
                const validationResponse = await fetch(`/api/fse/validate-patient?patientId=${encodeURIComponent(id)}`);
                if (!validationResponse.ok) {
                    throw new Error('Validation pre-check failed');
                }
                const validation = await validationResponse.json() as ValidatePatientExportResponse;

                if (validation.hasErrors) {
                    alert(`Esportazione bloccata: risolvi gli errori di validazione FSE prima del download.\n\n${buildValidationMessage(validation)}`);
                    return;
                }

                if (validation.hasWarnings) {
                    const proceed = confirm(
                        `Sono presenti warning di validazione FSE.\n\n${buildValidationMessage(validation)}\n\nVuoi proseguire comunque con l'export?`,
                    );
                    if (!proceed) return;
                }

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
            try {
                await db.patients.delete(id, { version: patientVersion });
                router.push('/'); // Redirect to dashboard
            } catch (error) {
                alert(messageFromError(error, "Errore durante l'eliminazione."));
            }
        } else { // This is for archive
            try {
                await db.patients.update(id, {
                    isArchived: true,
                    version: patientVersion,
                    updatedAt: new Date()
                });
                router.push('/'); // Redirect to dashboard
            } catch (error) {
                alert(messageFromError(error, "Errore durante l'archiviazione."));
            }
        }
    };

    const handleRestore = async () => {
        if (!confirm("Sei sicuro di voler ripristinare questo paziente tra quelli attivi?")) return;
        if (!patient || typeof patient.version !== 'number') {
            alert("Versione paziente non disponibile. Ricarica la pagina e riprova.");
            return;
        }

        try {
            await db.patients.update(id, {
                isArchived: false,
                version: patient.version,
                updatedAt: new Date()
            });
        } catch (error) {
            alert(messageFromError(error, "Errore durante il ripristino."));
        }
        // Stay on page but refresh UI (automatic via liveQuery)
    };

    if (!patient) return <div className="p-8 text-center text-gray-500">Caricamento...</div>;

    return (
        <div className="max-w-4xl mx-auto pb-20 px-4 md:px-0">
            <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6 pt-4">
                <div className="flex items-center gap-5">
                    <Link href={`/patients/${id}`} className="group p-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-blue-500/50 rounded-2xl transition-all shadow-sm">
                        <ArrowLeft className="w-6 h-6 text-slate-600 dark:text-slate-300 group-hover:text-blue-500 group-hover:-translate-x-1 transition-all" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Modalita modifica</p>
                        </div>
                        <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Modifica Paziente</h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Aggiornamento dati clinici e anagrafici</p>
                    </div>
                </div>
            </div>

            {patient.isArchived && (
                <div className="mb-10 animate-in fade-in slide-in-from-top-4 duration-500 rounded-[28px] border-2 border-amber-200 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-950/20 p-6 flex items-start gap-4 shadow-xl shadow-amber-500/5">
                    <div className="p-3 rounded-2xl bg-amber-100 dark:bg-amber-900/40 text-amber-600">
                        <Archive className="w-6 h-6 shrink-0" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-amber-900 dark:text-amber-200">Paziente Archiviato</h3>
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
                            Questa scheda è attualmente in sola lettura per l&apos;agenda corrente. Ripristina per tornare alle operazioni standard.
                        </p>
                        <button
                            onClick={handleRestore}
                            className="mt-4 text-xs font-black uppercase tracking-widest text-amber-800 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors flex items-center gap-1.5"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
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
            <div className="mt-20 pt-10 border-t border-slate-200 dark:border-white/10">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                        <ShieldAlert className="w-5 h-5 text-red-500" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-red-500/60">Azioni sensibili</p>
                        <h3 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">Zona Pericolo</h3>
                    </div>
                </div>

                <div className="glass-panel p-8 rounded-[32px] border-red-100 dark:border-red-900/20 bg-red-50/30 dark:bg-red-950/5 flex flex-col lg:flex-row items-center justify-between gap-8">
                    <div className="max-w-md">
                        <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Manutenzione Scheda</h4>
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-400 leading-relaxed">
                            Queste operazioni sono irreversibili (Eliminazione) o cambiano lo stato di visibilità globale del paziente nel sistema MediFlow.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-3 w-full lg:w-auto">
                        <button
                            type="button"
                            onClick={() => {
                                setActionType('export');
                                setIsActionModalOpen(true);
                            }}
                            className="flex-1 lg:flex-none px-6 py-3 bg-white dark:bg-white/5 text-blue-600 dark:text-blue-400 font-bold border border-slate-200 dark:border-white/10 rounded-2xl hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95"
                        >
                            <Download className="w-4 h-4" />
                            Export FHIR
                        </button>

                        {!patient.isArchived ? (
                            <button
                                onClick={() => {
                                    setActionType('archive');
                                    setIsActionModalOpen(true);
                                }}
                                className="flex-1 lg:flex-none px-6 py-3 bg-white dark:bg-white/5 text-amber-600 dark:text-amber-400 font-bold border border-amber-200 dark:border-amber-900/30 rounded-2xl hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95"
                            >
                                <Archive className="w-4 h-4" />
                                Archivia
                            </button>
                        ) : (
                            <button
                                onClick={handleRestore}
                                className="flex-1 lg:flex-none px-6 py-3 bg-white dark:bg-white/5 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-200 dark:border-emerald-900/30 rounded-2xl hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95"
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
                            className="flex-1 lg:flex-none px-6 py-3 bg-red-600 text-white font-bold rounded-2xl shadow-xl shadow-red-500/20 hover:bg-red-700 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
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
