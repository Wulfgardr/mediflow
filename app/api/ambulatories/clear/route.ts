import { dbServer } from '@/lib/db-server';
import { patients, ambulatories } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/server-auth';

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();

    try {
        const { ambulatoryId } = await request.json();

        if (!ambulatoryId) {
            return NextResponse.json({ error: "Ambulatory ID required" }, { status: 400 });
        }

        // 1. Verify it's a TEST ambulatory
        const target = await dbServer.select().from(ambulatories).where(eq(ambulatories.id, ambulatoryId)).limit(1);

        if (!target.length) {
            return NextResponse.json({ error: "Ambulatory not found" }, { status: 404 });
        }

        if (target[0].type !== 'test') {
            return NextResponse.json({ error: "Safety Check: Cannot clear a LIVE ambulatory" }, { status: 403 });
        }

        // 2. Delete all patients in this ambulatory
        // Note: cascading deletes for related records (visits, etc.) should ideally be handled by DB or app logic.
        // For now, we assume simple soft-delete or direct delete of patients.
        // If we want to truly clear, we should delete.

        await dbServer.delete(patients).where(eq(patients.ambulatoryId, ambulatoryId));

        return NextResponse.json({ success: true, message: "Test container cleared" });
    } catch (error) {
        console.error("Clear ambulatory error:", error);
        return NextResponse.json({ error: "Failed to clear ambulatory" }, { status: 500 });
    }
}
