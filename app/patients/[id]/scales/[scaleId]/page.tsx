'use client';

import { useState } from 'react';
import { useLiveQuery } from '@/lib/live-query';
import { db } from '@/lib/db';
import { useParams, useRouter } from 'next/navigation';
import ScaleEngine from '@/components/scale-engine';
import { SCALES } from '@/lib/scale-definitions';
import { v4 as uuidv4 } from 'uuid';
import { cn } from '@/lib/utils';
import { Home, Building2, Activity } from 'lucide-react';

export default function ScaleRunnerPage() {
    const params = useParams();
    const router = useRouter();
    const patientId = params.id as string;
    const scaleId = params.scaleId as string;
    const [setting, setSetting] = useState<'ambulatory' | 'home'>('ambulatory');

    const patient = useLiveQuery(() => db.patients.get(patientId), [patientId]);
    const scaleDef = SCALES[scaleId];

    if (!patient || !scaleDef) {
        return <div className="mf-section mx-auto mt-8 max-w-md text-center text-sm" style={{ color: 'var(--mf-muted)' }}>Caricamento Valutazione...</div>;
    }

    const handleComplete = async (result: { score: number; answers: Record<string, string | number>; interpretation: string }) => {
        try {
            await db.entries.add({
                id: uuidv4(),
                patientId,
                date: new Date(),
                type: 'scale',
                title: scaleDef.title,
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
                updatedAt: new Date(),
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
        <div className="min-h-screen p-4">
            {/* @Codex WUL-229 — scale runner header shares the liquid section + tab primitives */}
            <div className="mf-section mx-auto mb-6 flex max-w-2xl flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="flex items-start gap-3">
                    <div className="mf-icon-disc h-11 w-11">
                        <Activity className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="mf-eyebrow">Valutazione Paziente</p>
                        <h2 className="mt-1 text-2xl font-black tracking-tight" style={{ color: 'var(--mf-ink)' }}>{patient.lastName} {patient.firstName}</h2>
                    </div>
                </div>

                {/* Setting Context Selector */}
                <div className="inline-flex rounded-[16px] border border-[color:rgba(112,106,100,0.12)] bg-[color:var(--ui-chip-bg)] p-1">
                    <button
                        onClick={() => setSetting('ambulatory')}
                        className={cn(
                            "mf-tab px-3 py-1.5 text-sm",
                            setting === 'ambulatory' && "is-active"
                        )}
                    >
                        <Building2 className="w-4 h-4" /> Ambulatorio
                    </button>
                    <button
                        onClick={() => setSetting('home')}
                        className={cn(
                            "mf-tab px-3 py-1.5 text-sm",
                            setting === 'home' && "is-active"
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
