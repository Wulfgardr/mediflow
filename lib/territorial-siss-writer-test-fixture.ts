import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ServerSession } from './security/server-session';

/** Only authentication is substituted; requests execute the production SISS handlers. */
export function installTerritorialSissWriter(directory: string, session: ServerSession, generation: string) {
    const auth = join(directory, 'siss-auth.cjs');
    writeFileSync(auth, `exports.requireSession=async()=>(${JSON.stringify(session)});
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});`);
    const load = createRequire(import.meta.url);
    const { registerHooks } = load('node:module') as {
        registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
            next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister(): void };
    };
    const hooks = registerHooks({ resolve(specifier, context, next) {
        if (specifier === '@/lib/security/server-auth') return { url: pathToFileURL(auth).href, shortCircuit: true };
        return next(specifier, context);
    } });
    const create = load('../app/api/siss-handoffs/route.ts') as typeof import('../app/api/siss-handoffs/route');
    const item = load('../app/api/siss-handoffs/[id]/route.ts') as typeof import('../app/api/siss-handoffs/[id]/route');
    let serial = 0;
    return {
        close: () => hooks.deregister(),
        async write(cached?: unknown, method: 'POST' | 'PUT' | 'DELETE' = 'POST') {
            const id = `synthetic-territorial-${serial++}`;
            const request = new Request('http://localhost/api/siss-handoffs', { method, headers: {
                'content-type': 'application/json', 'x-mediflow-archive-generation': generation,
                ...(cached ? { 'x-mediflow-territorial-packs': JSON.stringify(cached) } : {}),
            }, body: JSON.stringify({ id: method === 'POST' ? id : undefined,
                patientId: 'synthetic-patient', ...(method === 'POST' ? { action: 'prosthetics.open' } : method === 'PUT' ? { version: 1, notes: 'ENC:synthetic' } : { version: 1 }) }) });
            return method === 'POST' ? create.POST(request) : item[method](request, { params: Promise.resolve({ id: 'synthetic-handoff' }) });
        },
    };
}
