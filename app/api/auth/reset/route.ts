import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';

export async function POST() {
    try {
        // Delete all users. This effectively resets the onboarding state.
        await dbServer.delete(users);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Reset error:", error);
        return NextResponse.json({ error: "Reset failed" }, { status: 500 });
    }
}
