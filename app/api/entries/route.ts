import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { entries } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    try {
        let query = dbServer.select().from(entries);

        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(entries.patientId, patientId)) as any;
        }

        const data = await query.orderBy(desc(entries.date));
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const newId = body.id || uuidv4();

        await dbServer.insert(entries).values({
            id: newId,
            patientId: body.patientId,
            type: body.type,
            date: new Date(body.date),
            content: body.content,
            createdAt: new Date()
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        console.error("API POST /entries error:", error);
        return NextResponse.json({ error: `Create Failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
    }
}
