/* @Codex: authenticated preview metadata only; no patient writes. */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { ambulatories } from '@/lib/schema';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import * as owner from '@/lib/security/web-auth-lifecycle-owner-adapter';
import { patientCreateContexts } from '@/lib/security/patient-create-context';

export const runtime = 'nodejs';

export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    try {
        const cookieStore = await cookies();
        const selected = cookieStore.get('ambulatory_id')?.value;
        // Match the existing create fallback policy at CAPTURE only. Never repeat at commit.
        const target = selected
            ? dbServer.select({ id: ambulatories.id, name: ambulatories.name }).from(ambulatories).where(eq(ambulatories.id, selected)).get()
            : dbServer.select({ id: ambulatories.id, name: ambulatories.name }).from(ambulatories).where(eq(ambulatories.isDefault, true)).limit(1).get();
        const preview = target ? patientCreateContexts(owner).capture(session, target) : null;
        if (!preview) return NextResponse.json({ error: 'Contesto di creazione non disponibile. Rinnova l’anteprima.' },
            { status: 409, headers: { 'Cache-Control': 'no-store' } });
        return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
        return NextResponse.json({ error: 'Contesto di creazione non disponibile.' },
            { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
}
