import { dbServer } from '@/lib/db-server';
import { ambulatories, patients } from '@/lib/schema';
import { isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function POST() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        // 1. Check if default ambulatory exists
        const existingAmbulatories = await dbServer.select().from(ambulatories).limit(1);

        const mustCreateDefault = existingAmbulatories.length === 0;
        const defaultAmbulatoryId: string = mustCreateDefault
            ? uuidv4()
            : (existingAmbulatories.find(a => a.isDefault) || existingAmbulatories[0]).id;

        // 2. Count orphaned patients (read outside the transaction)
        const orphanedPatients = await dbServer.select().from(patients).where(isNull(patients.ambulatoryId));

        // WUL-268 (STREAM A): creating the default ambulatory and relinking orphaned
        // patients to it must be atomic, otherwise a crash could relink patients to
        // an ambulatory that was never committed. Transaction is synchronous (no awaits).
        dbServer.transaction((tx) => {
            if (mustCreateDefault) {
                console.log("No ambulatories found. Creating default...");
                tx.insert(ambulatories).values({
                    id: defaultAmbulatoryId,
                    name: 'Ambulatorio Principale',
                    address: 'Sede Legale',
                    isDefault: true,
                    createdAt: new Date(),
                }).run();
                console.log("Default ambulatory created:", defaultAmbulatoryId);
            } else {
                console.log("Ambulatories exist.");
            }

            if (orphanedPatients.length > 0) {
                console.log(`Migrating ${orphanedPatients.length} orphaned patients to ${defaultAmbulatoryId}...`);
                tx.update(patients)
                    .set({ ambulatoryId: defaultAmbulatoryId })
                    .where(isNull(patients.ambulatoryId))
                    .run();
            }
        });

        return NextResponse.json({
            success: true,
            message: "Migration completed",
            migratedPatients: orphanedPatients.length,
            defaultAmbulatoryId
        });

    } catch (e) {
        console.error("Migration failed:", e);
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
