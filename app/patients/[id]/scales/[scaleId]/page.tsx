'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useParams, useRouter } from 'next/navigation';
import ScaleEngine from '@/components/scale-engine';
import { SCALES } from '@/lib/scale-definitions';
import { v4 as uuidv4 } from 'uuid';
import { cn } from '@/lib/utils';
import { Home, Building2 } from 'lucide-react';

export default function ScaleRunnerPage() {
    const params = useParams();
    const router = useRouter();
    const patientId = params.id as string;
    const scaleId = params.scaleId as string;
    const [setting, setSetting] = useState<'ambulatory' | 'home'>('ambulatory');

    const patient = useLiveQuery(() => db.patients.get(patientId), [patientId]);
    const scaleDef = SCALES[scaleId];

    if (!patient || !scaleDef) {
        return <div className="p-10 text-center">Caricamento Valutazione...</div>;
    }

    const handleComplete = async (result: { score: number; answers: Record<string, string | number>; interpretation: string }) => {
        try {
            await db.entries.add({
                id: uuidv4(),
                patientId,
                date: new Date(),
                type: 'scale',
                setting, // Saved setting
                content: `Valutazione ${scaleDef.title} completata.\nPunteggio: ${result.score}\nInterpretazione: ${result.interpretation}`,
                metadata: {
                    title: scaleDef.title,
                    scaleId,
                    score: result.score,
                    interpretation: result.interpretation,
                    answers: result.answers
                },
                createdAt: new Date(),
                attachments: []
            });

            // Redirect to patient dashboard
            router.push(`/patients/${patientId}`);
        } catch (error) {
            console.error("Failed to save scale", error);
            alert("Errore nel salvataggio della valutazione.");
        }
    };

    const handleCancel = () => {
        router.back();
    };

    return (
        <div className="p-4 bg-gray-50 min-h-screen">
            <div className="max-w-2xl mx-auto mb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-1">Valutazione Paziente</h1>
                    <h2 className="text-2xl font-bold text-blue-900">{patient.lastName} {patient.firstName}</h2>
                </div>

                {/* Setting Context Selector */}
                <div className="flex bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
                    <button
                        onClick={() => setSetting('ambulatory')}
                        className={cn(
                            "px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-all",
                            setting === 'ambulatory' ? "bg-emerald-100 text-emerald-800" : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        <Building2 className="w-4 h-4" /> Ambulatorio
                    </button>
                    <button
                        onClick={() => setSetting('home')}
                        className={cn(
                            "px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-all",
                            setting === 'home' ? "bg-amber-100 text-amber-800" : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        <Home className="w-4 h-4" /> Domicilio
                    </button>
                </div>
            </div>

            <ScaleEngine
                scale={scaleDef}
                onComplete={handleComplete}
                onCancel={handleCancel}
            />
        </div>
    );
}
