/* @Codex: independent SQLite writer used only with a synthetic temp database. */
import { dbServer } from '../../lib/db-server.ts';
import { updateAmbulatory } from '../../lib/ambulatory-write.ts';

const targetId = process.argv[2];
process.stdout.write('READY\n');
await new Promise<void>((resolve, reject) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (value: string) => value === 'GO\n' ? resolve() : reject(new Error('Invalid synthetic barrier signal')));
});
const session: Parameters<typeof updateAmbulatory>[0]['session'] = {
    id: 'synthetic-process-session', userId: 'synthetic-process-user', username: 'synthetic',
    role: 'admin', authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
};
try {
    const result = updateAmbulatory({ request: new Request('http://localhost/test'), session }, targetId,
        { version: 3, isDefault: true, name: 'Synthetic process change' });
    process.stdout.write(JSON.stringify(result));
} catch (error) {
    process.stdout.write(JSON.stringify({ error: String(error) }));
}
dbServer.$client.close();
