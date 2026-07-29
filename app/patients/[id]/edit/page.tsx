'use client';

import { ApiConflictError, db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { useRouter, useParams } from 'next/navigation';
import { Trash2, Archive, Download, ShieldAlert, RotateCcw } from 'lucide-react';
import PatientForm from '@/components/patient-form';
import { useLiveQuery } from '@/lib/live-query';
import PatientActionModal, { ActionData } from '@/components/patient-action-modal';
import { useState } from 'react';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
/* @Codex */
import { Kree8WorkspaceShell, type Kree8WorkspaceNavItem } from '@/components/kree8/kree8-workspace-shell';
import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';
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
    const { showToast } = useToast();
    const confirm = useConfirm();

    /* @Codex */
    const patient = useLiveQuery(async () => {
        const p = await db.patients.get(id);
        if (!p) return null;

        // Fetch relations
        const checkups = await db.checkups.filter((c: any) => c.patientId === id).toArray();
        return { ...p, checkups };
    }, [id], undefined, ['patients', 'checkups']);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onSubmit = async (data: any) => {
        if (!patient || typeof patient.version !== 'number') {
            showToast({ tone: 'error', title: 'Versione paziente non disponibile', description: 'Ricarica la pagina e riprova.' });
            return;
        }

        try {
            /* @Codex */
            const { checkups, ...cleanData } = data;
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
            const existingCheckupById = new Map(existingCheckups.map(c => [c.id, c]));
            const comingIds = new Set(checkups.filter((c: any) => c.id).map((c: any) => c.id));

            // Delete removed
            const toDelete = existingCheckups.filter(c => !comingIds.has(c.id)).map(c => c.id);
            if (toDelete.length > 0) {
                await db.checkups.bulkDelete(toDelete);
            }

            // Upsert
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const checkupWrites = checkups.map((c: any) => {
                const existingCheckup = c.id ? existingCheckupById.get(c.id) : undefined;
                return {
                    id: c.id || uuidv4(),
                    patientId: id,
                    date: new Date(c.date),
                    title: c.title,
                    notes: c.notes,
                    status: c.status || 'pending',
                    source: c.source || 'manual',
                    createdAt: existingCheckup?.createdAt || new Date(),
                    version: existingCheckup?.version,
                };
            });

            const toUpdate = checkupWrites.filter((c: typeof checkupWrites[number]) => existingCheckupById.has(c.id));
            for (const checkup of toUpdate) {
                if (typeof checkup.version !== 'number') {
                    throw new Error('Versione controllo non disponibile. Ricarica la pagina e riprova.');
                }
                await db.checkups.update(checkup.id, {
                    date: checkup.date,
                    title: checkup.title,
                    notes: checkup.notes,
                    status: checkup.status,
                    source: checkup.source,
                    version: checkup.version,
                });
            }

            const toCreate = checkupWrites.filter((c: typeof checkupWrites[number]) => !existingCheckupById.has(c.id));
            if (toCreate.length > 0) {
                await db.checkups.bulkPut(toCreate);
            }

            router.push(`/patients/${id}`);
        } catch (error) {
            console.error("Failed to update patient", error);
            showToast({ tone: 'error', title: 'Aggiornamento non riuscito', description: messageFromError(error, "Errore durante l'aggiornamento.") });
        }
    };

    const [isActionModalOpen, setIsActionModalOpen] = useState(false);
    const [actionType, setActionType] = useState<'delete' | 'archive' | 'export'>('archive');

    const handleAction = async (data: ActionData) => {
        if (!patient) return;
        if (typeof patient.version !== 'number') {
            showToast({ tone: 'error', title: 'Versione paziente non disponibile', description: 'Ricarica la pagina e riprova.' });
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
                    showToast({ tone: 'error', title: 'Esportazione bloccata', description: `Risolvi gli errori di validazione FSE prima del download. ${buildValidationMessage(validation)}` });
                    return;
                }

                if (validation.hasWarnings) {
                    const { confirmed } = await confirm({
                        title: 'Warning di validazione FSE',
                        message: `${buildValidationMessage(validation)}\n\nVuoi proseguire comunque con l'export?`,
                        confirmLabel: 'Prosegui',
                        cancelLabel: 'Annulla',
                    });
                    if (!confirmed) return;
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

                showToast({ tone: 'success', title: 'Esportazione FHIR completata' });
            } catch (error) {
                console.error("Export failed", error);
                showToast({ tone: 'error', title: 'Errore durante l\'esportazione' });
            }
            return;
        }

        if (actionType === 'delete') {
            try {
                await db.patients.delete(id, {
                    version: patientVersion,
                    deletionReason: data.deletionReason,
                });
                router.push('/'); // Redirect to dashboard
            } catch (error) {
                showToast({ tone: 'error', title: 'Eliminazione non riuscita', description: messageFromError(error, "Errore durante l'eliminazione.") });
            }
        } else { // This is for archive
            try {
                await db.patients.update(id, {
                    isArchived: true,
                    archiveReason: data.archiveReason,
                    archiveNote: data.archiveNote ?? null,
                    version: patientVersion,
                    updatedAt: new Date()
                });
                router.push('/'); // Redirect to dashboard
            } catch (error) {
                showToast({ tone: 'error', title: 'Archiviazione non riuscita', description: messageFromError(error, "Errore durante l'archiviazione.") });
            }
        }
    };

    const handleRestore = async () => {
        const { confirmed } = await confirm({
            title: 'Riattivare il paziente?',
            message: 'Il paziente tornerà tra quelli attivi.',
            confirmLabel: 'Riattiva',
            cancelLabel: 'Annulla',
        });
        if (!confirmed) return;
        if (!patient || typeof patient.version !== 'number') {
            showToast({ tone: 'error', title: 'Versione paziente non disponibile', description: 'Ricarica la pagina e riprova.' });
            return;
        }

        try {
            await db.patients.update(id, {
                isArchived: false,
                version: patient.version,
                updatedAt: new Date()
            });
        } catch (error) {
            showToast({ tone: 'error', title: 'Ripristino non riuscito', description: messageFromError(error, "Errore durante il ripristino.") });
        }
        // Stay on page but refresh UI (automatic via liveQuery)
    };

    const workspaceNavItems: Kree8WorkspaceNavItem[] = [
        { href: '#dati', label: 'Dati' },
        { href: '#azioni', label: 'Azioni' },
    ];

    if (!patient) {
        return (
            <Kree8WorkspaceShell
                eyebrow="Scheda paziente"
                title="Modifica dati"
                subtitle="Caricamento della scheda in corso."
                backHref={`/patients/${id}/modules`}
                backLabel="Torna alla scheda paziente"
                navItems={[]}
            >
                <div className={workspaceStyles.loadingCard}>Caricamento scheda...</div>
            </Kree8WorkspaceShell>
        );
    }

    return (
        <Kree8WorkspaceShell
            eyebrow="Scheda paziente"
            title="Modifica dati"
            subtitle="Aggiorna anagrafica, contatti, diagnosi, agenda e profilo assistenziale."
            backHref={`/patients/${id}/modules`}
            backLabel="Torna alla scheda paziente"
            patientLabel={`${patient.lastName} ${patient.firstName}`}
            navItems={workspaceNavItems}
        >
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-8">
                {patient.isArchived && (
                    <div className="mf-alert mf-alert-warning !flex items-start gap-4 !p-6 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="mf-icon-disc h-12 w-12 shrink-0 !text-[color:var(--lume-signal-warning)]">
                            <Archive className="w-6 h-6 shrink-0" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold" style={{ color: 'var(--lume-ink)' }}>Paziente archiviato</h3>
                            <p className="mt-1 text-sm font-medium leading-relaxed" style={{ color: 'var(--lume-ink-muted)' }}>
                                Questa scheda è attualmente in sola lettura per l&apos;agenda corrente. Riattiva per tornare alle operazioni standard.
                            </p>
                            {patient.archiveReason && (
                                <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>
                                    Motivo: {patient.archiveReason === 'assigned_mmg' ? 'Assegnato a MMG' : patient.archiveReason === 'deceased' ? 'Decesso' : 'Altro'}
                                </p>
                            )}
                            {patient.archiveNote && (
                                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--lume-ink-muted)' }}>
                                    {patient.archiveNote}
                                </p>
                            )}
                            <button
                                onClick={handleRestore}
                                className="mf-btn-secondary mt-4 !text-[color:var(--lume-signal-warning)]"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Riattiva in elenco Attivi
                            </button>
                        </div>
                    </div>
                )}

                <div id="dati" className={workspaceStyles.anchorStack}>
                    <PatientForm
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        defaultValues={patient as any}
                        onSubmit={onSubmit}
                        isEditMode={true}
                    />
                </div>

                <div id="azioni" className="border-t border-[color:rgba(112,106,100,0.12)] pt-6">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="mf-icon-disc h-10 w-10 !text-[color:var(--lume-signal-critical)]">
                            <ShieldAlert className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="mf-eyebrow !text-[color:var(--lume-signal-critical)]">Azioni sensibili</p>
                            <h3 className="text-xl font-black tracking-tight" style={{ color: 'var(--lume-ink)' }}>Stato scheda ed export</h3>
                        </div>
                    </div>

                    <div className="mf-section flex flex-col items-center justify-between gap-8 border-[color:rgba(163,58,47,0.22)] p-8 lg:flex-row">
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
                                Esporta FHIR
                            </button>

                            {!patient.isArchived ? (
                                <button
                                    onClick={() => {
                                        setActionType('archive');
                                        setIsActionModalOpen(true);
                                    }}
                                    className="mf-btn-secondary flex-1 !text-[color:var(--lume-signal-warning)] lg:flex-none"
                                >
                                    <Archive className="w-4 h-4" />
                                    Archivia
                                </button>
                            ) : (
                                <button
                                    onClick={handleRestore}
                                    className="mf-btn-secondary flex-1 !text-[color:var(--lume-signal-success)] lg:flex-none"
                                >
                                    <RotateCcw className="w-4 h-4" />
                                    Riattiva
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
        </Kree8WorkspaceShell>
    );
}
