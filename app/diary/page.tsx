'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import Timeline from '@/components/timeline';

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
        <div className="p-8 max-w-4xl mx-auto space-y-8">
            <div className="glass-panel p-6">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Diario Clinico Globale</h1>
                <p className="text-gray-500 mt-1">Cronologia centralizzata delle ultime 50 attività cliniche.</p>
            </div>

            <div className="min-h-[500px]">
                {data ? <Timeline entries={data} /> : <div className="text-center p-10 text-gray-400">Caricamento diario...</div>}
            </div>
        </div>
    )
}
