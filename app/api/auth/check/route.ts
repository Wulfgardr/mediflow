import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';
import { count } from 'drizzle-orm';

export async function GET() {
    try {
        // Count users efficiently
        const result = await dbServer.select({ count: count() }).from(users);
        const userCount = result[0].count;

        return NextResponse.json({
            isSetup: userCount > 0
        });
    } catch (error) {
        // If table completely missing (first run before migration applied?), treat as true to avoid loops or handle gracefully
        console.error("Auth check error:", error);
        return NextResponse.json({ isSetup: false });
    }
}
