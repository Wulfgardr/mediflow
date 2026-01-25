import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { attachments } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    try {
        let query = dbServer.select().from(attachments);

        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(attachments.patientId, patientId)) as any;
        }

        const data = await query.orderBy(desc(attachments.createdAt));
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch attachments" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const newId = body.id || uuidv4();

        // Note: The actual file upload is handled separately (usually).
        // This endpoint likely stores the metadata of the attachment.
        // If the 'path' doesn't exist, we might need a separate upload endpoint
        // or this endpoint expects the path to be already determined (e.g. valid URL or local path).

        await dbServer.insert(attachments).values({
            id: newId,
            patientId: body.patientId,
            name: body.name,
            type: body.type,
            size: body.size,
            path: body.path,
            createdAt: new Date()
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: "Create Failed" }, { status: 500 });
    }
}
