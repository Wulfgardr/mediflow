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

/* Indice della graffa che chiude quella aperta in `apertura`. */
function fineBlocco(testo, apertura) {
    let profondita = 0;
    for (let i = apertura; i < testo.length; i += 1) {
        if (testo[i] === '{') profondita += 1;
        else if (testo[i] === '}') {
            profondita -= 1;
            if (profondita === 0) return i;
        }
    }
    return testo.length;
}

/* Indice della parentesi che chiude quella aperta in `start`. */
function chiusuraParen(testo, start) {
    let profondita = 0;
    for (let i = start; i < testo.length; i += 1) {
        if (testo[i] === '(') profondita += 1;
        else if (testo[i] === ')') {
            profondita -= 1;
            if (profondita === 0) return i;
        }
    }
    return testo.length;
}

/* WUL-547. Estensione della regione di ricerca oltre il corpo del catch: una
   variabile dichiarata fuori e assegnata dentro sopravvive al blocco, e la
   risposta che la espone puo' stare dopo — e' la forma di
   `app/api/auth/check/route.ts`, invisibile finche' si guardava il solo corpo.

   La ricerca si ferma pero' alla fine dell'handler che contiene il catch. Senza
   quel confine una variabile omonima in un altro handler dello stesso file
   diventerebbe un falso positivo, e `msg`/`message` sono nomi comuni. */
function handlerSpans(testo) {
    const spans = [];
    const re = /\bexport\s+(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/g;
    while (re.exec(testo) !== null) {
        /* La lista parametri puo' contenere `{` (destructuring): si salta alla sua
           parentesi di chiusura prima di cercare la graffa del corpo. */
        const apertura = testo.indexOf('{', chiusuraParen(testo, re.lastIndex - 1));
        if (apertura === -1) continue;
        spans.push({ inizio: apertura, fine: fineBlocco(testo, apertura) });
    }
    return spans;
}

/* WUL-547. Fra il binding e `.message` possono stare un cast, un `!` di non-null
   assertion e un `?.`: tre forme che non cambiano il valore letto ma spezzavano
   il match, ed erano vive in `app/api/settings/route.ts`.

   La normalizzazione e' ancorata al binding, quindi non tocca
   `classification.message` ne' `result.message`, che non sono l'eccezione grezza
   e non devono diventare falsi positivi. */
function normalizza(testo, binding) {
    const b = binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return testo
        .replace(new RegExp(`\\(\\s*${b}\\s+as\\s+[^()]*\\)`, 'g'), binding)
        .replace(new RegExp(`\\b${b}\\s*!`, 'g'), binding)
        .replace(new RegExp(`\\b${b}\\s*\\?\\s*\\.`, 'g'), `${binding}.`);
}

/* Blocchi catch, con il loro binding e il corpo bilanciato. */
function blocchiCatch(testo) {
    const blocchi = [];
    const re = /catch\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{/g;
    let m;
    while ((m = re.exec(testo)) !== null) {
        const apertura = testo.indexOf('{', m.index + m[0].length - 1);
        blocchi.push({
            binding: m[1],
            inizio: apertura,
            fine: fineBlocco(testo, apertura),
            riga: testo.slice(0, m.index).split('\n').length,
        });
    }
    return blocchi;
}

function analizza(file) {
    const relativo = path.relative(repoRoot, file).split(path.sep).join('/');
    const testo = fs.readFileSync(file, 'utf8');
    const reperti = [];

    const handler = handlerSpans(testo);

    for (const blocco of blocchiCatch(testo)) {
        const { binding, inizio, fine } = blocco;
        const corpo = normalizza(testo.slice(inizio, fine), binding);

        /* Variabili che ereditano il messaggio dell'eccezione. Il declarator e'
           facoltativo: `dbHealthError = error.message`, su una variabile dichiarata
           fuori dal catch, e' la forma che sfuggiva. */
        const derivate = new Set();
        const reDerivata = new RegExp(
            `(?:(?:const|let|var)\\s+)?([A-Za-z_$][\\w$]*)\\s*=[^;=]*\\b${binding}\\s*\\.\\s*message`,
            'g',
        );
        let d;
        while ((d = reDerivata.exec(corpo)) !== null) derivate.add(d[1]);

        const contenitore = handler.find((h) => inizio >= h.inizio && fine <= h.fine);
        const coda = contenitore ? normalizza(testo.slice(fine, contenitore.fine), binding) : '';

        const cerca = (regione, ammettiDiretto) => {
            const re = new RegExp(RISPOSTA.source, 'g');
            while (re.exec(regione) !== null) {
                const arg = argomento(regione, re.lastIndex - 1);
                const diretto = ammettiDiretto
                    && new RegExp(`\\b${binding}\\s*\\.\\s*message\\b`).test(arg);
                const indiretta = [...derivate].find((v) => new RegExp(`\\b${v}\\b`).test(arg));
                if (diretto || indiretta) {
                    reperti.push({
                        file: relativo,
                        riga: blocco.riga,
                        via: diretto
                            ? `${binding}.message`
                            : `variabile «${indiretta}» derivata da ${binding}.message`,
                    });
                }
            }
        };

        cerca(corpo, true);
        /* Fuori dal catch il binding non e' piu' in scope: solo le derivate. */
        cerca(coda, false);
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

        /* WUL-547. I tre casi che seguono sono le forme che il guard non vedeva:
           erano vive in `app/api/settings/route.ts` e `app/api/auth/check/route.ts`
           mentre il gate era verde. */
        { nome: 'cast e optional chaining fra binding e .message', codice: "export async function POST(){try{}catch(error){const msg = (error as any)?.message || String(error); return NextResponse.json({error:`Fallito: ${msg}`},{status:500})}}", atteso: true },
        { nome: 'assegnazione senza declarator, risposta fuori dal catch', codice: "export async function GET(){let dbHealthError = null; try{}catch(error){dbHealthError = error instanceof Error ? error.message : 'Unknown error'}; return NextResponse.json({error:{message: dbHealthError || 'Data directory unavailable.'}},{status:500})}", atteso: true },
        { nome: 'non-null assertion', codice: "export async function GET(){try{}catch(error){return NextResponse.json({error:error!.message},{status:500})}}", atteso: true },

        /* Controprova dell'allargamento: `.message` di un oggetto che NON e'
           l'eccezione grezza deve restare pulito. Senza questi due casi, la
           correzione di sopra si comprerebbe con dei falsi positivi. */
        { nome: 'message di un errore di dominio classificato', codice: "export async function GET(){try{}catch(error){const classification = classifyAuthHealthError(error); return NextResponse.json({error:classification.message},{status:400})}}", atteso: false },
        { nome: 'message di un risultato calcolato nel catch', codice: "export async function POST(){try{}catch(error){console.error(error); const result = buildFallback(); return NextResponse.json({error:result.message},{status:500})}}", atteso: false },

        /* Confine della ricerca oltre il catch: una variabile omonima in un ALTRO
           handler dello stesso file non deve essere attribuita a questo catch. */
        { nome: 'variabile omonima in un altro handler', codice: "export async function GET(){try{}catch(error){const msg = error.message; console.error(msg)}}\nexport async function POST(){const msg = 'Richiesta non valida.'; return NextResponse.json({error:msg},{status:400})}", atteso: false },
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
