#!/usr/bin/env node
/*
 * Misura degli scarti del Quadro paziente (Patient Insight) sul percorso reale del prodotto.
 *
 * Esegue N richieste sullo stesso contesto inventato della seduta del 10/11/2026
 * (lib/ai-providers/fabric/fixtures/patient-insight-rejected-answers.json) passando da
 * createPatientInsightHostCapability: adapter Ollama vero, attestazione di localita',
 * router Fabric, validatore, secondo tentativo se il codice misurato lo prevede.
 * Restano sintetici solo kill switch, lifecycle e attualita' (sempre attivi), cosi'
 * non si legge nessun archivio.
 *
 * Il codice misurato e' quello di --repo, e lo script va lanciato con il loader dello
 * stesso repository (gli alias @/ si risolvono li'):
 *
 *   node <repo>/scripts/run-strip-types.mjs <questo-script> --repo <repo> \
 *       --ollama http://127.0.0.1:<porta> --modello qwen3.5:35b-a3b --n 80 --out <file.jsonl>
 *
 * Prova a secco senza modello: --finto (un Ollama finto in-process su --porta-finta,
 * risposte a copione: valida; troppo lunga poi valida; troncata poi valida; due non valide).
 *
 * Uscita: una riga JSONL per richiesta (esito, codice, tentativi, causa per tentativo,
 * done_reason, durata) e <out>.riepilogo.json con i conteggi e la soglia (<= 2 su 80).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RISERVATE = new Set([3000, 11434, 11435, 31917, 31918, 33107]);
const LIMITE = 220;

function argomenti(argv) {
    const out = { n: 80, modello: 'qwen3.5:35b-a3b', portaFinta: 0, finto: false };
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i]; const next = () => { const value = argv[++i]; if (value === undefined) throw new Error(`manca il valore di ${key}`); return value; };
        if (key === '--repo') out.repo = path.resolve(next());
        else if (key === '--ollama') out.ollama = next();
        else if (key === '--modello') out.modello = next();
        else if (key === '--n') out.n = Number(next());
        else if (key === '--out') out.out = path.resolve(next());
        else if (key === '--finto') out.finto = true;
        else if (key === '--porta-finta') out.portaFinta = Number(next());
        else throw new Error(`argomento sconosciuto: ${key}`);
    }
    if (!out.repo || !out.out || !Number.isSafeInteger(out.n) || out.n < 1) throw new Error('servono --repo, --out e --n positivo');
    if (!out.finto && !out.ollama) throw new Error('serve --ollama http://127.0.0.1:<porta> (oppure --finto)');
    return out;
}

function portaAmmessa(porta, cosa) {
    if (RISERVATE.has(porta)) throw new Error(`${cosa}: la porta ${porta} e' riservata, scegline un'altra`);
}

const qui = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(qui, '../lib/ai-providers/fabric/fixtures/patient-insight-rejected-answers.json'), 'utf8'));

function proiezione(context) {
    const righe = context.trim().split('\n').map((riga) => riga.replace(/^\[S\d+\] /u, ''));
    const dopo = (prefisso) => righe.filter((riga) => riga.startsWith(prefisso)).map((riga) => riga.slice(prefisso.length));
    return Object.freeze({ schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: righe[0],
        activeConditions: Object.freeze(dopo('Condizione attiva: ')), currentTherapies: Object.freeze(dopo('Terapia corrente: ')),
        recentClinicalEvents: Object.freeze(dopo('Evento clinico recente: ')) });
}

// --- Ollama finto per la prova a secco -------------------------------------------------
const valida = JSON.stringify({ schemaVersion: 'mediflow.ai.extract.v1', task: 'patient_insight', summary: 'Condizione cronica sintetica in follow-up [S2]',
    data: { currentState: ['Follow-up clinico attuale della condizione sintetica [S1, S2]'], alerts: [], nextSteps: ['Rivalutare al prossimo controllo [S3]'], gaps: [] } });
const troppoLunga = fixture.rejected.find((item) => item.cause === 'overlong').content;
const troncata = fixture.rejected.find((item) => item.cause === 'truncated').content;
const COPIONE = [
    [{ content: valida }],
    [{ content: troppoLunga }, { content: valida }],
    [{ content: troncata, done_reason: 'length' }, { content: valida }],
    [{ content: troppoLunga }, { content: troncata, done_reason: 'length' }],
];
let copioneCorrente = COPIONE[0]; let chiamateCopione = 0;

function avviaFinto(porta, modello) {
    const descrittore = { name: modello, model: modello, size: 1234, digest: 'f'.repeat(64), details: { family: 'finto' } };
    const server = http.createServer((req, res) => {
        let corpo = ''; req.on('data', (chunk) => { corpo += chunk; });
        req.on('end', () => {
            const json = (value) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
            if (req.url === '/api/version') return json({ version: '0.40.6' });
            if (req.url === '/api/tags' || req.url === '/api/ps') return json({ models: [descrittore] });
            if (req.url === '/api/show') return json({ details: descrittore.details });
            if (req.url === '/api/generate') return json({ model: modello });
            if (req.url === '/api/chat') {
                const risposta = copioneCorrente[Math.min(chiamateCopione++, copioneCorrente.length - 1)];
                return json({ model: modello, message: { role: 'assistant', content: risposta.content }, done: true,
                    done_reason: risposta.done_reason ?? 'stop', prompt_eval_count: 10, eval_count: risposta.done_reason === 'length' ? 900 : 120 });
            }
            res.writeHead(404); res.end();
        });
    });
    return new Promise((resolve) => server.listen(porta, '127.0.0.1', () => resolve(server)));
}

// --- Classificazione della singola risposta grezza (solo diagnostica) --------------------
function classifica(moduli, contenuto, doneReason, fonti) {
    if (doneReason === 'length') return 'troncata';
    let json; try { json = JSON.parse(contenuto); } catch { return 'json_non_valido'; }
    const testi = [json?.summary, ...Object.values(json?.data ?? {}).flat()].filter((item) => typeof item === 'string');
    if (testi.some((item) => item.length > LIMITE)) return 'troppo_lunga';
    try { moduli.validateGenerativeJson('patient_insight', contenuto); } catch { return 'schema_altro'; }
    const parsed = moduli.parsePatientInsightExtractionResponse(contenuto);
    if (!moduli.isEnvelopeUsable(parsed)) return 'envelope';
    const gruppo = /\[(?:S\d+|DATI-INCOMPLETI)(?:,\s*(?:S\d+|DATI-INCOMPLETI))*\]/gu;
    const citata = (testo) => { const gruppi = testo.match(gruppo) ?? []; return gruppi.length > 0 && gruppi.flatMap((g) => g.slice(1, -1).split(',').map((t) => t.trim()))
        .every((t) => t === 'DATI-INCOMPLETI' || (/^S\d+$/u.test(t) && Number(t.slice(1)) >= 1 && Number(t.slice(1)) <= fonti)); };
    const v = parsed.value; const claims = [v.summary, ...v.data.currentState, ...v.data.alerts, ...v.data.nextSteps, ...v.data.gaps].filter((c) => c.length > 0);
    if (claims.length === 0) return 'vuota';
    if (!claims.every(citata)) return 'fonti';
    return 'valida';
}

function percentile(valori, p) {
    if (valori.length === 0) return null;
    const ordinati = [...valori].sort((a, b) => a - b);
    return Math.round(ordinati[Math.min(ordinati.length - 1, Math.ceil((p / 100) * ordinati.length) - 1)]);
}

async function main() {
    const opzioni = argomenti(process.argv.slice(2));
    const importa = (relativo) => import(pathToFileURL(path.join(opzioni.repo, relativo)).href);

    // Il loader in uso deve essere quello di --repo, altrimenti gli alias @/ mescolano due codici.
    const aliasDiProva = fileURLToPath(import.meta.resolve('@/lib/ai-providers/provider'));
    if (!aliasDiProva.startsWith(opzioni.repo + path.sep)) {
        throw new Error(`il loader risolve @/ in ${path.dirname(path.dirname(path.dirname(aliasDiProva)))}: lancia lo script con ${opzioni.repo}/scripts/run-strip-types.mjs`);
    }

    let server = null; let base = opzioni.ollama;
    if (opzioni.finto) {
        if (opzioni.portaFinta) portaAmmessa(opzioni.portaFinta, 'porta finta');
        server = await avviaFinto(opzioni.portaFinta, opzioni.modello);
        base = `http://127.0.0.1:${server.address().port}`;
    } else {
        const url = new URL(base);
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('solo Ollama su loopback');
        portaAmmessa(Number(url.port || 80), 'Ollama');
    }

    const [{ createPatientInsightHostCapability }, { routeHostResolvedCandidateCapability }, { localProviderRegistry }, { observeClinical },
        { validateGenerativeJson }, contracts] = await Promise.all([
        importa('lib/ai-providers/fabric/patient-insight-host-capability.ts'), importa('lib/ai-providers/fabric/candidate-router.ts'),
        importa('lib/ai-providers/registry.ts'), importa('lib/ai-providers/host-local-provider-readiness.ts'),
        importa('lib/ai-providers/generative-json-validation.ts'), importa('lib/ai-task-contracts.ts')]);
    const moduli = { validateGenerativeJson, parsePatientInsightExtractionResponse: contracts.parsePatientInsightExtractionResponse, isEnvelopeUsable: contracts.isEnvelopeUsable };

    // Registra ogni /api/chat della richiesta in corso, senza cambiare cio' che il prodotto riceve.
    let tentativi = [];
    const fetchOriginale = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const risposta = await fetchOriginale(input, init);
        if (new URL(String(input instanceof Request ? input.url : input)).pathname === '/api/chat') {
            const prompt = (() => { try { return JSON.parse(String(init?.body)).messages.at(-1).content; } catch { return ''; } })();
            try {
                const dati = await risposta.clone().json();
                tentativi.push({ status: risposta.status, done_reason: dati.done_reason ?? null, eval_count: dati.eval_count ?? null,
                    contenuto: dati.message?.content ?? '', promptDiceLimite: prompt.includes(`al massimo ${LIMITE} caratteri`) });
            } catch { tentativi.push({ status: risposta.status, done_reason: null, eval_count: null, contenuto: '', promptDiceLimite: false }); }
        }
        return risposta;
    };

    const at = () => new Date().toISOString();
    const lifecycle = Object.freeze({ schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1',
        lifecycle: Object.freeze({ schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' }),
        actorClass: 'host_service', actorRef: `actor_${'a'.repeat(32)}`, version: 1, hostTimestamp: at(), receiptRef: `receipt_${'b'.repeat(32)}` });
    const capability = createPatientInsightHostCapability({
        killSwitch: { read: async () => Object.freeze({ status: 'enabled' }) },
        currentness: { verify: () => true },
        lifecycle: { read: () => Object.freeze({ status: 'available', record: lifecycle }) },
        binding: { readClinical: async () => Object.freeze({ status: 'available', resolution: localProviderRegistry.resolve({
            task: 'clinical', provider: 'ollama', models: { clinical: opzioni.modello }, endpoint: base, disableThinking: true, chatTimeoutMs: 300_000 }) }) },
        readiness: { observeClinical },
        route: routeHostResolvedCandidateCapability,
    });
    const projection = proiezione(fixture.context);
    const fonti = 1 + projection.activeConditions.length + projection.currentTherapies.length + projection.recentClinicalEvents.length;

    let codice = null; try { codice = execFileSync('git', ['-C', opzioni.repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* fuori da git */ }
    fs.mkdirSync(path.dirname(opzioni.out), { recursive: true });
    const scrittore = fs.createWriteStream(opzioni.out, { flags: 'w' });
    const righe = [];
    for (let i = 0; i < opzioni.n; i += 1) {
        tentativi = []; copioneCorrente = COPIONE[i % COPIONE.length]; chiamateCopione = 0;
        const stamp = at();
        const inizio = performance.now();
        let esito; try {
            esito = await capability.preview(Object.freeze({ requestId: `request.misura.quadro.${String(i + 1).padStart(4, '0')}`, projection,
                currentness: Object.freeze({ selectionEpoch: 1, patientRevision: 1, projectionDigest: `sha256_${'d'.repeat(64)}`, capturedAt: stamp, verifiedAt: stamp }) }));
        } catch (error) { esito = { status: 'eccezione', code: String(error?.message ?? error).slice(0, 200) }; }
        const riga = { i: i + 1, esito: esito.status, codice: esito.code ?? null, tentativi: tentativi.length,
            cause: tentativi.map((t) => (t.status !== 200 ? `http_${t.status}` : classifica(moduli, t.contenuto, t.done_reason, fonti))),
            done_reason: tentativi.map((t) => t.done_reason), eval_count: tentativi.map((t) => t.eval_count),
            promptDiceLimite: tentativi.length > 0 ? tentativi.every((t) => t.promptDiceLimite) : null,
            ms: Math.round(performance.now() - inizio) };
        righe.push(riga); scrittore.write(`${JSON.stringify(riga)}\n`);
        process.stderr.write(`${riga.i}/${opzioni.n} ${riga.esito}${riga.codice ? `:${riga.codice}` : ''} tentativi=${riga.tentativi} cause=${riga.cause.join(',')} ${riga.ms}ms\n`);
    }
    await new Promise((resolve) => scrittore.end(resolve));
    globalThis.fetch = fetchOriginale;
    if (server) await new Promise((resolve) => server.close(resolve));

    const conta = (valori) => valori.reduce((acc, v) => { acc[v] = (acc[v] ?? 0) + 1; return acc; }, {});
    const scartate = righe.filter((r) => r.codice === 'proposal_invalid').length;
    const riepilogo = { codice, repo: opzioni.repo, modello: opzioni.modello, ollama: opzioni.finto ? 'finto' : base, richieste: righe.length,
        disponibili: righe.filter((r) => r.esito === 'available').length, proposal_invalid: scartate,
        esiti: conta(righe.map((r) => (r.codice ? `${r.esito}:${r.codice}` : r.esito))),
        tentativi: conta(righe.map((r) => r.tentativi)), causePrimoTentativo: conta(righe.map((r) => r.cause[0] ?? 'nessuno')),
        causeSecondoTentativo: conta(righe.filter((r) => r.tentativi > 1).map((r) => r.cause[1])),
        promptDiceLimite: righe.every((r) => r.promptDiceLimite !== false),
        ms: { mediana: percentile(righe.map((r) => r.ms), 50), p90: percentile(righe.map((r) => r.ms), 90), max: Math.max(...righe.map((r) => r.ms)) },
        soglia: { regola: 'al massimo 2 proposal_invalid su 80 (2,5%)', rispettata: righe.length === 80 ? scartate <= 2 : null } };
    fs.writeFileSync(`${opzioni.out.replace(/\.jsonl$/u, '')}.riepilogo.json`, `${JSON.stringify(riepilogo, null, 2)}\n`);
    console.log(JSON.stringify(riepilogo, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
