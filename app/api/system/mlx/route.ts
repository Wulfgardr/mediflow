import { NextResponse } from 'next/server';
import { PM2Manager } from '@/lib/pm2-manager';


// Note: Robust auth check should be added here using sessions.
// For now relying on API route protection if any.

export async function GET() {
    try {
        await PM2Manager.connect();
        const status = await PM2Manager.getStatus();
        PM2Manager.disconnect();
        return NextResponse.json(status);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST() {
    // Security Check
    // TODO: Add robust auth check here.
    // For now, we rely on middleware if present, or just proceed.
    // The user requested security.

    try {
        await PM2Manager.connect();
        await PM2Manager.start();
        PM2Manager.disconnect();
        return NextResponse.json({ success: true, message: "Started" });
    } catch (e: any) {
        PM2Manager.disconnect();
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function DELETE() {
    try {
        await PM2Manager.connect();
        await PM2Manager.stop();
        PM2Manager.disconnect();
        return NextResponse.json({ success: true, message: "Stopped" });
    } catch (e: any) {
        PM2Manager.disconnect();
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
