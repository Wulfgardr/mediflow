import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { drugs } from '@/lib/schema';
import { sql } from 'drizzle-orm';

export async function GET(request: Request) {
    // Basic search implementation or fetch all
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    try {
        if (query) {
            const results = await dbServer.select().from(drugs)
                .where(sql`${drugs.name} LIKE ${`%${query}%`}`)
                .limit(50);
            return NextResponse.json(results);
        }

        // Return full count or limited set?
        // ApiTable.count calls .toArray(), effectively fetching EVERYTHING.
        // For 50k+ drugs this is bad. But for now we just support basic dump if needed
        // Ideally we should implement a dedicated count endpoint
        const all = await dbServer.select().from(drugs);
        return NextResponse.json(all);
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Failed to fetch drugs" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // ApiTable.add sends a single item. ApiTable.bulkPut sends an ARRAY? 
        // Wait, ApiTable.bulkPut implementation: 
        // async bulkPut(items: T[]): Promise<void> { await Promise.all(items.map(item => this.put(item))); }
        // THIS IS THE PROBLEM. It sends 2000 parallel requests for a batch. 
        // This will overwhelm the server or hit limits.

        // HOWEVER, the schema shows 'drugs' table is defined.
        // AND the user complained about "Error during import".

        // Ideally, we want a BULK insert endpoint.
        // But ApiTable.bulkPut implementation is naive.

        // If the body is an array, we handle it as bulk.
        // If it's an object, we handle it as single insert.

        if (Array.isArray(body)) {
            // Handle bulk insert
            // SQLite insert many
            await dbServer.insert(drugs).values(body).onConflictDoUpdate({
                target: drugs.aic,
                set: {
                    name: sql`excluded.name`,
                    activePrinciple: sql`excluded.active_principle`,
                    company: sql`excluded.company`,
                    packaging: sql`excluded.packaging`,
                    price: sql`excluded.price`,
                    atc: sql`excluded.atc`
                }
            });
            return NextResponse.json({ success: true, count: body.length });
        } else {
            await dbServer.insert(drugs).values(body).onConflictDoUpdate({
                target: drugs.aic,
                set: {
                    name: sql`excluded.name`,
                    activePrinciple: sql`excluded.active_principle`,
                    company: sql`excluded.company`,
                    packaging: sql`excluded.packaging`,
                    price: sql`excluded.price`,
                    atc: sql`excluded.atc`
                }
            });
            return NextResponse.json({ id: body.aic });
        }

    } catch (e) {
        console.error("Drug import failed", e);
        return NextResponse.json({ error: "Failed to insert drug(s)" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    // Handle clear() -> effectively delete all
    // ApiTable.clear() calls toArray() then bulkDelete(). 
    // This is TERRIBLE for 50k items.
    // We should support "DELETE /api/drugs" to wipe the table.

    // Check if it's a bulk delete of IDs or a full wipe
    // ApiTable.delete uses DELETE /api/drugs/:id

    // Ideally we intercept the specific call.
    // But since ApiTable.clear implementation is:
    // const items = await this.toArray(); 
    // await this.bulkDelete(items.map(i => i.id));

    // This means it fetches 50MB JSON, then fires 50,000 DELETE requests.
    // This IS the performance bottleneck / crash.

    // FIX: 
    // 1. Refactor ApiTable.clear to use a specific endpoint or method if possible.
    // 2. OR just handle this DELETE logic here if we can.

    // Since ApiTable is generic, modifying it might break others? 
    // No, clear() is rare. 

    // I will implement a "DELETE /api/drugs" which clears everything?
    // But ApiTable.delete(id) calls the Same URL with ID.
    // DELETE /api/drugs   Running this without ID could imply "delete all"?
    // Standard REST usually forbids this, but for internal API it's fine.

    try {
        await dbServer.delete(drugs);
        return NextResponse.json({ success: true });
    } catch (_e) {
        return NextResponse.json({ error: "Failed to clear drugs" }, { status: 500 });
    }
}
