import fs from 'node:fs';
import path from 'node:path';
import { MAX_RECOVERY_BACKUP_BYTES, parseRecoveryKit } from '../lib/recovery-backup.ts';
import { restoreRecoveryBackup } from '../lib/recovery-backup-server.ts';

/** TTY only: neither pipes, argv, environment variables nor echo can carry the recovery key. */
async function hiddenRecoveryKey(): Promise<string> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Serve un terminale interattivo.');
    const previousRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true); process.stdin.resume();
    return new Promise((resolve, reject) => {
        let value = '';
        const finish = (error?: Error) => {
            process.stdin.off('data', receive); process.stdin.setRawMode(previousRaw); process.stdin.pause();
            process.stdout.write('\n');
            if (error) { value = ''; reject(error); } else resolve(value);
        };
        const receive = (chunk: Buffer) => {
            for (const character of chunk.toString('utf8')) {
                if (character === '\u0003' || character === '\u0004') { finish(new Error('Recupero annullato.')); return; }
                if (character === '\r' || character === '\n') { finish(); return; }
                if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
                else if (/^[a-zA-Z0-9 -]$/u.test(character) && value.length < 128) value += character;
            }
        };
        process.stdin.on('data', receive);
        // Publish the prompt only after echo is disabled and the reader is attached.
        process.stdout.write('Chiave di recupero (non visibile): ');
    });
}

async function main() {
    const args = process.argv.slice(2);
    const fields = new Map<string, string>();
    let retired = false;
    for (let index = 0; index < args.length; index++) {
        const name = args[index];
        if (name === '--source-retired' && !retired) { retired = true; continue; }
        if (!['--backup', '--kit', '--data-dir'].includes(name) || fields.has(name) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error();
        fields.set(name, path.resolve(args[++index]));
    }
    if (!retired || fields.size !== 3) throw new Error();
    const requestedData = fields.get('--data-dir')!;
    if (!fs.lstatSync(requestedData).isDirectory()) throw new Error();
    const data = fs.realpathSync(requestedData);
    const read = (file: string, maximum: number) => {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error();
        return fs.readFileSync(file);
    };
    const kit = parseRecoveryKit(read(fields.get('--kit')!, 4096).toString('utf8'));
    const artifact = read(fields.get('--backup')!, MAX_RECOVERY_BACKUP_BYTES);
    let recoveryKey = await hiddenRecoveryKey();
    try {
        await restoreRecoveryBackup({ artifact, kit, recoveryKey, destination: path.join(data, 'medical.db') });
        console.log('Archivio ripristinato. Avvia MediFlow con questa cartella dati e scegli «Recupera con kit e chiave» per impostare la nuova passphrase. Non riutilizzare l’installazione sorgente.');
    } finally { recoveryKey = ''; }
}

void main().catch(() => {
    console.error('Recupero non completato. Controlla file, kit, chiave e cartella vuota; chiudi MediFlow. Se il ripristino era già iniziato, conserva la cartella e lo stato di manutenzione per il recupero.');
    console.error('Uso: npm run recovery:restore -- --backup FILE --kit FILE --data-dir CARTELLA --source-retired');
    process.exitCode = 1;
});
