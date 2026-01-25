import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';

export interface ClinicalAlert {
    id: string;
    patientId: string;
    patientName: string;
    type: 'inactive' | 'scale' | 'adi';
    message: string;
    severity: 'high' | 'medium';
}

export function useClinicalAlerts() {
    return useLiveQuery(async () => {
        // Only consider active patients
        const patients = await db.patients
            .filter(p => !p.deletedAt && !p.isArchived)
            .toArray();
        const alerts: ClinicalAlert[] = [];

        const now = new Date();
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
        const SIX_MONTHS = 180 * 24 * 60 * 60 * 1000;

        // Process in parallel roughly
        for (const p of patients) {
            // Check Inactivity
            // 1. Fetch Latest Entry
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const allEntries = await db.entries.filter((e: any) => e.patientId === p.id).toArray();
            const lastEntry = allEntries
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

            if (!lastEntry) {
                alerts.push({
                    id: `no-entry-${p.id}`,
                    patientId: p.id,
                    patientName: `${p.firstName} ${p.lastName}`,
                    type: 'inactive',
                    message: 'Nessuna voce in diario. Programmare prima visita?',
                    severity: 'medium'
                });
            } else if (lastEntry && !lastEntry.deletedAt) {
                const diff = now.getTime() - lastEntry.date.getTime();
                if (diff > THIRTY_DAYS) {
                    alerts.push({
                        id: `inactive-${p.id}`,
                        patientId: p.id,
                        patientName: `${p.firstName} ${p.lastName}`,
                        type: 'inactive',
                        message: `Nessun aggiornamento da ${Math.floor(diff / (24 * 60 * 60 * 1000))} giorni.`,
                        severity: diff > THIRTY_DAYS * 2 ? 'high' : 'medium'
                    });
                }
            }

            // Check Expired Scales (Example: ADI patients should have periodic scales)
            if (p.isAdi) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const allScales = await db.entries.filter((e: any) => e.patientId === p.id && e.type === 'scale' && !e.deletedAt).toArray();
                const lastScale = allScales
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

                if (!lastScale) {
                    alerts.push({
                        id: `no-scale-${p.id}`,
                        patientId: p.id,
                        patientName: `${p.firstName} ${p.lastName}`,
                        type: 'scale',
                        message: 'Paziente ADI senza valutazioni registrate.',
                        severity: 'high'
                    });
                } else {
                    const diff = now.getTime() - lastScale.date.getTime();
                    if (diff > SIX_MONTHS) {
                        alerts.push({
                            id: `old-scale-${p.id}`,
                            patientId: p.id,
                            patientName: `${p.firstName} ${p.lastName}`,
                            type: 'scale',
                            message: 'Valutazioni scadute (> 6 mesi). Rivalutare.',
                            severity: 'medium'
                        });
                    }
                }
            }
        }

        // Return top 5 most urgent
        return alerts.sort((a, _b) => (a.severity === 'high' ? -1 : 1)).slice(0, 5);
    }, []);
}
