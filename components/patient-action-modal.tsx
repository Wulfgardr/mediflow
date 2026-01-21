'use client';

import { useState } from 'react';
import { Trash2, Archive, AlertTriangle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MonitoringProfile } from '@/lib/db';

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

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

            <div className={cn(
                "relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 border-t-8",
                isDelete ? "border-red-500" : isExport ? "border-blue-500" : "border-amber-500"
            )}>
                <div className="p-6">
                    <div className="flex items-center gap-4 mb-4">
                        <div className={cn(
                            "p-3 rounded-full flex items-center justify-center shrink-0",
                            isDelete ? "bg-red-100 text-red-600" : isExport ? "bg-blue-100 text-blue-600" : "bg-amber-100 text-amber-600"
                        )}>
                            {isDelete ? <Trash2 className="w-6 h-6" /> : isExport ? <Check className="w-6 h-6" /> : <Archive className="w-6 h-6" />}
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-gray-800">
                                {isDelete ? 'Elimina Paziente' : isExport ? 'Esporta Dati Clinici' : 'Archivia Paziente'}
                            </h3>
                            <p className="text-gray-500 text-sm">
                                {patientName}
                            </p>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {isDelete ? (
                            <div className="space-y-3">
                                <div className="p-3 bg-red-50 text-red-800 text-sm rounded-lg flex items-start gap-2 border border-red-100">
                                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                    <p>
                                        Il paziente verrà spostato nel <strong>Cestino</strong>.
                                        Potrai ripristinarlo entro 30 giorni, dopodiché verrà eliminato definitivamente.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Motivazione Eliminazione <span className="text-red-500">*</span></label>
                                    <textarea
                                        required
                                        value={deletionReason}
                                        onChange={(e) => setDeletionReason(e.target.value)}
                                        className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all outline-none"
                                        rows={3}
                                        placeholder="Es. Errore di inserimento, duplicato..."
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="p-3 bg-amber-50 text-amber-800 text-sm rounded-lg flex items-start gap-2 border border-amber-100">
                                    <Archive className="w-4 h-4 mt-0.5 shrink-0" />
                                    <p>
                                        Il paziente verrà rimosso dalla lista attiva e spostato in archivio. Potrai trovarlo tramite ricerca.
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Motivo Archiviazione</label>
                                    <select
                                        value={archiveReason}
                                        onChange={(e) => setArchiveReason(e.target.value as ArchiveReason)}
                                        className="w-full p-3 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-amber-500 outline-none"
                                        aria-label="Seleziona motivazione archiviazione"
                                    >
                                        <option value="assigned_mmg">Assegnato a MMG</option>
                                        <option value="deceased">Decesso</option>
                                        <option value="other">Altro</option>
                                    </select>
                                </div>

                                {archiveReason === 'other' && (
                                    <div className="animate-in slide-in-from-top-1 fade-in">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Specifica Altro <span className="text-amber-600">*</span></label>
                                        <textarea
                                            required
                                            value={archiveNote}
                                            onChange={(e) => setArchiveNote(e.target.value)}
                                            className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-amber-500 transition-all outline-none"
                                            rows={2}
                                            placeholder="Specifica il motivo..."
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {isExport && (
                            <div className="space-y-3">
                                <div className="p-3 bg-blue-50 text-blue-800 text-sm rounded-lg flex items-start gap-2 border border-blue-100">
                                    <Check className="w-4 h-4 mt-0.5 shrink-0" />
                                    <p>
                                        Verrà generato un file <strong>JSON FHIR-compliant</strong> contenente:
                                        <ul className="list-disc ml-4 mt-1 opacity-80">
                                            <li>Anagrafica Paziente</li>
                                            <li>Storia Diagnostica</li>
                                            <li>Note e Visite</li>
                                            <li>Terapie e Valutazioni</li>
                                        </ul>
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 mt-6">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                Annulla
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className={cn(
                                    "px-6 py-2 text-white font-bold rounded-lg shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2",
                                    isDelete
                                        ? "bg-red-600 hover:bg-red-700 shadow-red-500/30"
                                        : isExport ? "bg-blue-600 hover:bg-blue-700 shadow-blue-500/30"
                                            : "bg-amber-500 hover:bg-amber-600 shadow-amber-500/30"
                                )}
                            >
                                {isSubmitting ? 'Elaborazione...' : (
                                    <>
                                        {isDelete ? <Trash2 className="w-4 h-4" /> : isExport ? <Check className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                                        {isDelete ? 'Sposta nel Cestino' : isExport ? 'Scarica JSON' : 'Archivia'}
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
