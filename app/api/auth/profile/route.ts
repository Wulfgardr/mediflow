import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { id, displayName, ambulatoryName } = body;

        if (!id) {
            return NextResponse.json({ error: "User ID is required" }, { status: 400 });
        }

        await dbServer.update(users)
            .set({
                displayName,
                ambulatoryName,
            })
            .where(eq(users.id, id));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Profile update error:", error);
        return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
}
