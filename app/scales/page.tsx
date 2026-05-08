'use client';

import { useState } from 'react';
import { Activity, Brain, Ruler, Users, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from '@/lib/live-query';
import { db } from '@/lib/db';
import { SCALES } from '@/lib/scale-definitions';

// Mock library extended with real IDs where available
const scalesLibrary = [
    {
        category: 'Cognitivo',
        items: [
            { name: 'MMSE', id: 'mmse', desc: 'Mini-Mental State Examination', icon: Brain }, // To be implemented
            { name: 'MoCA', id: 'moca', desc: 'Montreal Cognitive Assessment', icon: Brain },
        ]
    },
    {
        category: 'Funzionale / Motorio',
        items: [
            { name: 'Tinetti', id: 'tinetti', desc: 'Valutazione Equilibrio & Andatura', icon: Ruler },
            { name: 'Mingazzini', id: 'mingazzini', desc: 'Valutazione deficit forza (I e II)', icon: Activity },
            { name: 'ADL', id: 'adl', desc: 'Activities of Daily Living (Katz)', icon: Ruler },
            { name: 'IADL', id: 'iadl', desc: 'Instrumental ADL (Lawton)', icon: Ruler },
            { name: 'Barthel', id: 'barthel', desc: 'Indice di Barthel', icon: Ruler },
        ]
    },
    {
        category: 'Psichiatrico/Comportamentale',
        items: [
            { name: 'GDS', id: 'gds', desc: 'Geriatric Depression Scale (15 item)', icon: Activity },
            { name: 'NPI', id: 'npi', desc: 'Neuropsychiatric Inventory (Q)', icon: Activity },
        ]
    }
];

export default function ScalesLibraryPage() {
    const router = useRouter();
    const [selectedScale, setSelectedScale] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Patients for selection
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

    const handleScaleClick = (scaleId: string) => {
        // If scale is implemented (in SCALES), open selection. Else alert.
        if (SCALES[scaleId]) {
            setSelectedScale(scaleId);
        } else {
            alert("Questa scala non è ancora stata digitalizzata.");
        }
    };

    const handleSelectPatient = (patientId: string) => {
        if (selectedScale) {
            router.push(`/patients/${patientId}/scales/${selectedScale}`);
            setSelectedScale(null);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8 relative">
            <div>
                <h1 className="text-3xl font-bold text-[color:var(--mf-ink)]">Libreria Scale & Valutazioni</h1>
                <p className="text-[color:var(--mf-muted)] mt-1">Seleziona una scala per iniziare una valutazione.</p>
            </div>

            <div className="grid grid-cols-1 gap-8">
                {scalesLibrary.map((cat) => (
                    <div key={cat.category}>
                        <h3 className="text-xl font-bold text-[color:var(--mf-ink)] mb-4 px-1">{cat.category}</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {cat.items.map((item) => {
                                const Icon = item.icon;
                                const isImplemented = !!SCALES[item.id];

                                return (
                                    <button
                                        key={item.name}
                                        onClick={() => handleScaleClick(item.id)}
                                        className={`glass-card p-6 flex flex-col gap-4 text-left transition-all hover:scale-[1.02] ${isImplemented ? 'opacity-100 hover:shadow-lg' : 'opacity-60 grayscale'}`}
                                    >
                                        <div className="flex justify-between items-start w-full">
                                            <div className="p-3 bg-[color:rgba(15,123,104,0.1)] rounded-xl text-[color:var(--mf-primary)]">
                                                <Icon className="w-6 h-6" />
                                            </div>
                                            <span className={`px-2 py-1 rounded text-xs font-mono ${isImplemented ? 'bg-[color:rgba(15,123,104,0.12)] text-[color:var(--mf-primary)]' : 'bg-[color:rgba(112,106,100,0.1)] text-[color:var(--mf-muted)]'}`}>
                                                {isImplemented ? 'Attiva' : 'Coming Soon'}
                                            </span>
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-lg text-[color:var(--mf-ink)]">{item.name}</h4>
                                            <p className="text-sm text-[color:var(--mf-muted)]">{item.desc}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {/* Patient Selection Modal */}
            {/* @Codex WUL-229 — scale-launch modal aligned with specular tier */}
            {selectedScale && (
                <div className="mf-modal-backdrop" style={{ zIndex: 100 }}>
                    <button
                        type="button"
                        aria-label="Chiudi sfondo"
                        className="absolute inset-0 cursor-default"
                        onClick={() => setSelectedScale(null)}
                    />
                    <div className="mf-modal-shell relative w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 graphite-divider">
                            <h3 className="font-semibold text-lg" style={{ color: 'var(--mf-ink)' }}>Seleziona Paziente</h3>
                            <button onClick={() => setSelectedScale(null)} className="mf-btn-secondary !p-2 !rounded-full" aria-label="Chiudi" title="Chiudi">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <p className="text-sm" style={{ color: 'var(--mf-muted)' }}>
                                Stai per avviare la scala <strong style={{ color: 'var(--mf-ink)' }}>{SCALES[selectedScale].title}</strong>.
                                A chi è destinata?
                            </p>

                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--mf-muted)' }} />
                                <input
                                    autoFocus
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Cerca paziente..."
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
                                        <div
                                            className="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm"
                                            style={{ background: 'rgba(15, 123, 104, 0.12)', color: 'var(--mf-primary)' }}
                                        >
                                            {patient.firstName[0]}{patient.lastName[0]}
                                        </div>
                                        <div>
                                            <p className="font-semibold" style={{ color: 'var(--mf-ink)' }}>{patient.lastName} {patient.firstName}</p>
                                            <p className="text-xs" style={{ color: 'var(--mf-muted)' }}>{patient.taxCode}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <div className="pt-4 graphite-divider">
                                <button
                                    onClick={() => router.push('/patients/new')}
                                    className="mf-btn-secondary w-full justify-center"
                                >
                                    <Users className="w-4 h-4" />
                                    Crea Nuovo Paziente
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
