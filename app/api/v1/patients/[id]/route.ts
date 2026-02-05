// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import type { PatientDetail } from '@/lib/api/v1/types';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { id } = await params;
        const patient = await dbServer.select().from(patients).where(eq(patients.id, id)).get();

        if (!patient) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const result: PatientDetail = {
            id: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            birthDate: toIsoString(patient.birthDate),
            taxCode: patient.taxCode,
            address: patient.address ?? null,
            phone: patient.phone ?? null,
            caregiver: patient.caregiver ?? null,
            notes: patient.notes ?? null,
            isAdi: patient.isAdi ?? null,
            isArchived: patient.isArchived ?? null,
            ambulatoryId: patient.ambulatoryId ?? null,
            createdAt: toIsoString(patient.createdAt),
            updatedAt: toIsoString(patient.updatedAt)
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('API GET /api/v1/patients/[id] error:', error);
        return NextResponse.json({ error: 'Failed to fetch patient' }, { status: 500 });
    }
}
