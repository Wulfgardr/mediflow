'use client';

import { useState } from 'react';
import { db, Patient, MonitoringProfile } from '@/lib/db';
import { RefreshCw, History, AlertTriangle } from 'lucide-react';

export default function PatientStatusManager({ patient }: { patient: Patient }) {
    const [isChanging, setIsChanging] = useState(false);
    const [newStatus, setNewStatus] = useState<MonitoringProfile | null>(null);
    const [reason, setReason] = useState("");

    const currentStatus = patient.monitoringProfile;

    const handleStartChange = () => {
        setIsChanging(true);
        // Default to the opposite status
        setNewStatus(currentStatus === 'taken_in_charge' ? 'extemporaneous' : 'taken_in_charge');
    };

    const handleConfirm = async () => {
        if (!newStatus || !reason.trim()) {
            alert("Inserire una motivazione valida.");
            return;
        }

        const historyEntry = {
            date: new Date(),
            status: newStatus,
            reason: reason,
        };

        const updatedHistory = [
            ...(patient.statusHistory || []),
            historyEntry
        ];

        await db.patients.update(patient.id, {
            monitoringProfile: newStatus,
            statusHistory: updatedHistory,
            updatedAt: new Date()
        });

        setIsChanging(false);
        setReason("");
        setNewStatus(null);
    };

    return (
        <div className="text-sm">
            <div className="flex items-center gap-2 mb-1">
                <span className="text-gray-500">Profilo Monitoraggio: </span>
                <span className={`font-bold px-2 py-0.5 rounded text-xs ${currentStatus === 'taken_in_charge'
                    ? 'bg-green-100 text-green-800 border border-green-200'
                    : 'bg-orange-100 text-orange-800 border border-orange-200'
                    }`}>
                    {currentStatus === 'taken_in_charge' ? 'Presa in Carico' : 'Estemporanea'}
                </span>
                <button
                    onClick={handleStartChange}
                    className="ml-2 text-blue-600 hover:underline text-xs flex items-center gap-1"
                >
                    <RefreshCw className="w-3 h-3" />
                    Cambia
                </button>
            </div>

            {/* History Preview (Last change) */}
            {patient.statusHistory && patient.statusHistory.length > 0 && !isChanging && (
                <div className="text-xs text-gray-400 italic mt-1 flex items-center gap-1">
                    <History className="w-3 h-3" />
                    Ultima modifica: {new Date(patient.statusHistory[patient.statusHistory.length - 1].date).toLocaleDateString()}
                    {' '}- &quot;{patient.statusHistory[patient.statusHistory.length - 1].reason}&quot;
                </div>
            )}

            {/* Change Modal / Inline Form */}
            {isChanging && (
                <div className="mt-3 p-4 bg-white border border-gray-200 rounded-xl shadow-lg animate-in slide-in-from-top-2 absolute z-20 w-80">
                    <h4 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-500" />
                        Modifica Stato Paziente
                    </h4>

                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <button
                                onClick={() => setNewStatus('taken_in_charge')}
                                className={`flex-1 py-1.5 text-xs font-bold rounded border ${newStatus === 'taken_in_charge'
                                    ? 'bg-green-500 text-white border-green-600'
                                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                                    }`}
                            >
                                Presa in Carico
                            </button>
                            <button
                                onClick={() => setNewStatus('extemporaneous')}
                                className={`flex-1 py-1.5 text-xs font-bold rounded border ${newStatus === 'extemporaneous'
                                    ? 'bg-orange-500 text-white border-orange-600'
                                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                                    }`}
                            >
                                Estemporanea
                            </button>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Motivazione (Obbligatoria)</label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                className="w-full p-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                rows={2}
                                placeholder="Es. Assegnato a MMG, Trasferito, Chiusura percorso..."
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                            <button
                                onClick={() => setIsChanging(false)}
                                className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleConfirm}
                                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold"
                            >
                                Conferma Modifica
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
