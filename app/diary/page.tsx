'use client';

import { useLiveQuery } from '@/lib/live-query';
import { db } from '@/lib/db';
import Timeline from '@/components/timeline';
import { BookOpen, Clock3 } from 'lucide-react';

export default function GlobalDiaryPage() {
    const data = useLiveQuery(async () => {
        try {
            const entries = await db.entries.orderBy('date').reverse().limit(50).toArray();
            const patients = await db.patients.toArray();
            const patientMap = new Map(patients.map(p => [p.id, p]));

            return entries.map(e => ({
                ...e,
                patientName: patientMap.get(e.patientId)
                    ? `${patientMap.get(e.patientId)?.firstName} ${patientMap.get(e.patientId)?.lastName}`
                    : 'Paziente sconosciuto'
            }));
        } catch (e) {
            console.error("Error loading global diary", e);
            return [];
        }
    });

    return (
        <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 md:px-8">
            {/* @Codex WUL-229 — diary adopts the production liquid-glass section language */}
            <div className="mf-section p-6 md:p-7">
                <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                    <div className="flex items-start gap-4">
                        <div className="mf-icon-disc h-12 w-12">
                            <BookOpen className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="mf-eyebrow">Timeline clinica</p>
                            <h1 className="mt-1 text-2xl font-black tracking-tight" style={{ color: 'var(--mf-ink)' }}>Diario Clinico Globale</h1>
                            <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: 'var(--mf-muted)' }}>
                                Cronologia centralizzata delle ultime 50 attività cliniche.
                            </p>
                        </div>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-[color:rgba(112,106,100,0.12)] bg-[color:var(--ui-chip-bg)] px-3 py-2 text-xs font-semibold" style={{ color: 'var(--mf-muted)' }}>
                        <Clock3 className="h-4 w-4" />
                        Aggiornamento locale
                    </div>
                </div>
            </div>

            <div className="min-h-[500px]">
                {data ? <Timeline entries={data} /> : <div className="mf-section text-center text-sm" style={{ color: 'var(--mf-muted)' }}>Caricamento diario...</div>}
            </div>
        </div>
    )
}
