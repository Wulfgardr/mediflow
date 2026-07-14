'use client';

import { useState } from 'react';
import { Trash2, Archive, AlertTriangle, Check } from 'lucide-react';

import { Modal, type ModalAccent } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-provider';

type ActionType = 'delete' | 'archive' | 'export';
type ArchiveReason = 'assigned_mmg' | 'deceased' | 'other';

interface PatientActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (data: ActionData) => Promise<void>;
    patientName: string;
    actionType: ActionType;
}

export interface ActionData {
    deletionReason?: string;
    archiveReason?: ArchiveReason;
    archiveNote?: string;
}

export default function PatientActionModal({ isOpen, onClose, onConfirm, patientName, actionType }: PatientActionModalProps) {
    const [deletionReason, setDeletionReason] = useState('');
    const [archiveReason, setArchiveReason] = useState<ArchiveReason>('assigned_mmg');
    const [archiveNote, setArchiveNote] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { showToast } = useToast();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await onConfirm({
                deletionReason: actionType === 'delete' ? deletionReason : undefined,
                archiveReason: actionType === 'archive' ? archiveReason : undefined,
                archiveNote: actionType === 'archive' && archiveReason === 'other' ? archiveNote : undefined
            });
            onClose();
        } catch (err) {
            console.error(err);
            /* @Codex WUL-UIUX (STREAM E): l'errore non deve piu sparire in console:
               l'utente vedeva la modale restare aperta senza spiegazioni. */
            showToast({
                title: 'Operazione non riuscita',
                description: 'Riprova o controlla lo stato della scheda.',
                tone: 'error',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const isDelete = actionType === 'delete';
    const isExport = actionType === 'export';

    const accent: ModalAccent = isDelete ? 'critical' : isExport ? 'primary' : 'warning';
    const accentVar = accent === 'critical'
        ? 'var(--lume-signal-critical)'
        : accent === 'warning'
            ? 'var(--lume-signal-warning)'
            : 'var(--lume-accent)';
    const icon = isDelete ? <Trash2 className="h-5 w-5" /> : isExport ? <Check className="h-5 w-5" /> : <Archive className="h-5 w-5" />;
    const title = isDelete ? 'Elimina scheda' : isExport ? 'Esporta FHIR con controllo FSE' : 'Archivia scheda';

    return (
        // @Codex WUL-229: patient action modal aligned with the Lume overlay recipe.
        <Modal
            open={isOpen}
            onClose={onClose}
            title={title}
            subtitle={patientName}
            icon={icon}
            accent={accent}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                {isDelete ? (
                    <div className="space-y-3">
                        <div className="mf-alert mf-alert-critical">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <p>
                                Il paziente verrà spostato nel <strong>Cestino</strong> e potrà essere ripristinato da lì.
                            </p>
                        </div>
                        <div>
                            <label className="mf-field-label">Motivazione eliminazione <span style={{ color: 'var(--lume-signal-critical)' }}>*</span></label>
                            <textarea
                                required
                                value={deletionReason}
                                onChange={(e) => setDeletionReason(e.target.value)}
                                className="mf-input"
                                rows={3}
                                placeholder="Es. Errore di inserimento, duplicato..."
                            />
                        </div>
                    </div>
                ) : isExport ? (
                    <div className="space-y-3">
                        <div className="mf-alert mf-alert-info">
                            <Check className="w-4 h-4 mt-0.5 shrink-0" />
                            <div>
                                <p>Verrà generato un file <strong>FHIR JSON</strong> dopo il controllo FSE. Gli errori bloccanti fermano il download; i warning chiedono una conferma.</p>
                                <ul className="list-disc ml-4 mt-1 opacity-80">
                                    <li>Anagrafica paziente</li>
                                    <li>Diagnosi registrate</li>
                                    <li>Note e visite</li>
                                    <li>Terapie e valutazioni</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="mf-alert mf-alert-warning">
                            <Archive className="w-4 h-4 mt-0.5 shrink-0" />
                            <p>
                                Il paziente verrà rimosso dalla lista attiva e spostato in archivio. Potrai trovarlo tramite ricerca.
                            </p>
                        </div>

                        <div>
                            <label className="mf-field-label">Motivo archiviazione</label>
                            <select
                                value={archiveReason}
                                onChange={(e) => setArchiveReason(e.target.value as ArchiveReason)}
                                className="mf-input mf-input-sm appearance-none cursor-pointer"
                                aria-label="Seleziona motivazione archiviazione"
                            >
                                <option value="assigned_mmg">Assegnato a MMG</option>
                                <option value="deceased">Decesso</option>
                                <option value="other">Altro</option>
                            </select>
                        </div>

                        {archiveReason === 'other' && (
                            <div className="animate-in slide-in-from-top-1 fade-in">
                                <label className="mf-field-label">Specifica altro <span style={{ color: 'var(--lume-signal-warning)' }}>*</span></label>
                                <textarea
                                    required
                                    value={archiveNote}
                                    onChange={(e) => setArchiveNote(e.target.value)}
                                    className="mf-input"
                                    rows={2}
                                    placeholder="Specifica il motivo..."
                                />
                            </div>
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-5 graphite-divider mt-6">
                    <Button variant="secondary" onClick={onClose}>
                        Annulla
                    </Button>
                    <Button
                        type="submit"
                        disabled={isSubmitting}
                        className="inline-flex items-center gap-2"
                        style={{ background: accentVar }}
                    >
                        {isSubmitting ? 'Elaborazione...' : (
                            <>
                                {isDelete ? <Trash2 className="w-4 h-4" /> : isExport ? <Check className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                                {isDelete ? 'Sposta nel cestino' : isExport ? 'Scarica FHIR JSON' : 'Archivia'}
                            </>
                        )}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
