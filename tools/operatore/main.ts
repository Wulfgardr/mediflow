import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { installaAmbienteOperatore } from './ambiente';
import { avviaSeServe, revisioneInEsecuzione } from './avvio';
import {
    fermoPerRifiuto, leggiCredenzialiDaStdin, leggiCredenzialiDalPortachiavi, rimuoviCredenzialiDalPortachiavi, salvaCredenzialiNelPortachiavi,
    type Credenziali,
} from './credenziali';

const USO = `Uso: mediflow-operatore <comando> [opzioni]

Comandi
  stato                      server, revisione, operatore acceso o spento
  configura                  legge {"segreto":"…","pin":"…"} dallo standard input, prova l'accesso e lo salva nel Portachiavi
  spegni                     toglie le credenziali dal Portachiavi
  avvia                      avvia MediFlow senza launcher né browser, se non risponde già
  accedi                     prova l'accesso e rinnova i mandati degli agenti collegati
  dossier --cartella DIR     importa una cartella come il Dossier: crea le schede nuove, salva gli originali, applica il verificato
        [--estrazione FILE]  estrazione preparata (mediflow.dossier_prepared)
        [--senza-creare]     non crea schede nuove
        [--senza-applicare]  legge e riporta, senza salvare né applicare
        [--ricevuta FILE]    esito per scheda (ultime 4 cifre del CF), permessi 0600

Opzioni comuni
  --url URL                  MediFlow sul loopback (predefinito http://127.0.0.1:$PORT o :3000)
  --credenziali-stdin        credenziali dallo standard input invece che dal Portachiavi
  --avvia                    avvia MediFlow prima del comando, se serve
`;

const CARTELLA_STATO = process.env.MEDIFLOW_OPERATORE_STATO
    || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow Operatore') : path.join(os.homedir(), '.mediflow-operatore'));

function stampa(valore: unknown) { process.stdout.write(`${JSON.stringify(valore, null, 2)}\n`); }
function avviso(messaggio: string) { process.stderr.write(`${messaggio}\n`); }

async function main(argv: string[]): Promise<number> {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
        url: { type: 'string' }, 'credenziali-stdin': { type: 'boolean' }, avvia: { type: 'boolean' },
        cartella: { type: 'string' }, estrazione: { type: 'string' }, ricevuta: { type: 'string' },
        'senza-creare': { type: 'boolean' }, 'senza-applicare': { type: 'boolean' }, aiuto: { type: 'boolean', short: 'h' },
    } });
    const comando = positionals[0];
    if (!comando || values.aiuto) { process.stdout.write(USO); return comando ? 0 : 2; }
    const origin = values.url ?? `http://127.0.0.1:${process.env.PORT || '3000'}`;
    const installazione = process.env.MEDIFLOW_OPERATORE_INSTALLAZIONE || path.resolve(import.meta.dirname ?? process.cwd(), '..', '..');
    const fermo = fermoPerRifiuto(CARTELLA_STATO);

    if (comando === 'spegni') {
        await rimuoviCredenzialiDalPortachiavi();
        stampa({ operatore: 'spento' });
        return 0;
    }
    if (comando === 'avvia' || values.avvia) {
        const esito = await avviaSeServe({ origin, installazione, cartellaStato: CARTELLA_STATO, attesaMs: 240_000 });
        if (comando === 'avvia') { stampa({ mediflow: esito.avviato ? 'avviato' : 'già attivo', revisione: esito.revisione }); return 0; }
    }
    if (comando === 'stato') {
        const credenziali = await leggiCredenzialiDalPortachiavi().then(() => true, () => false);
        stampa({ mediflow: await revisioneInEsecuzione(origin) ?? 'non risponde', operatore: credenziali ? 'acceso' : 'spento',
            ...(fermo.attivo() ? { fermo: fermo.motivo() } : {}) });
        return 0;
    }

    const configurazione = comando === 'configura';
    if (!configurazione && fermo.attivo()) {
        avviso(`Operatore fermo: ${fermo.motivo()}. Ripeti «configura» con le credenziali giuste.`);
        return 3;
    }
    const credenziali: Credenziali = configurazione || values['credenziali-stdin'] ? await leggiCredenzialiDaStdin() : await leggiCredenzialiDalPortachiavi();
    installaAmbienteOperatore({ origin, storageFile: path.join(CARTELLA_STATO, 'lavorazioni.json') });
    const { accedi, chiudiSessione, AccessoRifiutato } = await import('./sessione');

    let sessione;
    try { sessione = await accedi(credenziali); }
    catch (error) {
        if (error instanceof AccessoRifiutato && [400, 401, 403, 423, 429].includes(error.stato)) {
            if (!configurazione) fermo.imposta(error.message);
            avviso(`${error.message} L’operatore si ferma per non bloccare l’account.`);
            return 3;
        }
        throw error;
    }
    try {
        if (configurazione) {
            await salvaCredenzialiNelPortachiavi(credenziali);
            fermo.togli();
            stampa({ operatore: 'acceso', agentiRinnovati: sessione.agentiRinnovati });
            return 0;
        }
        if (comando === 'accedi') { stampa({ accesso: 'riuscito', ruolo: sessione.utente.role, agentiRinnovati: sessione.agentiRinnovati }); return 0; }
        if (comando === 'dossier') {
            if (!values.cartella) { avviso('Serve --cartella.'); return 2; }
            const { importaDossier } = await import('./dossier');
            const riepilogo = await importaDossier({
                cartella: values.cartella, estrazione: values.estrazione ?? null, pin: sessione.pin,
                creaSchede: !values['senza-creare'] && !values['senza-applicare'], applica: !values['senza-applicare'], avanzamento: avviso,
            });
            const { esiti, ...aggregati } = riepilogo;
            if (values.ricevuta) writeFileSync(values.ricevuta, `${JSON.stringify({ ...aggregati, esiti }, null, 2)}\n`, { mode: 0o600 });
            stampa(aggregati);
            return 0;
        }
        avviso(`Comando sconosciuto: ${comando}`);
        process.stdout.write(USO);
        return 2;
    } finally {
        await chiudiSessione();
    }
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    avviso(error instanceof Error ? (process.env.MEDIFLOW_OPERATORE_DIAGNOSI === '1' ? error.stack ?? error.message : error.message) : 'Errore dell’operatore.');
    process.exitCode = 1;
});
