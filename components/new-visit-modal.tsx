'use client';

import { useState } from 'react';
import { X, UserPlus, Users, Search, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';

// Simple Modal Implementation since we might not have a full UI library installed
function Modal({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {children}
            </div>
        </div>
    );
}

export function NewVisitModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const router = useRouter();
    const [searchTerm, setSearchTerm] = useState('');
    const [view, setView] = useState<'selection' | 'search'>('selection');

    // Fetch patients for search
    const patients = useLiveQuery(
        () => db.patients
            .filter(p => {
                const term = searchTerm.toLowerCase();
                return p.firstName.toLowerCase().includes(term) ||
                    p.lastName.toLowerCase().includes(term) ||
                    p.taxCode.toLowerCase().includes(term);
            })
            .limit(5)
            .toArray(),
        [searchTerm]
    );

    const handleSelectPatient = (id: string) => {
        router.push(`/patients/${id}`);
        onClose();
    };

    const handleNewPatient = () => {
        router.push('/patients/new');
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50/50">
                <h3 className="font-bold text-lg text-gray-800">Nuova Visita</h3>
                <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors" aria-label="Chiudi">
                    <X className="w-5 h-5 text-gray-500" />
                </button>
            </div>

            <div className="p-6">
                {view === 'selection' ? (
                    <div className="grid grid-cols-1 gap-4">
                        <button
                            onClick={() => setView('search')}
                            className="flex items-center gap-4 p-5 rounded-xl border border-blue-100 bg-blue-50/50 hover:bg-blue-100 hover:border-blue-300 transition-all group text-left"
                        >
                            <div className="w-12 h-12 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
                                <Users className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                                <h4 className="font-bold text-blue-900">Paziente in Carico</h4>
                                <p className="text-sm text-blue-700/70">Seleziona un paziente esistente dalla lista</p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-blue-300 group-hover:text-blue-600" />
                        </button>

                        <button
                            onClick={handleNewPatient}
                            className="flex items-center gap-4 p-5 rounded-xl border border-emerald-100 bg-emerald-50/50 hover:bg-emerald-100 hover:border-emerald-300 transition-all group text-left"
                        >
                            <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20 group-hover:scale-110 transition-transform">
                                <UserPlus className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                                <h4 className="font-bold text-emerald-900">Nuovo Paziente</h4>
                                <p className="text-sm text-emerald-700/70">Crea una nuova scheda paziente</p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-emerald-300 group-hover:text-emerald-600" />
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                            <input
                                autoFocus
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Cerca per nome o codice fiscale..."
                                className="w-full pl-10 pr-4 py-3 bg-gray-100 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                            />
                        </div>

                        <div className="max-h-[300px] overflow-y-auto space-y-2">
                            {patients?.map(patient => (
                                <button
                                    key={patient.id}
                                    onClick={() => handleSelectPatient(patient.id)}
                                    className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors border border-transparent hover:border-gray-200 group text-left"
                                >
                                    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                                        {patient.firstName[0]}{patient.lastName[0]}
                                    </div>
                                    <div>
                                        <p className="font-bold text-gray-800 group-hover:text-blue-600">{patient.lastName} {patient.firstName}</p>
                                        <p className="text-xs text-gray-500">{patient.taxCode}</p>
                                    </div>
                                </button>
                            ))}
                            {patients?.length === 0 && searchTerm && (
                                <p className="text-center text-gray-400 py-4 text-sm">Nessun paziente trovato.</p>
                            )}
                        </div>

                        <button
                            onClick={() => setView('selection')}
                            className="text-sm text-gray-500 hover:text-gray-800 underline"
                        >
                            Indietro
                        </button>
                    </div>
                )}
            </div>
        </Modal>
    );
}
