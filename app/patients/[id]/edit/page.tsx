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
import { buildValidationMessage, type ValidatePatientExportResponse } from '@/lib/fse-validate-patient-contract';

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

    if (!patient) return <div className="mf-section mx-auto mt-8 max-w-md text-center text-sm" style={{ color: 'var(--mf-muted)' }}>Caricamento...</div>;

    return (
        <div className="max-w-4xl mx-auto pb-20 px-4 md:px-0">
            <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6 pt-4">
                <div className="flex items-center gap-5">
                    {/* @Codex WUL-229 — edit header uses shared liquid controls */}
                    <Link href={`/patients/${id}`} className="mf-btn-secondary !h-12 !w-12 !p-0" aria-label="Torna alla scheda paziente">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="w-2 h-2 rounded-full bg-[color:var(--mf-primary)]" />
                            <p className="mf-eyebrow">Modalita modifica</p>
                        </div>
                        <h1 className="text-3xl font-black tracking-tight" style={{ color: 'var(--mf-ink)' }}>Modifica Paziente</h1>
                        <p className="text-sm font-medium" style={{ color: 'var(--mf-muted)' }}>Aggiornamento dati clinici e anagrafici</p>
                    </div>
                </div>
            </div>

            {patient.isArchived && (
                <div className="mf-alert mf-alert-warning mb-10 !flex items-start gap-4 !p-6 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="mf-icon-disc h-12 w-12 shrink-0 !text-[color:var(--mf-warning)]">
                        <Archive className="w-6 h-6 shrink-0" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold" style={{ color: 'var(--mf-ink)' }}>Paziente Archiviato</h3>
                        <p className="mt-1 text-sm font-medium leading-relaxed" style={{ color: 'var(--mf-muted)' }}>
                            Questa scheda è attualmente in sola lettura per l&apos;agenda corrente. Ripristina per tornare alle operazioni standard.
                        </p>
                        <button
                            onClick={handleRestore}
                            className="mf-btn-secondary mt-4 !text-[color:var(--mf-warning)]"
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
            <div className="mt-20 border-t border-[color:rgba(112,106,100,0.12)] pt-10">
                <div className="flex items-center gap-3 mb-8">
                    <div className="mf-icon-disc h-10 w-10 !text-[color:var(--mf-critical)]">
                        <ShieldAlert className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="mf-eyebrow !text-[color:var(--mf-critical)]">Azioni sensibili</p>
                        <h3 className="text-xl font-black tracking-tight" style={{ color: 'var(--mf-ink)' }}>Zona Pericolo</h3>
                    </div>
                </div>

                <div className="mf-section flex flex-col items-center justify-between gap-8 border-[color:rgba(163,58,47,0.22)] p-8 lg:flex-row">
                    <div className="max-w-md">
                        <h4 className="mb-2 text-lg font-bold" style={{ color: 'var(--mf-ink)' }}>Manutenzione Scheda</h4>
                        <p className="text-sm font-medium leading-relaxed" style={{ color: 'var(--mf-muted)' }}>
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
                            className="mf-btn-secondary flex-1 lg:flex-none"
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
                                className="mf-btn-secondary flex-1 !text-[color:var(--mf-warning)] lg:flex-none"
                            >
                                <Archive className="w-4 h-4" />
                                Archivia
                            </button>
                        ) : (
                            <button
                                onClick={handleRestore}
                                className="mf-btn-secondary flex-1 !text-[color:var(--mf-success)] lg:flex-none"
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
                            className="ui-btn-primary mf-tone-critical flex-1 px-6 py-3 lg:flex-none"
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
