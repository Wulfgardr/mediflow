import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { messages } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        await dbServer.delete(messages).where(eq(messages.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Delete Failed" }, { status: 500 });
    }
}
