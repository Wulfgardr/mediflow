import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ key: string }> }
) {
    try {
        const { key } = await params;
        const result = await dbServer.select().from(settings).where(eq(settings.key, key)).get();

        if (!result) {
            return NextResponse.json({ key, value: null });
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error("GET Setting Error:", error);
        return NextResponse.json({ error: "Failed to fetch setting" }, { status: 500 });
    }
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ key: string }> }
) {
    try {
        const { key } = await params;
        const body = await request.json();
        const { value } = body;

        if (value === undefined) {
            return NextResponse.json({ error: "Value required" }, { status: 400 });
        }

        await dbServer
            .insert(settings)
            .values({ key, value })
            .onConflictDoUpdate({ target: settings.key, set: { value } });

        return NextResponse.json({ success: true, key, value });
    } catch (error) {
        console.error("PUT Setting Error:", error);
        return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
    }
}
