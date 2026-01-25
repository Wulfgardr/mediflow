import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { patients } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { desc, eq } from 'drizzle-orm';

export async function GET() {
    try {
        const allPatients = await dbServer.select().from(patients).orderBy(desc(patients.updatedAt));
        return NextResponse.json(allPatients);
    } catch (error) {
        console.error("API GET /patients error:", error);
        return NextResponse.json({ error: "Failed to fetch patients" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const newId = body.id || uuidv4();

        await dbServer.insert(patients).values({
            id: newId,
            firstName: body.firstName,
            lastName: body.lastName,
            taxCode: body.taxCode,
            birthDate: body.birthDate ? new Date(body.birthDate) : null,
            address: body.address,
            phone: body.phone,
            notes: body.notes || null,
            isAdi: body.isAdi || false,
            updatedAt: new Date(),
            createdAt: new Date()
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        console.error("API POST /patients error:", error);
        return NextResponse.json({ error: "Failed to create patient" }, { status: 500 });
    }
}
