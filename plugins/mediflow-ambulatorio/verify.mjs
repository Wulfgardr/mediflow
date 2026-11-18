import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo] = process.argv.slice(2);
const { parsePreparedExtraction, preparedDossierFacts, preparedPatientKey } = await import(pathToFileURL(path.join(repo, 'lib/domain/documents/dossier-prepared.ts')).href);
const { clinicalFactContext, contextReview, isHistoricalTherapy } = await import(pathToFileURL(path.join(repo, 'lib/domain/documents/clinical-context-lexicon.ts')).href);
const { collectDossierTaxCodes, splitDossierUnits } = await import(pathToFileURL(path.join(repo, 'lib/domain/documents/dossier-import.ts')).href);
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const parsed = parsePreparedExtraction(JSON.stringify(payload.extraction));
if (!parsed.ok) throw Error(parsed.error);
const counts = { verified: 0, approximate: 0, rifiutati: 0 };
const reasons = [];
if (parsed.warnings.length || parsed.value.sources.length !== payload.files.length) throw Error('Fonti o fatti ignorati dal parser');
function uniqueQuote(text, quote) {
  if (!quote) return null;
  const escaped = quote.trim().split(/\s+/u).map(word => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+');
  const matches = new RegExp('(?<![\\p{L}\\p{N}])' + escaped + '(?![\\p{L}\\p{N}])', 'giu');
  const found = matches.exec(text);
  return found && !matches.test(text) ? found : null;
}

for (const source of parsed.value.sources) {
  const file = payload.files.find(f => f.sha256 === source.sha256);
  if (!file) throw Error('sha256 non abbinato');
  if (preparedPatientKey(source.patient, file.text) !== `cf:${payload.cf}`) throw Error('CF non presente nella fonte');
  const codes = collectDossierTaxCodes(file.text);
  if (codes.some(code => code.value !== payload.cf && !payload.physicianCodes.includes(code.value) && !code.explicitProfessional)) {
    throw Error('CF estraneo o ambiguo nel PDF');
  }
  if (source.fileName === 'nota-visita.pdf' && !codes.some(code => code.value === payload.cf && code.role === 'patient_cf')) {
    throw Error('CF nota non riconosciuto come paziente');
  }
  const fromTranscript = source.fileName === 'trascrizione-visita.pdf';
  const text = fromTranscript ? payload.transcript : file.text;
  const result = preparedDossierFacts({ source, text, units: splitDossierUnits(text, null).units, documentDate: null, parserFacts: [], now: new Date() });
  if (result.facts.length !== source.facts.length) throw Error('Fatti persi o sintesi non prevista');
  for (const [index, fact] of result.facts.entries()) {
    let reason = fact.negated ? 'negation' : fact.values.contextReview;
    if (fromTranscript && !reason) {
      const input = source.facts[index];
      const match = uniqueQuote(text, input.quote);
      if (!match || !uniqueQuote(file.text, input.quote)) reason = 'citazione_non_univoca_o_non_leggibile';
      else {
        const context = clinicalFactContext(input.kind, input.values, text, match.index, match.index + match[0].length);
        reason = contextReview(context, input.kind === 'therapy' && isHistoricalTherapy(input.values.status));
      }
    }
    const check = fact.values.preparedCheck;
    if (reason || (check !== 'verified' && check !== 'approximate')) {
      counts.rifiutati++;
      reasons.push(reason || check);
    } else counts[check]++;
  }
}
process.stdout.write(JSON.stringify({ ...counts, motivi: reasons }) + '\n');
process.exitCode = counts.rifiutati ? 1 : 0;
