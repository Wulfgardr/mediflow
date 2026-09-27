/* @Codex: child-process SQLite fixture; synthetic test data only. */
import { dbServer } from '../../lib/db-server.ts';
import { patients } from '../../lib/schema.ts';
import { eq } from 'drizzle-orm';
import { updateHostProstheticPrescription } from '../../lib/prosthetic-prescription-write.ts';
import type { ServerSession } from '../../lib/security/server-session';

const [mode, patientId, id] = process.argv.slice(2);
/* @Codex: both processes must finish startup before the parent releases either writer. */
if (mode === 'update') {
    process.stdout.write('READY\n');
    await new Promise<void>((resolve, reject) => {
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', (value: string) => value === 'GO\n' ? resolve() : reject(new Error('Invalid synthetic barrier signal')));
    });
}
if (mode === 'tombstone') {
    dbServer.update(patients).set({ deletedAt: new Date('2026-05-02') }).where(eq(patients.id, patientId)).run();
    process.stdout.write(JSON.stringify({ status: 'tombstoned' }));
} else if (mode === 'update') {
    const session: ServerSession = { id: 'synthetic-process-session', userId: 'synthetic-process-user', username: patientId, role: 'admin', authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
    try {
        const result = await updateHostProstheticPrescription({ request: new Request('http://localhost/test'), session, id }, { version: 3, description: 'ENC:synthetic:process' });
        process.stdout.write(JSON.stringify(result));
    } catch (error) {
        process.stdout.write(JSON.stringify({ error: String(error) }));
        process.exitCode = 1;
    }
} else throw new Error('Unknown synthetic process mode');
dbServer.$client.close();
