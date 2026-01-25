import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { therapies } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    try {
        let query = dbServer.select().from(therapies);

        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(therapies.patientId, patientId)) as any;
        }

        const data = await query.orderBy(desc(therapies.startDate));
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const newId = body.id || uuidv4(); // Consistent ID handling
        await dbServer.insert(therapies).values({
            id: newId,
            patientId: body.patientId,
            drugName: body.drugName,
            dosage: body.dosage,
            status: body.status || 'active',
            startDate: new Date(body.startDate),
            endDate: body.endDate ? new Date(body.endDate) : null,
            createdAt: new Date()
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("API POST /therapies error:", error);
        return NextResponse.json({ error: `Create Failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
    }
}
