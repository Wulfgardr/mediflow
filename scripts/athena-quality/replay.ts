import { constants, copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadInputs } from './bench';
import { replayAthenaResearchAnswer } from '../../lib/ai-providers/athena-research/replay';
import { ATHENA_RESEARCH_NOTICE } from '../../lib/ai-providers/athena-research/method';

const args = process.argv.slice(2);
const sources: string[] = [];
let output = '';
while (args.length) {
    const key = args.shift(), value = args.shift();
    if (!value) throw new Error('REPLAY_ARGUMENT_INVALID');
    if (key === '--source') sources.push(resolve(value));
    else if (key === '--output' && !output) output = resolve(value);
    else throw new Error('REPLAY_ARGUMENT_INVALID');
}
if (!output || !sources.length || new Set(sources).size !== sources.length) throw new Error('REPLAY_ARGUMENT_REQUIRED');
mkdirSync(output);
const inputs = loadInputs();
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const manifest: Record<string, string> = {};
type ReplayRow = ReturnType<typeof replayAthenaResearchAnswer> & {
    run: number; case: string; cell: string; positive: boolean; source: string;
    historicalFaultInjection: string | null; guardObservation: string;
};
const rows: ReplayRow[] = [];
let review = `# Revisione per Leonardo\n\n${ATHENA_RESEARCH_NOTICE}\n\nReplay deterministico di risposte storiche. Nessuna nuova inferenza. ADR 0166 Proposed. Testi grezzi e fonti inventate sono conservati integralmente. Nessuna qualifica o equivalenza.\n\n`;
for (const [run, source] of sources.entries()) {
    const files = readdirSync(source).filter(name => /^athena-\d{2}\.stdout$/u.test(name)).sort();
    if (files.length !== 16) throw new Error('REPLAY_EXPECTED_16_RESPONSES');
    const seen = new Set<string>();
    for (const file of files) {
        const prefix = file.replace(/\.stdout$/u, '');
        const receipt = JSON.parse(readFileSync(join(source, `${prefix}.receipt.json`), 'utf8'));
        const item = inputs.corpus.cases.find(item => item.id === receipt.case);
        if (!item?.sources.length || !['athena-local-direct', 'fabric-local-mlx'].includes(receipt.cell)) throw new Error('REPLAY_CASE_INVALID');
        const key = `${item.id}:${receipt.cell}`;
        if (seen.has(key)) throw new Error('REPLAY_DUPLICATE_CELL');
        seen.add(key);
        if (receipt.identity.approval.corpusSha256 !== inputs.corpusSha256
            || receipt.identity.approval.thresholdsSha256 !== inputs.thresholdsSha256) throw new Error('REPLAY_APPROVAL_HASH_MISMATCH');
        const name = `run${run + 1}-${prefix}`;
        for (const extension of ['stdout', 'stderr', 'prompt.txt', 'receipt.json', 'result.json']) {
            const original = join(source, `${prefix}.${extension}`);
            copyFileSync(original, join(output, `${name}.${extension}`), constants.COPYFILE_EXCL);
            manifest[`${name}.${extension}`] = hash(readFileSync(original));
        }
        const raw = readFileSync(join(source, file), 'utf8');
        const prompt = readFileSync(join(source, `${prefix}.prompt.txt`), 'utf8');
        const payload = prompt.split('\n').find(line => line.startsWith('source_payload_json='));
        if (!payload || JSON.stringify(JSON.parse(payload.slice('source_payload_json='.length))) !== JSON.stringify(item.sources)) throw new Error('REPLAY_PROJECTION_MISMATCH');
        const result = replayAthenaResearchAnswer(raw, { allowedEvidenceRefs: item.sources.map(item => item.id), attestation: {
            schema: 'mediflow.ai.treatment-reasoning-athena-attestation.v1', readiness: 'available_unqualified', provider: 'athena_mlx',
            venue: 'local_process', egress: 'none', receiptRef: 'receipt.synthetic.replay', provenanceRef: 'provenance.synthetic.replay',
        } });
        const positive = !['malformed', 'revoke', 'context'].includes(item.scenario);
        const row = { run: run + 1, case: item.id, cell: receipt.cell, positive, source, ...result,
            historicalFaultInjection: item.scenario === 'malformed' ? '{invalid' : null,
            guardObservation: ['revoke', 'context'].includes(item.scenario) ? 'not_exercised_by_replay' : 'not_applicable' };
        rows.push(row);
        writeFileSync(join(output, `${name}.extraction.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
        review += `## Giro ${run + 1}, ${item.id}, ${receipt.cell}\n\nFonti approvate:\n\n\`\`\`json\n${JSON.stringify(item.sources, null, 2)}\n\`\`\`\n\nTesto grezzo (${name}.stdout):\n\n\`\`\`text\n${raw}\n\`\`\`\n\nEstratto:\n\n\`\`\`json\n${JSON.stringify(result.extraction, null, 2)}\n\`\`\`\n\nJSON integro: ${result.validJson}. Revisione umana: da svolgere, 0/1 testi. Claim non sostenuti, fonti inventate, perdite di negazione/incertezza/soggetto/tempo, omissioni e aggiunte: non valutati, conteggi e denominatori non osservati. ${row.historicalFaultInjection ? 'Fault injection storica separata dal grezzo: `{invalid`.' : ''} ${row.guardObservation === 'not_exercised_by_replay' ? 'Il replay non esercita il guard; non attribuire questo diniego a revoca o contesto.' : ''}\n\n`;
    }
}
const diagnostics = sources.flatMap((_, run) => ['athena-local-direct', 'fabric-local-mlx'].map(cell => {
    const group = rows.filter(row => row.run === run + 1 && row.cell === cell);
    const positive = group.filter(row => row.positive);
    return { run: run + 1, cell, responses: group.length, positives: positive.length,
        validJson: { numerator: group.filter(row => row.validJson).length, denominator: group.length },
        positiveValidJson: { numerator: positive.filter(row => row.validJson).length, denominator: positive.length },
        extracted: { numerator: group.filter(row => row.extraction.status === 'extracted').length, denominator: group.length },
        positiveExtracted: { numerator: positive.filter(row => row.extraction.status === 'extracted').length, denominator: positive.length },
        acceptedProposals: { numerator: null, denominator: null, reason: 'replay_does_not_publish' },
        humanReviewed: { numerator: 0, denominator: group.length } };
}));
const report = { mode: 'deterministic_replay', notice: ATHENA_RESEARCH_NOTICE,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    corpusSha256: inputs.corpusSha256, thresholdsSha256: inputs.thresholdsSha256,
    newAthenaInvocations: 0, runConsumed: false, stoppedBeforeRun: rows.some(row => row.extraction.status === 'denied'),
    thresholdResults: null, reason: rows.some(row => row.extraction.status === 'denied')
        ? 'Historical responses are not extractable without reconstruction; stop before live run.'
        : 'Replay only; no inference or publication authorized by this command.',
    diagnostics, rows, manifest, qualification: false };
writeFileSync(join(output, 'replay.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
writeFileSync(join(output, 'revisione-leonardo.md'), review, { flag: 'wx' });
console.log(JSON.stringify({ responses: rows.length, extracted: rows.filter(row => row.extraction.status === 'extracted').length,
    runConsumed: false, newAthenaInvocations: 0, diagnostics }, null, 2));
