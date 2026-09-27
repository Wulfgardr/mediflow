/* @Codex: independent SQLite process for service prescription race tests. */
import { eq } from 'drizzle-orm';
import { dbServer } from '../../lib/db-server.ts';
import { patients } from '../../lib/schema.ts';
import { updateHostServicePrescription } from '../../lib/service-prescription-write.ts';

const [mode, patientId, prescriptionId] = process.argv.slice(2);
if (mode === 'update') {
    process.stdout.write('READY\n');
    await new Promise<void>((resolve, reject) => {
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', (value: string) => value === 'GO\n' ? resolve() : reject(new Error('Invalid synthetic barrier signal')));
    });
    try {
        const result = await updateHostServicePrescription({
            id: prescriptionId,
            request: new Request('http://localhost/test'),
            session: { id: 'synthetic-child', userId: 'synthetic-user', username: 'synthetic', role: 'admin', authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000 },
        }, { version: 3, serviceName: 'ENC:synthetic:race' });
        process.stdout.write(JSON.stringify(result));
    } catch (error) { process.stdout.write(JSON.stringify({ error: String(error) })); }
} else if (mode === 'tombstone') {
    dbServer.update(patients).set({ deletedAt: new Date('2026-05-03') }).where(eq(patients.id, patientId)).run();
    process.stdout.write(JSON.stringify({ status: 'tombstoned' }));
}
dbServer.$client.close();
