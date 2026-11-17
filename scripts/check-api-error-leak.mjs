#!/usr/bin/env node


import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const apiRoot = path.join(repoRoot, 'app', 'api');

const ALLOWLIST = [
    {
        file: 'app/api/drugs/update/route.ts',
        motivo:
            "Il ramo `error instanceof AifaUpdateError` restituisce soltanto messaggi autoriali "
            + 'su richiesta, sessione, acquisizione e validazione del catalogo AIFA. I costruttori '
            + 'non incorporano input, risposte remote o eccezioni di sistema; il ramo generico '
            + 'restituisce un messaggio fisso e conserva il catalogo.',
    },
    {
        file: 'app/api/drugs/route.ts',
        motivo:
            "Il messaggio proviene da replaceAifaCatalog ed e' una diagnosi di dominio sull'import "
            + "(file malformato, colonne mancanti), non il testo di un'eccezione di sistema. Rimuoverlo "
            + 'lascerebbe l\'operatore senza indicazione su un import da centinaia di righe. Status 400, '
            + 'non 500: e\' un rifiuto, non un guasto. Lo stesso vale per i rifiuti dello svuotamento '
            + 'amministrativo (AifaUpdateError con testo autoriale su conferma e versione attesa); '
            + 'il guasto imprevisto restituisce un messaggio fisso.',
    },
    {
        file: 'app/api/drugs/catalog-import/route.ts',
        motivo:
            "I rami segnalati sono `AifaReductionError`, `DrugCatalogImportError` e `AifaUpdateError`: "
            + 'messaggi autoriali su file, mappatura, fonte dichiarata e conferma del catalogo farmaci, '
            + 'senza input del file o eccezioni di sistema. Il guasto imprevisto restituisce un messaggio fisso '
            + 'e conserva il catalogo.',
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

function handlerSpans(testo) {
    const spans = [];
    const re = /\bexport\s+(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/g;
    while (re.exec(testo) !== null) {
        const apertura = testo.indexOf('{', chiusuraParen(testo, re.lastIndex - 1));
        if (apertura === -1) continue;
        spans.push({ inizio: apertura, fine: fineBlocco(testo, apertura) });
    }
    return spans;
}

function normalizza(testo, binding) {
    const b = binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return testo
        .replace(new RegExp(`\\(\\s*${b}\\s+as\\s+[^()]*\\)`, 'g'), binding)
        .replace(new RegExp(`\\b${b}\\s*!`, 'g'), binding)
        .replace(new RegExp(`\\b${b}\\s*\\?\\s*\\.`, 'g'), `${binding}.`);
}

function usaBindingLocaleCatch(corpo, nome, posizione) {
    const prefisso = 'try {} catch (__errore) ';
    const sorgente = ts.createSourceFile(
        'catch-scope.ts',
        `${prefisso}${corpo}`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const clausola = sorgente.statements.find(ts.isTryStatement)?.catchClause;
    if (!clausola) return false;

    const punto = prefisso.length + posizione;
    let nodoPiuProfondo = clausola.block;
    const trovaNodo = (nodo) => {
        if (nodo.pos <= punto && punto < nodo.end) {
            nodoPiuProfondo = nodo;
            ts.forEachChild(nodo, trovaNodo);
        }
    };
    trovaNodo(clausola.block);

    const scopeAttivi = new Set();
    for (let nodo = nodoPiuProfondo; nodo; nodo = nodo.parent) {
        if (
            ts.isBlock(nodo)
            || ts.isForStatement(nodo)
            || ts.isForInStatement(nodo)
            || ts.isForOfStatement(nodo)
        ) scopeAttivi.add(nodo);
        if (nodo === clausola.block) break;
    }

    let locale = false;
    const visita = (nodo) => {
        if (locale) return;
        if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name) && nodo.name.text === nome) {
            const lista = nodo.parent;
            const lessicale = ts.isVariableDeclarationList(lista)
                && (lista.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0;
            if (lessicale) {
                let scope = lista.parent;
                while (
                    scope
                    && !ts.isBlock(scope)
                    && !ts.isForStatement(scope)
                    && !ts.isForInStatement(scope)
                    && !ts.isForOfStatement(scope)
                ) scope = scope.parent;
                if (scope && scopeAttivi.has(scope)) locale = true;
            }
        }
        ts.forEachChild(nodo, visita);
    };
    visita(clausola.block);
    return locale;
}

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

        const derivate = new Set();
        const derivateVisibiliInCoda = new Set();
        const reDerivata = new RegExp(
            `(?:(const|let|var)\\s+)?([A-Za-z_$][\\w$]*)\\s*=[^;=]*(?:\\b${binding}\\s*\\.\\s*message\\b|\\bString\\s*\\(\\s*${binding}\\s*\\))`,
            'g',
        );
        let d;
        while ((d = reDerivata.exec(corpo)) !== null) {
            const nome = d[2];
            derivate.add(nome);
            const dichiarataQui = d[1] === 'const' || d[1] === 'let';
            const localeCatch = !d[1] && usaBindingLocaleCatch(corpo, nome, d.index);
            if (!dichiarataQui && !localeCatch) derivateVisibiliInCoda.add(nome);
        }

        const contenitore = handler.find((h) => inizio >= h.inizio && fine <= h.fine);
        const coda = contenitore ? normalizza(testo.slice(fine, contenitore.fine), binding) : '';

        const cerca = (regione, ammettiDiretto, nomiDerivati) => {
            const re = new RegExp(RISPOSTA.source, 'g');
            while (re.exec(regione) !== null) {
                const arg = argomento(regione, re.lastIndex - 1);
                const diretto = ammettiDiretto
                    && new RegExp(
                        `(?:\\b${binding}\\s*\\.\\s*message\\b|\\bString\\s*\\(\\s*${binding}\\s*\\))`,
                    ).test(arg);
                const indiretta = [...nomiDerivati].find((v) => new RegExp(`\\b${v}\\b`).test(arg));
                if (diretto || indiretta) {
                    reperti.push({
                        file: relativo,
                        riga: blocco.riga,
                        via: diretto
                            ? `eccezione «${binding}» esposta direttamente`
                            : `variabile «${indiretta}» derivata dall'eccezione «${binding}»`,
                    });
                }
            }
        };

        cerca(corpo, true, derivate);
        cerca(coda, false, derivateVisibiliInCoda);
    }
    return reperti;
}

const selfTest = process.argv.includes('--self-test');

if (selfTest) {
    const casi = [
        { nome: 'diretto', codice: "export async function GET(){try{}catch(e){return NextResponse.json({error:e.message},{status:500})}}", atteso: true },
        { nome: 'indiretto via const', codice: "export async function GET(){try{}catch(error){const message = error instanceof Error ? error.message : 'x'; return NextResponse.json({error:message},{status:500})}}", atteso: true },
        { nome: 'template literal', codice: "export async function GET(){try{}catch(error){return NextResponse.json({error:`Fallito: ${error.message}`},{status:500})}}", atteso: true },
        { nome: 'String diretto', codice: "export async function GET(){try{}catch(error){return NextResponse.json({error:String(error)},{status:500})}}", atteso: true },
        { nome: 'String indiretto', codice: "export async function GET(){try{}catch(error){const detail = String(error); return NextResponse.json({error:detail},{status:500})}}", atteso: true },
        { nome: 'solo log server', codice: "export async function GET(){try{}catch(error){console.error('x', error.message); return NextResponse.json({error:'Errore interno.'},{status:500})}}", atteso: false },
        { nome: 'messaggio letterale', codice: "export async function GET(){try{}catch(error){return NextResponse.json({error:'Errore interno.',code:'internal_error'},{status:500})}}", atteso: false },
        { nome: 'helper', codice: "export async function GET(){try{}catch(error){return apiInternalError('GET /x', error)}}", atteso: false },

        { nome: 'cast e optional chaining fra binding e .message', codice: "export async function POST(){try{}catch(error){const msg = (error as any)?.message || String(error); return NextResponse.json({error:`Fallito: ${msg}`},{status:500})}}", atteso: true },
        { nome: 'assegnazione senza declarator, risposta fuori dal catch', codice: "export async function GET(){let dbHealthError = null; try{}catch(error){dbHealthError = error instanceof Error ? error.message : 'Unknown error'}; return NextResponse.json({error:{message: dbHealthError || 'Data directory unavailable.'}},{status:500})}", atteso: true },
        { nome: 'non-null assertion', codice: "export async function GET(){try{}catch(error){return NextResponse.json({error:error!.message},{status:500})}}", atteso: true },

        { nome: 'message di un errore di dominio classificato', codice: "export async function GET(){try{}catch(error){const classification = classifyAuthHealthError(error); return NextResponse.json({error:classification.message},{status:400})}}", atteso: false },
        { nome: 'message di un risultato calcolato nel catch', codice: "export async function POST(){try{}catch(error){console.error(error); const result = buildFallback(); return NextResponse.json({error:result.message},{status:500})}}", atteso: false },

        { nome: 'variabile omonima in un altro handler', codice: "export async function GET(){try{}catch(error){const msg = error.message; console.error(msg)}}\nexport async function POST(){const msg = 'Richiesta non valida.'; return NextResponse.json({error:msg},{status:400})}", atteso: false },
        { nome: 'variabile locale al catch ombreggiata nella coda', codice: "export async function GET(){try{}catch(error){const message = error.message; console.error(message)} const message = 'Errore interno.'; return NextResponse.json({error:message},{status:500})}", atteso: false },
        { nome: 'assegnazione a locale dichiarata prima nel catch', codice: "export async function GET(){try{}catch(error){let message; message = error.message; console.error(message)} const message = 'Errore interno.'; return NextResponse.json({error:message},{status:500})}", atteso: false },
        { nome: 'binding annidato non nasconde assegnazione esterna', codice: "export async function GET(){let message; try{}catch(error){message = error.message; if (debug) { const message = 'solo log'; console.error(message) }} return NextResponse.json({error:message},{status:500})}", atteso: true },
        { nome: 'commenti e stringhe non dichiarano binding', codice: "export async function GET(){let message; try{}catch(error){message = error.message; console.error('const message = sicuro'); /* let message */} return NextResponse.json({error:message},{status:500})}", atteso: true },
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
        console.error('\nLeak di eccezioni grezze verso il client:');
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
