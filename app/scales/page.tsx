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
            {selectedScale && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setSelectedScale(null)} />
                    <div className="relative bg-[color:var(--mf-bg-elevated)] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-[color:rgba(112,106,100,0.14)]">
                        <div className="flex justify-between items-center p-4 border-b border-[color:rgba(112,106,100,0.14)] bg-[color:rgba(255,249,240,0.6)]">
                            <h3 className="font-bold text-lg text-[color:var(--mf-ink)]">Seleziona Paziente</h3>
                            <button onClick={() => setSelectedScale(null)} className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors" aria-label="Chiudi">
                                <X className="w-5 h-5 text-[color:var(--mf-muted)]" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <p className="text-[color:var(--mf-muted)] text-sm">
                                Stai per avviare la scala <strong className="text-[color:var(--mf-ink)]">{SCALES[selectedScale].title}</strong>.
                                A chi è destinata?
                            </p>

                            <div className="relative">
                                <Search className="absolute left-3 top-3 w-5 h-5 text-[color:var(--mf-muted)]" />
                                <input
                                    autoFocus
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Cerca paziente..."
                                    className="w-full pl-10 pr-4 py-3 bg-white/60 dark:bg-white/6 border border-[color:rgba(112,106,100,0.16)] rounded-xl focus:border-[color:rgba(15,123,104,0.38)] focus:shadow-[0_0_0_4px_rgba(15,123,104,0.08)] transition-all outline-none"
                                />
                            </div>

                            <div className="max-h-[300px] overflow-y-auto space-y-2">
                                {patients?.map(patient => (
                                    <button
                                        key={patient.id}
                                        onClick={() => handleSelectPatient(patient.id)}
                                        className="w-full flex items-center gap-3 p-3 hover:bg-[color:rgba(15,123,104,0.06)] rounded-lg transition-colors border border-transparent hover:border-[color:rgba(15,123,104,0.18)] group text-left"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-[color:rgba(15,123,104,0.1)] text-[color:var(--mf-primary)] flex items-center justify-center font-bold text-sm">
                                            {patient.firstName[0]}{patient.lastName[0]}
                                        </div>
                                        <div>
                                            <p className="font-bold text-[color:var(--mf-ink)] group-hover:text-[color:var(--mf-primary)]">{patient.lastName} {patient.firstName}</p>
                                            <p className="text-xs text-[color:var(--mf-muted)]">{patient.taxCode}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <div className="pt-4 border-t border-[color:rgba(112,106,100,0.14)]">
                                <button
                                    onClick={() => router.push('/patients/new')}
                                    className="w-full py-3 bg-[color:rgba(15,123,104,0.1)] text-[color:var(--mf-primary)] rounded-xl border border-[color:rgba(15,123,104,0.22)] hover:bg-[color:rgba(15,123,104,0.16)] transition-colors font-medium flex justify-center items-center gap-2"
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
