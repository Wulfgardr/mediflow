#!/usr/bin/env node

/* WUL-347. Nessuna route API deve rimandare al client il `message` grezzo di
   un'eccezione.

   Perche' un guard e non solo una correzione: le route sono 140 e ne nascono di
   nuove. La correzione di oggi vale un giorno, la regola vale finche' gira.

   Che cosa cerca, e perche' non basta una riga sola. Il caso ovvio e'
   `NextResponse.json({ error: e.message })`. Quello che sfugge, e che nel repo
   era la maggioranza, e' l'indiretto:

       const message = error instanceof Error ? error.message : 'Unknown error';
       return NextResponse.json({ error: message }, { status: 500 });

   Il guard lavora quindi per blocco `catch`: dentro ogni catch traccia le
   variabili che derivano da `<binding>.message` e segnala se una di quelle, o
   `.message` direttamente, finisce dentro una risposta.

   Cosa NON e' un leak: un messaggio di dominio scelto da chi scrive la route e
   destinato all'operatore (per esempio il rifiuto di un import AIFA malformato).
   Quelli stanno in ALLOWLIST con un motivo scritto, e l'allowlist e' verificata:
   una voce che non corrisponde piu' a nulla fa fallire il guard invece di
   restare li' a marcire. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const apiRoot = path.join(repoRoot, 'app', 'api');

const ALLOWLIST = [
    {
        file: 'app/api/drugs/route.ts',
        motivo:
            "Il messaggio proviene da replaceAifaCatalog ed e' una diagnosi di dominio sull'import "
            + "(file malformato, colonne mancanti), non il testo di un'eccezione di sistema. Rimuoverlo "
            + 'lascerebbe l\'operatore senza indicazione su un import da centinaia di righe. Status 400, '
            + 'non 500: e\' un rifiuto, non un guasto.',
    },
    {
        file: 'app/api/siss/context/route.ts',
        motivo:
            "Il ramo segnalato e' `error instanceof SissPatientContextError`: una classe di dominio "
            + 'tipizzata che porta gia' + "' `code`, `correlationId` e `status`. Il suo `message` e' testo "
            + "d'errore autoriale sul flusso SISS, non il testo di un'eccezione di sistema, e serve "
            + 'al supporto per correlare il fallimento. Il ramo generico sottostante non lo espone.',
    },
    {
        file: 'app/api/siss/prescription/route.ts',
        motivo:
            "Stesso caso di siss/context, con SissPrescriptionError: errore di dominio tipizzato con "
            + '`code` e `correlationId`, restituito deliberatamente. Il ramo generico sottostante non '
            + 'espone il messaggio grezzo.',
    },
];

const RISPOSTA = /\b(?:NextResponse|Response)\s*\.\s*json\s*\(/g;

function elencaRoute(dir) {
    const out = [];
    for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, voce.name);
        if (voce.isDirectory()) out.push(...elencaRoute(p));
        else if (voce.name === 'route.ts') out.push(p);
    }
    return out;
}

/* Ritorna il testo fra la parentesi aperta a `start` e la sua chiusura. */
function argomento(testo, start) {
    let profondita = 0;
    for (let i = start; i < testo.length; i += 1) {
        const c = testo[i];
        if (c === '(') profondita += 1;
        else if (c === ')') {
            profondita -= 1;
            if (profondita === 0) return testo.slice(start + 1, i);
        }
    }
    return testo.slice(start);
}

/* Blocchi catch, con il loro binding e il corpo bilanciato. */
function blocchiCatch(testo) {
    const blocchi = [];
    const re = /catch\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{/g;
    let m;
    while ((m = re.exec(testo)) !== null) {
        const apertura = testo.indexOf('{', m.index + m[0].length - 1);
        let profondita = 0;
        let fine = testo.length;
        for (let i = apertura; i < testo.length; i += 1) {
            if (testo[i] === '{') profondita += 1;
            else if (testo[i] === '}') {
                profondita -= 1;
                if (profondita === 0) { fine = i; break; }
            }
        }
        blocchi.push({
            binding: m[1],
            corpo: testo.slice(apertura, fine),
            riga: testo.slice(0, m.index).split('\n').length,
        });
    }
    return blocchi;
}

function analizza(file) {
    const relativo = path.relative(repoRoot, file).split(path.sep).join('/');
    const testo = fs.readFileSync(file, 'utf8');
    const reperti = [];

    for (const blocco of blocchiCatch(testo)) {
        const { binding, corpo } = blocco;

        /* Variabili che ereditano il messaggio dell'eccezione. */
        const derivate = new Set();
        const reDerivata = new RegExp(
            `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=[^;]*\\b${binding}\\s*\\.\\s*message`,
            'g',
        );
        let d;
        while ((d = reDerivata.exec(corpo)) !== null) derivate.add(d[1]);

        RISPOSTA.lastIndex = 0;
        let r;
        while ((r = RISPOSTA.exec(corpo)) !== null) {
            const arg = argomento(corpo, RISPOSTA.lastIndex - 1);
            const diretto = new RegExp(`\\b${binding}\\s*\\.\\s*message\\b`).test(arg);
            const indiretta = [...derivate].find((v) => new RegExp(`\\b${v}\\b`).test(arg));
            if (diretto || indiretta) {
                reperti.push({
                    file: relativo,
                    riga: blocco.riga,
                    via: diretto ? `${binding}.message` : `variabile «${indiretta}» derivata da ${binding}.message`,
                });
            }
        }
    }
    return reperti;
}

const selfTest = process.argv.includes('--self-test');

if (selfTest) {
    const casi = [
        { nome: 'diretto', codice: "export async function GET(){try{}catch(e){return NextResponse.json({error:e.message},{status:500})}}", atteso: true },
        { nome: 'indiretto via const', codice: "export async function GET(){try{}catch(error){const message = error instanceof Error ? error.message : 'x'; return NextResponse.json({error:message},{status:500})}}", atteso: true },
        { nome: 'template literal', codice: "export async function GET(){try{}catch(error){return NextResponse.json({error:`Fallito: ${error.message}`},{status:500})}}", atteso: true },
        { nome: 'solo log server', codice: "export async function GET(){try{}catch(error){console.error('x', error.message); return NextResponse.json({error:'Errore interno.'},{status:500})}}", atteso: false },
        { nome: 'messaggio letterale', codice: "export async function GET(){try{}catch(error){return NextResponse.json({error:'Errore interno.',code:'internal_error'},{status:500})}}", atteso: false },
        { nome: 'helper', codice: "export async function GET(){try{}catch(error){return apiInternalError('GET /x', error)}}", atteso: false },
    ];
    let falliti = 0;
    const tmp = path.join(repoRoot, '.tmp-api-error-leak-selftest.ts');
    for (const caso of casi) {
        fs.writeFileSync(tmp, caso.codice);
        const trovato = analizza(tmp).length > 0;
        const ok = trovato === caso.atteso;
        if (!ok) falliti += 1;
        console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${caso.nome} (atteso ${caso.atteso ? 'leak' : 'pulito'}, trovato ${trovato ? 'leak' : 'pulito'})`);
    }
    fs.rmSync(tmp, { force: true });
    if (falliti > 0) { console.error(`\nself-test: ${falliti} caso/i fallito/i`); process.exitCode = 1; }
    else console.log('\nself-test: tutti i casi passano');
} else {
    const route = elencaRoute(apiRoot);
    const tutti = route.flatMap(analizza);
    const consentiti = new Set(ALLOWLIST.map((v) => v.file));

    const violazioni = tutti.filter((r) => !consentiti.has(r.file));
    const usati = new Set(tutti.filter((r) => consentiti.has(r.file)).map((r) => r.file));
    const stantii = ALLOWLIST.filter((v) => !usati.has(v.file));

    console.log(JSON.stringify({
        schemaVersion: 'mediflow.api-error-leak.v1',
        routeAnalizzate: route.length,
        violazioni,
        allowlist: ALLOWLIST.map((v) => ({ file: v.file, ancoraNecessaria: usati.has(v.file) })),
    }, null, 2));

    if (violazioni.length > 0) {
        console.error('\nLeak di error.message verso il client:');
        for (const v of violazioni) console.error(`- ${v.file}:${v.riga} — ${v.via}`);
        console.error('\nUsare apiInternalError() da lib/api-error-response.ts: logga il dettaglio e restituisce un messaggio stabile.');
        process.exitCode = 1;
    }
    if (stantii.length > 0) {
        console.error('\nVoci di allowlist che non corrispondono piu\' a nulla (rimuoverle):');
        for (const v of stantii) console.error(`- ${v.file}`);
        process.exitCode = 1;
    }
}
