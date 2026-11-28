import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';

export type Credenziali = Readonly<{ segreto: string; pin: string }>;

export const SERVIZIO_PORTACHIAVI = process.env.MEDIFLOW_OPERATORE_PORTACHIAVI || 'it.mediflow.operatore';
const VOCI = { segreto: 'accesso', pin: 'pin' } as const;
const eseguiFile = promisify(execFile);

function validaCredenziali(valore: unknown): Credenziali {
    const input = valore && typeof valore === 'object' ? valore as Record<string, unknown> : {};
    const segreto = typeof input.segreto === 'string' ? input.segreto : '';
    const pin = typeof input.pin === 'string' ? input.pin : '';
    if (!segreto || segreto.length > 256 || !/^\d{4,12}$/u.test(pin)) {
        throw new Error('Credenziali dell’operatore incomplete: servono il segreto di accesso (passphrase o PIN) e il PIN di conferma.');
    }
    return { segreto, pin };
}

export async function leggiCredenzialiDaStdin(stdin: NodeJS.ReadableStream = process.stdin): Promise<Credenziali> {
    const parti: Buffer[] = [];
    for await (const parte of stdin) parti.push(Buffer.isBuffer(parte) ? parte : Buffer.from(String(parte)));
    const testo = Buffer.concat(parti).toString('utf8');
    parti.forEach(parte => parte.fill(0));
    return validaCredenziali(JSON.parse(testo));
}

async function leggiVoce(account: string): Promise<string> {
    const { stdout } = await eseguiFile('/usr/bin/security', ['find-generic-password', '-s', SERVIZIO_PORTACHIAVI, '-a', account, '-w'], { encoding: 'utf8' });
    return stdout.replace(/\n$/u, '');
}

export async function leggiCredenzialiDalPortachiavi(): Promise<Credenziali> {
    if (process.platform !== 'darwin') throw new Error('Il Portachiavi è disponibile solo su macOS: usa --credenziali-stdin.');
    try {
        return validaCredenziali({ segreto: await leggiVoce(VOCI.segreto), pin: await leggiVoce(VOCI.pin) });
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('Credenziali dell')) throw error;
        throw new Error('Operatore spento: nessuna credenziale nel Portachiavi. Accendilo con «operatore configura».');
    }
}

function citazione(valore: string): string {
    return `"${valore.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

async function scriviPortachiavi(comandi: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const figlio = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
        let errore = '';
        figlio.stderr.on('data', parte => { errore += String(parte); });
        figlio.on('error', reject);
        figlio.on('close', code => code === 0 && !/error/iu.test(errore) ? resolve() : reject(new Error('Il Portachiavi ha rifiutato la scrittura.')));
        figlio.stdin.end(`${comandi.join('\n')}\n`);
    });
}

export async function salvaCredenzialiNelPortachiavi(credenziali: Credenziali): Promise<void> {
    if (process.platform !== 'darwin') throw new Error('Il Portachiavi è disponibile solo su macOS.');
    const valide = validaCredenziali(credenziali);
    await scriviPortachiavi(Object.entries(VOCI).map(([campo, account]) =>
        `add-generic-password -U -s ${SERVIZIO_PORTACHIAVI} -a ${account} -l ${citazione('MediFlow operatore locale')} -w ${citazione(valide[campo as keyof Credenziali])}`));
}

export async function rimuoviCredenzialiDalPortachiavi(): Promise<void> {
    if (process.platform !== 'darwin') return;
    for (const account of Object.values(VOCI)) {
        await eseguiFile('/usr/bin/security', ['delete-generic-password', '-s', SERVIZIO_PORTACHIAVI, '-a', account]).catch(() => undefined);
    }
}

export function fermoPerRifiuto(cartellaStato: string) {
    const file = path.join(cartellaStato, 'credenziali-rifiutate');
    return {
        attivo: () => existsSync(file),
        motivo: () => { try { return readFileSync(file, 'utf8').trim(); } catch { return ''; } },
        imposta(motivo: string) {
            mkdirSync(cartellaStato, { recursive: true, mode: 0o700 });
            writeFileSync(file, `${new Date().toISOString()} ${motivo}\n`, { mode: 0o600 });
        },
        togli() { rmSync(file, { force: true }); },
    };
}
