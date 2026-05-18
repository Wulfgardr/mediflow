'use client';

import { useState } from 'react';
import { ArrowRight, X, UserPlus, Search } from 'lucide-react';
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

    // Fetch patients for search
    const patients = useLiveQuery(
        () => db.patients
            .filter(p => {
                const term = searchTerm.trim().toLowerCase();
                if (!term) return true;
                const diagnosisText = (p.diagnoses ?? [])
                    .map((diagnosis) => `${diagnosis.code} ${diagnosis.description}`)
                    .join(' ')
                    .toLowerCase();
                return p.firstName.toLowerCase().includes(term) ||
                    p.lastName.toLowerCase().includes(term) ||
                    p.taxCode.toLowerCase().includes(term) ||
                    diagnosisText.includes(term);
            })
            .limit(6)
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
                <div>
                    <h3 className="font-semibold text-lg" style={{ color: 'var(--mf-ink)' }}>Apri una scheda</h3>
                    <p className="mt-1 text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>
                        Cerca per nome, codice fiscale o diagnosi. Se non esiste, crea una nuova scheda.
                    </p>
                </div>
                <button onClick={onClose} className="mf-btn-secondary !p-2 !rounded-full" aria-label="Chiudi">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="space-y-5 p-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                    <input
                        autoFocus
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Cerca paziente, codice fiscale o diagnosi"
                        className="mf-input pl-10"
                    />
                </div>

                <div className="max-h-[320px] overflow-y-auto space-y-1">
                    {patients?.map(patient => (
                        <button
                            key={patient.id}
                            onClick={() => handleSelectPatient(patient.id)}
                            className="mf-popover-row w-full"
                        >
                            <div className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-semibold text-sm" style={{ background: 'rgba(15, 123, 104, 0.12)', color: 'var(--mf-primary)' }}>
                                {patient.firstName[0]}{patient.lastName[0]}
                            </div>
                            <div className="min-w-0 flex-1 text-left">
                                <p className="truncate font-semibold" style={{ color: 'var(--mf-ink)' }}>{patient.lastName} {patient.firstName}</p>
                                <p className="truncate text-xs" style={{ color: 'var(--mf-muted)' }}>
                                    {patient.taxCode}
                                    {patient.diagnoses?.[0]?.description ? ` · ${patient.diagnoses[0].description}` : ''}
                                </p>
                            </div>
                            <ArrowRight className="h-4 w-4 shrink-0" style={{ color: 'var(--mf-muted)' }} />
                        </button>
                    ))}
                    {patients?.length === 0 && (
                        <p className="text-center py-4 text-sm" style={{ color: 'var(--mf-muted)' }}>
                            Nessuna scheda corrisponde alla ricerca.
                        </p>
                    )}
                </div>

                <button
                    onClick={handleNewPatient}
                    className="mf-option-card flex w-full items-center gap-4 p-5 group"
                >
                    <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: 'rgba(94, 53, 95, 0.14)', color: 'var(--mf-plum)' }}>
                        <UserPlus className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                        <h4 className="font-semibold" style={{ color: 'var(--mf-ink)' }}>Crea nuova scheda</h4>
                        <p className="text-sm" style={{ color: 'var(--mf-muted)' }}>Anagrafica, diagnosi, diario e allegati partono da una scheda vuota.</p>
                    </div>
                    <ArrowRight className="w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                </button>
            </div>
        </Modal>
    );
}
