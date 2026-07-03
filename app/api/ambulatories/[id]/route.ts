import { dbServer } from '@/lib/db-server';
import { ambulatories, patients, patientsToAmbulatories } from '@/lib/schema';
import { and, desc, eq, ne } from 'drizzle-orm';
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
// WUL-306 (ADR 0066): only active patients block ambulatory deletion
import { activePatients } from '@/lib/patient-lifecycle';

/* @Codex */
function normalizeType(value: unknown): 'live' | 'test' | '__invalid__' | undefined {
    if (value === undefined) return undefined;
    if (value === 'live' || value === 'test') return value;
    return '__invalid__';
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { id } = await params;
    try {
        const body = await request.json() as Record<string, unknown>;
        const existing = await dbServer
            .select({ id: ambulatories.id, isDefault: ambulatories.isDefault })
            .from(ambulatories)
            .where(eq(ambulatories.id, id))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateData: Partial<typeof ambulatories.$inferInsert> = {};

        if (typeof body.name === 'string') {
            const name = body.name.trim();
            if (!name) {
                return NextResponse.json({ error: 'Ambulatory name cannot be empty' }, { status: 400 });
            }
            updateData.name = name;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'address')) {
            if (typeof body.address === 'string') {
                updateData.address = body.address;
            } else if (body.address === null || body.address === '') {
                updateData.address = null;
            } else {
                return NextResponse.json({ error: 'Invalid address value' }, { status: 400 });
            }
        }

        if (Object.prototype.hasOwnProperty.call(body, 'parentId')) {
            if (typeof body.parentId === 'string') {
                const parentId = body.parentId.trim();
                if (parentId.length === 0) {
                    updateData.parentId = null;
                } else {
                    if (parentId === id) {
                        return NextResponse.json({ error: 'parentId cannot reference itself' }, { status: 400 });
                    }
                    const parent = await dbServer
                        .select({ id: ambulatories.id })
                        .from(ambulatories)
                        .where(eq(ambulatories.id, parentId))
                        .get();
                    if (!parent) {
                        return NextResponse.json({ error: 'Parent ambulatory not found' }, { status: 404 });
                    }
                    updateData.parentId = parentId;
                }
            } else if (body.parentId === null || body.parentId === '') {
                updateData.parentId = null;
            } else {
                return NextResponse.json({ error: 'Invalid parentId value' }, { status: 400 });
            }
        }

        const parsedType = normalizeType(body.type);
        if (parsedType === '__invalid__') {
            return NextResponse.json({ error: 'Invalid ambulatory type' }, { status: 400 });
        }
        if (parsedType !== undefined) {
            updateData.type = parsedType;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'description')) {
            if (typeof body.description === 'string') {
                updateData.description = body.description;
            } else if (body.description === null || body.description === '') {
                updateData.description = null;
            } else {
                return NextResponse.json({ error: 'Invalid description value' }, { status: 400 });
            }
        }

        if (Object.prototype.hasOwnProperty.call(body, 'isDefault')) {
            if (typeof body.isDefault !== 'boolean') {
                return NextResponse.json({ error: 'Invalid isDefault value' }, { status: 400 });
            }
            updateData.isDefault = body.isDefault;
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        if (updateData.isDefault === false && existing.isDefault) {
            return NextResponse.json(
                { error: 'Cannot unset default directly. Set another ambulatory as default first.' },
                { status: 409 }
            );
        }

        // WUL-268 (STREAM A): promoting to default clears the flag on every other
        // ambulatory then sets it here; both writes must be atomic so a crash can
        // never leave zero or two defaults. Transaction is synchronous (no awaits).
        dbServer.transaction((tx) => {
            if (updateData.isDefault === true) {
                tx.update(ambulatories)
                    .set({ isDefault: false })
                    .where(ne(ambulatories.id, id))
                    .run();
            }

            tx.update(ambulatories).set(updateData).where(eq(ambulatories.id, id)).run();
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(`API PUT /ambulatories/${id} error:`, error);
        return NextResponse.json({ error: "Failed to update ambulatory" }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { id } = await params;
    try {
        const existing = await dbServer
            .select({ id: ambulatories.id, isDefault: ambulatories.isDefault })
            .from(ambulatories)
            .where(eq(ambulatories.id, id))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const linkedPrimaryPatient = await dbServer
            .select({ id: patients.id })
            .from(patients)
            .where(and(eq(patients.ambulatoryId, id), activePatients()))
            .get();
        const linkedPatientAssignment = await dbServer
            .select({ patientId: patientsToAmbulatories.patientId })
            .from(patientsToAmbulatories)
            .where(eq(patientsToAmbulatories.ambulatoryId, id))
            .get();
        if (linkedPrimaryPatient || linkedPatientAssignment) {
            return NextResponse.json(
                { error: 'Ambulatory still has linked patients. Move/unassign patients before deletion.' },
                { status: 409 }
            );
        }

        let fallbackId: string | null = null;
        if (existing.isDefault) {
            const fallback = await dbServer
                .select({ id: ambulatories.id })
                .from(ambulatories)
                .where(ne(ambulatories.id, id))
                .orderBy(desc(ambulatories.createdAt))
                .get();
            if (!fallback) {
                return NextResponse.json({ error: 'Cannot delete the last ambulatory' }, { status: 409 });
            }
            fallbackId = fallback.id;
        }

        // WUL-268 (STREAM A): reassign the default flag and delete the row atomically
        // so a crash can never leave the clinic without a default ambulatory.
        // Transaction is synchronous (no awaits inside).
        dbServer.transaction((tx) => {
            if (fallbackId) {
                tx.update(ambulatories)
                    .set({ isDefault: false })
                    .where(eq(ambulatories.isDefault, true))
                    .run();
                tx.update(ambulatories)
                    .set({ isDefault: true })
                    .where(eq(ambulatories.id, fallbackId))
                    .run();
            }

            tx.delete(ambulatories).where(eq(ambulatories.id, id)).run();
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error(`API DELETE /ambulatories/${id} error:`, error);
        return NextResponse.json({ error: "Failed to delete ambulatory" }, { status: 500 });
    }
}
