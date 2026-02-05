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

        let defaultAmbulatoryId: string;

        if (existingAmbulatories.length === 0) {
            console.log("No ambulatories found. Creating default...");
            defaultAmbulatoryId = uuidv4();
            await dbServer.insert(ambulatories).values({
                id: defaultAmbulatoryId,
                name: 'Ambulatorio Principale',
                address: 'Sede Legale',
                isDefault: true,
                createdAt: new Date(),
            });
            console.log("Default ambulatory created:", defaultAmbulatoryId);
        } else {
            console.log("Ambulatories exist.");
            // Find the default one or just pick the first
            const defaultAmb = existingAmbulatories.find(a => a.isDefault) || existingAmbulatories[0];
            defaultAmbulatoryId = defaultAmb.id;
        }

        // 2. Migrate orphaned patients
        const orphanedPatients = await dbServer.select().from(patients).where(isNull(patients.ambulatoryId));

        if (orphanedPatients.length > 0) {
            console.log(`Migrating ${orphanedPatients.length} orphaned patients to ${defaultAmbulatoryId}...`);
            await dbServer.update(patients)
                .set({ ambulatoryId: defaultAmbulatoryId })
                .where(isNull(patients.ambulatoryId));
        }

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
