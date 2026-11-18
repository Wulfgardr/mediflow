import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo] = process.argv.slice(2);
const { parsePreparedExtraction, preparedDossierFacts, preparedPatientKey } = await import(pathToFileURL(path.join(repo, 'lib/domain/documents/dossier-prepared.ts')).href);
const { collectDossierTaxCodes, splitDossierUnits } = await import(pathToFileURL(path.join(repo, 'lib/domain/documents/dossier-import.ts')).href);
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const parsed = parsePreparedExtraction(JSON.stringify(payload.extraction));
if (!parsed.ok) throw Error(parsed.error);
const counts = { verified: 0, approximate: 0, rifiutati: 0 };
const reasons = [];
if (parsed.warnings.length || parsed.value.sources.length !== payload.files.length) throw Error('Fonti o fatti ignorati dal parser');
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
  const result = preparedDossierFacts({ source, text: file.text, units: splitDossierUnits(file.text, null).units, documentDate: null, parserFacts: [], now: new Date() });
  if (result.facts.length !== source.facts.length) throw Error('Fatti persi o sintesi non prevista');
  for (const fact of result.facts) {
    const check = fact.values.preparedCheck;
    if (check === 'verified' || check === 'approximate') counts[check]++;
    else { counts.rifiutati++; reasons.push(check); }
  }
}
process.stdout.write(JSON.stringify({ ...counts, motivi: reasons }) + '\n');
process.exitCode = counts.rifiutati ? 1 : 0;
