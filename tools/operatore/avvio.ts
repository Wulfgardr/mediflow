import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import path from 'node:path';

export async function revisioneInEsecuzione(origin: string): Promise<string | null> {
    try {
        const response = await globalThis.fetch(new URL('/api/system/revision', origin), { cache: 'no-store', signal: AbortSignal.timeout(3_000) });
        if (!response.ok) return null;
        const payload = await response.json() as { revision?: unknown; sourceFingerprint?: unknown };
        return typeof payload.revision === 'string' ? payload.revision : typeof payload.sourceFingerprint === 'string' ? payload.sourceFingerprint : 'sconosciuta';
    } catch { return null; }
}

export async function avviaSeServe(options: { origin: string; installazione: string; cartellaStato: string; attesaMs: number }):
    Promise<{ avviato: boolean; revisione: string | null }> {
    const giaAttiva = await revisioneInEsecuzione(options.origin);
    if (giaAttiva) return { avviato: false, revisione: giaAttiva };
    mkdirSync(options.cartellaStato, { recursive: true, mode: 0o700 });
    const registro = openSync(path.join(options.cartellaStato, 'avvio.log'), 'a', 0o600);
    const porta = new URL(options.origin).port || '3000';
    const figlio = spawn(process.execPath, [path.join(options.installazione, 'scripts', 'mediflow.mjs'), '--scelta', 'web', '--senza-browser'], {
        cwd: options.installazione, detached: true, stdio: ['ignore', registro, registro], env: { ...process.env, PORT: porta },
    });
    figlio.unref();
    const scadenza = Date.now() + options.attesaMs;
    while (Date.now() < scadenza) {
        await new Promise(resolve => setTimeout(resolve, 2_000));
        const revisione = await revisioneInEsecuzione(options.origin);
        if (revisione) return { avviato: true, revisione };
    }
    throw new Error(`MediFlow non risponde dopo l’avvio: vedi ${path.join(options.cartellaStato, 'avvio.log')}.`);
}
