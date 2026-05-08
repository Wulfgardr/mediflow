'use client';

import { useState } from 'react';
import { Trash2, Archive, AlertTriangle, Check, X } from 'lucide-react';

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

    if (!isOpen) return null;

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
        } finally {
            setIsSubmitting(false);
        }
    };

    const isDelete = actionType === 'delete';
    const isExport = actionType === 'export';

    const accentVar = isDelete ? 'var(--mf-critical)' : isExport ? 'var(--mf-primary)' : 'var(--mf-warning)';
    const accentTint = isDelete ? 'rgba(192, 57, 43, 0.12)' : isExport ? 'rgba(15, 123, 104, 0.12)' : 'rgba(202, 138, 4, 0.16)';

    return (
        // @Codex WUL-229 — patient action modal aligned with specular tier
        <div className="mf-modal-backdrop animate-in fade-in duration-200">
            <button
                type="button"
                aria-label="Chiudi sfondo"
                className="absolute inset-0 cursor-default"
                onClick={onClose}
            />

            <div className="mf-modal-shell relative w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div
                    aria-hidden="true"
                    className="h-1.5 w-full"
                    style={{ background: accentVar }}
                />
                <div className="p-6">
                    <div className="flex items-center justify-between gap-4 mb-5">
                        <div className="flex items-center gap-3">
                            <div
                                className="p-3 rounded-2xl flex items-center justify-center shrink-0"
                                style={{ background: accentTint, color: accentVar }}
                            >
                                {isDelete ? <Trash2 className="w-5 h-5" /> : isExport ? <Check className="w-5 h-5" /> : <Archive className="w-5 h-5" />}
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--mf-ink)' }}>
                                    {isDelete ? 'Elimina Paziente' : isExport ? 'Export FHIR (pre-check FSE)' : 'Archivia Paziente'}
                                </h3>
                                <p className="text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>
                                    {patientName}
                                </p>
                            </div>
                        </div>
                        <button onClick={onClose} className="mf-btn-secondary !p-2 !rounded-full" title="Chiudi" aria-label="Chiudi">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {isDelete ? (
                            <div className="space-y-3">
                                <div className="mf-alert mf-alert-critical">
                                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                    <p>
                                        Il paziente verrà spostato nel <strong>Cestino</strong>.
                                        Potrai ripristinarlo entro 30 giorni, dopodiché verrà eliminato definitivamente.
                                    </p>
                                </div>
                                <div>
                                    <label className="mf-field-label">Motivazione Eliminazione <span style={{ color: 'var(--mf-critical)' }}>*</span></label>
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
                                        <p>Verrà generato un file <strong>FHIR JSON</strong> con pre-check FSE (errori bloccanti, warning confermabili), contenente:</p>
                                        <ul className="list-disc ml-4 mt-1 opacity-80">
                                            <li>Anagrafica Paziente</li>
                                            <li>Storia Diagnostica</li>
                                            <li>Note e Visite</li>
                                            <li>Terapie e Valutazioni</li>
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
                                    <label className="mf-field-label">Motivo Archiviazione</label>
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
                                        <label className="mf-field-label">Specifica Altro <span style={{ color: 'var(--mf-warning)' }}>*</span></label>
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
                            <button
                                type="button"
                                onClick={onClose}
                                className="mf-btn-secondary"
                            >
                                Annulla
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="ui-btn-primary px-5 py-2.5 disabled:opacity-50 inline-flex items-center gap-2"
                                style={{ background: accentVar }}
                            >
                                {isSubmitting ? 'Elaborazione...' : (
                                    <>
                                        {isDelete ? <Trash2 className="w-4 h-4" /> : isExport ? <Check className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                                        {isDelete ? 'Sposta nel Cestino' : isExport ? 'Scarica FHIR JSON' : 'Archivia'}
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
