'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/db';
import ScaleEngine, { ScaleDefinition } from '@/components/scale-engine';
import { Activity, Brain, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { v4 as uuidv4 } from 'uuid';

// Define MMSE Structure (Simplified for Demo)
const mmseScale: ScaleDefinition = {
    id: 'mmse',
    title: 'Mini-Mental State Examination (MMSE)',
    description: 'Screening rapido per il deterioramento cognitivo.',
    questions: [
        { id: 'q1', text: 'In che anno siamo?', type: 'boolean' },
        { id: 'q2', text: 'In che stagione siamo?', type: 'boolean' },
        { id: 'q3', text: 'In che mese siamo?', type: 'boolean' },
        { id: 'q4', text: 'Che giorno del mese è oggi?', type: 'boolean' },
        { id: 'q5', text: 'Che giorno della settimana è oggi?', type: 'boolean' },
        { id: 'q6', text: 'In che nazione siamo?', type: 'boolean' },
        { id: 'q7', text: 'Ripeti: "Mela, Tavolo, Moneta"', type: 'boolean' },
        // Full MMSE has 30 points, this is a subset/skeleton for demo
    ],
    scoringLogic: (answers) => {
        // Sum all ones
        return Object.values(answers).reduce((a, b) => (Number(a) || 0) + (Number(b) || 0), 0) as number;
    },
    interpretation: (score) => {
        if (score >= 24) return 'Cognitività Normale';
        if (score >= 18) return 'Deterioramento Lieve';
        return 'Deterioramento Grave';
    }
};

const availableScales = [mmseScale];

export default function ScalesPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;
    const [selectedScale, setSelectedScale] = useState<ScaleDefinition | null>(null);

    const handleComplete = async (result: { score: number; answers: Record<string, string | number>; interpretation: string }) => {
        if (!selectedScale) return;

        await db.entries.add({
            id: uuidv4(),
            patientId: id,
            type: 'scale',
            date: new Date(),
            title: `Valutazione ${selectedScale.title}`,
            content: `${selectedScale.title}\nPunteggio: ${result.score}\nEsito: ${result.interpretation}`,
            metadata: {
                scaleId: selectedScale.id,
                title: selectedScale.title,
                score: result.score,
                answers: result.answers,
                interpretation: result.interpretation
            },
            attachments: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        router.push(`/patients/${id}`);
    };

    if (selectedScale) {
        return (
            <div className="py-8">
                <ScaleEngine
                    scale={selectedScale}
                    onComplete={handleComplete}
                    onCancel={() => setSelectedScale(null)}
                />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Link href={`/patients/${id}`} className="p-2 hover:bg-white/50 rounded-full transition-colors">
                    <ArrowLeft className="w-6 h-6 text-gray-600" />
                </Link>
                <h1 className="text-2xl font-bold text-gray-800">Seleziona Valutazione</h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {availableScales.map(scale => (
                    <button
                        key={scale.id}
                        onClick={() => setSelectedScale(scale)}
                        className="glass-card p-6 text-left group hover:scale-[1.02] transition-transform"
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div className="p-3 bg-blue-100 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                <Brain className="w-8 h-8" />
                            </div>
                        </div>
                        <h3 className="text-xl font-bold text-gray-800 mb-2">{scale.title}</h3>
                        <p className="text-gray-500 text-sm leading-relaxed">{scale.description}</p>
                    </button>
                ))}

                {/* Placeholder for more scales */}
                <div className="border-2 border-dashed border-gray-200 rounded-2xl p-6 flex flex-col items-center justify-center text-gray-400 min-h-[200px]">
                    <Activity className="w-8 h-8 mb-2 opacity-50" />
                    <p className="font-medium">Altre scale in arrivo...</p>
                </div>
            </div>
        </div>
    );
}
