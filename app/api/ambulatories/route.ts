import { dbServer } from '@/lib/db-server';
import { ambulatories } from '@/lib/schema';
import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

/* @Codex */
function normalizeType(value: unknown): 'live' | 'test' | null {
    if (value === undefined || value === null || value === '') return 'live';
    if (value === 'live' || value === 'test') return value;
    return null;
}

export async function GET() {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const all = await dbServer.select().from(ambulatories).orderBy(desc(ambulatories.createdAt));
        return NextResponse.json(all);
    } catch (error) {
        console.error("API GET /ambulatories error:", error);
        return NextResponse.json({ error: "Failed to fetch ambulatories" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json() as Record<string, unknown>;
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
            return NextResponse.json({ error: 'Ambulatory name is required' }, { status: 400 });
        }

        const type = normalizeType(body.type);
        if (!type) {
            return NextResponse.json({ error: 'Invalid ambulatory type' }, { status: 400 });
        }

        const newId = typeof body.id === 'string' && body.id.trim().length > 0 ? body.id : uuidv4();
        const createdAt = body.createdAt === undefined
            ? new Date()
            : new Date(body.createdAt as string | number | Date);
        if (Number.isNaN(createdAt.getTime())) {
            return NextResponse.json({ error: 'Invalid createdAt' }, { status: 400 });
        }

        let parentId: string | null = null;
        if (Object.prototype.hasOwnProperty.call(body, 'parentId')) {
            if (body.parentId === null || body.parentId === '') {
                parentId = null;
            } else if (typeof body.parentId === 'string') {
                const trimmedParentId = body.parentId.trim();
                parentId = trimmedParentId.length > 0 ? trimmedParentId : null;
            } else {
                return NextResponse.json({ error: 'Invalid parentId' }, { status: 400 });
            }
        }

        if (parentId && parentId === newId) {
            return NextResponse.json({ error: 'parentId cannot match ambulatory id' }, { status: 400 });
        }
        if (parentId) {
            const parent = await dbServer
                .select({ id: ambulatories.id })
                .from(ambulatories)
                .where(eq(ambulatories.id, parentId))
                .get();
            if (!parent) {
                return NextResponse.json({ error: 'Parent ambulatory not found' }, { status: 404 });
            }
        }

        const hasDefault = await dbServer
            .select({ id: ambulatories.id })
            .from(ambulatories)
            .where(eq(ambulatories.isDefault, true))
            .get();
        const shouldBeDefault = body.isDefault === true || !hasDefault;
        if (shouldBeDefault) {
            await dbServer.update(ambulatories).set({ isDefault: false });
        }

        await dbServer.insert(ambulatories).values({
            id: newId,
            name,
            address: typeof body.address === 'string' ? body.address : null,
            parentId,
            type,
            description: typeof body.description === 'string' ? body.description : null,
            isDefault: shouldBeDefault,
            createdAt
        });

        return NextResponse.json({ success: true, id: newId });
    } catch (error) {
        console.error("API POST /ambulatories error:", error);
        return NextResponse.json({ error: "Failed to create ambulatory" }, { status: 500 });
    }
}
