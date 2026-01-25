
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { key, value } = body;

        if (!key || value === undefined) {
            return NextResponse.json({ error: "Key and value required" }, { status: 400 });
        }

        // Upsert (Insert or Update) logic
        // This allows db.settings.put({ key: '...', value: '...' }) to work via POST
        await dbServer
            .insert(settings)
            .values({ key, value })
            .onConflictDoUpdate({ target: settings.key, set: { value } });

        return NextResponse.json({ success: true, key, value });
    } catch (error) {
        console.error("POST Setting Error:", error);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = (error as any)?.message || String(error);
        return NextResponse.json({ error: `Failed to save setting: ${msg}` }, { status: 500 });
    }
}
