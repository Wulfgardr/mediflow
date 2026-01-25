import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { checkups } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    try {
        let query = dbServer.select().from(checkups);

        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(checkups.patientId, patientId)) as any;
        }

        const data = await query.orderBy(desc(checkups.date));
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch checkups" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        // Allow client to generate ID or generate it here. 
        // ApiTable shim might send an ID if it's "add" with specific ID, but usually it relies on return.
        // However, if the client sends an ID, we should respect it or overwrite. 
        // Let's see `entries` implementation: it generates new ID server side.
        // But `ApiTable.add` might expect the ID back or might have generated one client side (Dexie style).
        // If the body has an id, use it, otherwise generate one.

        const newId = body.id || uuidv4();

        await dbServer.insert(checkups).values({
            id: newId,
            patientId: body.patientId,
            date: new Date(body.date),
            title: body.title,
            status: body.status || 'pending',
            createdAt: new Date()
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        console.error("Checkup create error", error);
        return NextResponse.json({ error: "Create Failed" }, { status: 500 });
    }
}
