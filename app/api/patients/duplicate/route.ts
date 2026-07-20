import { dbServer } from '@/lib/db-server';
import { ambulatories, patients, patientsToAmbulatories } from '@/lib/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
/* @Codex */
import { patientDuplicateSchema } from '@/lib/api-schemas/patient-bulk';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';
// WUL-306 (ADR 0066): bulk reads treat soft-deleted patients as missing
import { activePatients } from '@/lib/patient-lifecycle';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const parsedBody = parseApiBody(patientDuplicateSchema, await request.json());
        if (!parsedBody.ok) return parsedBody.response;
        const { patientIds, targetAmbulatoryId } = parsedBody.data;

        const target = await dbServer
            .select({ id: ambulatories.id })
            .from(ambulatories)
            .where(eq(ambulatories.id, targetAmbulatoryId))
            .get();
        if (!target) {
            return NextResponse.json({ error: 'Target ambulatory not found' }, { status: 404 });
        }

        // Fetch original patients
        const originals = await dbServer.select().from(patients).where(and(inArray(patients.id, patientIds), activePatients()));
        const originalIds = new Set(originals.map((item) => item.id));
        const missingPatientIds = patientIds.filter((id) => !originalIds.has(id));
        if (missingPatientIds.length > 0) {
            return NextResponse.json(
                { error: 'Some patients were not found', missingPatientIds },
                { status: 404 }
            );
        }

        // WUL-268 (STREAM A): each clone is a patient insert plus its membership
        // link; wrap the whole batch so a mid-loop failure never leaves half-cloned
        // patients without a membership row. Transaction is synchronous (no awaits).
        const count = dbServer.transaction((tx) => {
            let cloned = 0;
            for (const p of originals) {
                const newId = uuidv4();

                // Clone patient data
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { id: _oldId, createdAt: _c, updatedAt: _u, ambulatoryId: _oldAmb, ...data } = p;

                // Insert Clone
                tx.insert(patients).values({
                    id: newId,
                    ...data,
                    /* @Codex */
                    firstName: p.firstName,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    ambulatoryId: targetAmbulatoryId // Set primary ownership too for compat
                }).run();

                // Create Link
                tx.insert(patientsToAmbulatories).values({
                    patientId: newId,
                    ambulatoryId: targetAmbulatoryId
                }).onConflictDoNothing().run();
                cloned++;
            }
            return cloned;
        });

        return NextResponse.json({ success: true, count });
    } catch (error) {
        console.error("Duplicate patients error:", error);
        return NextResponse.json({ error: "Failed to duplicate patients" }, { status: 500 });
    }
}
