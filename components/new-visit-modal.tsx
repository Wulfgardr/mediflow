'use client';

import { useState } from 'react';
import { X, UserPlus, Users, Search, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from '@/lib/live-query';
import { db } from '@/lib/db';

// @Codex WUL-229 — modal shell now follows the specular tier with mf-modal-* primitives
function Modal({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) {
    if (!isOpen) return null;
    return (
        <div className="mf-modal-backdrop">
            <button
                type="button"
                aria-label="Chiudi sfondo"
                className="absolute inset-0 cursor-default"
                onClick={onClose}
            />
            <div className="mf-modal-shell relative w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
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
            <div className="flex justify-between items-center p-4 graphite-divider">
                <h3 className="font-semibold text-lg" style={{ color: 'var(--mf-ink)' }}>Apri scheda</h3>
                <button onClick={onClose} className="mf-btn-secondary !p-2 !rounded-full" aria-label="Chiudi">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-6">
                {view === 'selection' ? (
                    <div className="grid grid-cols-1 gap-4">
                        <button
                            onClick={() => setView('search')}
                            className="mf-option-card flex items-center gap-4 p-5 group"
                        >
                            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: 'rgba(15, 123, 104, 0.12)', color: 'var(--mf-primary)' }}>
                                <Users className="w-5 h-5" />
                            </div>
                            <div className="flex-1">
                                <h4 className="font-semibold" style={{ color: 'var(--mf-ink)' }}>Scheda esistente</h4>
                                <p className="text-sm" style={{ color: 'var(--mf-muted)' }}>Cerca una scheda già presente</p>
                            </div>
                            <ChevronRight className="w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                        </button>

                        <button
                            onClick={handleNewPatient}
                            className="mf-option-card flex items-center gap-4 p-5 group"
                        >
                            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: 'rgba(94, 53, 95, 0.14)', color: 'var(--mf-plum)' }}>
                                <UserPlus className="w-5 h-5" />
                            </div>
                            <div className="flex-1">
                                <h4 className="font-semibold" style={{ color: 'var(--mf-ink)' }}>Nuova scheda</h4>
                                <p className="text-sm" style={{ color: 'var(--mf-muted)' }}>Crea una scheda anagrafica e clinica</p>
                            </div>
                            <ChevronRight className="w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                            <input
                                autoFocus
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Cerca per nome o codice fiscale"
                                className="mf-input pl-10"
                            />
                        </div>

                        <div className="max-h-[300px] overflow-y-auto space-y-1">
                            {patients?.map(patient => (
                                <button
                                    key={patient.id}
                                    onClick={() => handleSelectPatient(patient.id)}
                                    className="mf-popover-row w-full"
                                >
                                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm" style={{ background: 'rgba(15, 123, 104, 0.12)', color: 'var(--mf-primary)' }}>
                                        {patient.firstName[0]}{patient.lastName[0]}
                                    </div>
                                    <div>
                                        <p className="font-semibold" style={{ color: 'var(--mf-ink)' }}>{patient.lastName} {patient.firstName}</p>
                                        <p className="text-xs" style={{ color: 'var(--mf-muted)' }}>{patient.taxCode}</p>
                                    </div>
                                </button>
                            ))}
                            {patients?.length === 0 && searchTerm && (
                                <p className="text-center py-4 text-sm" style={{ color: 'var(--mf-muted)' }}>Nessun paziente trovato.</p>
                            )}
                        </div>

                        <button
                            onClick={() => setView('selection')}
                            className="mf-btn-secondary"
                        >
                            Indietro
                        </button>
                    </div>
                )}
            </div>
        </Modal>
    );
}
