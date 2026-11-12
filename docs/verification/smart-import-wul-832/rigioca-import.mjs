// Derivato dal rigioco della misura dell 11/11/2026; legge gli id dal contesto JSON anche per P3-P5.
// Rigioca offline i controlli reali dell'host (codice del ramo) su ogni risposta grezza dell'import catturata.
// Uso: node --experimental-strip-types --import file://<W>/scripts/register-strip-types-loader.mjs rigioca-import.mjs <W> <cattura.jsonl> <uscita.jsonl>
import fs from 'node:fs';
async function main() {
  const [W, input, output] = process.argv.slice(2);
  const { validateGenerativeJson } = await import(W + '/lib/ai-providers/generative-json-validation.ts');
  const { parseSmartImportExtractionResponse, isEnvelopeUsable } = await import(W + '/lib/ai-task-contracts.ts');
  const { smartImportResponseTokenLimit } = await import(W + '/lib/domain/documents/patient-smart-import-capability-contract.ts');
  const { parsePatientSmartImportCapabilityProposal } = await import(W + '/lib/domain/documents/patient-smart-import-capability-contract.ts');
  const out = [];
  for (const [index, line] of fs.readFileSync(input, 'utf8').split('\n').entries()) {
    if (!line.trim()) continue;
    const row = JSON.parse(line); const req = JSON.parse(row.request); const res = JSON.parse(row.response);
    if (req.format?.properties?.task?.const !== 'smart_import') continue;
    const prompt = req.messages[0].content; const content = res.message?.content ?? '';
    const context = JSON.parse(prompt.split('CONTESTO STRUTTURATO:\n')[1]);
    const sourceIds = new Set(context.sources.map(s => s.id));
    const r = { index, patient: row.patient, round: row.round, attempt: row.attempt, seed: row.seed, at: row.at, promptChars: prompt.length, numPredict: req.options?.num_predict, expectedLimit: smartImportResponseTokenLimit(prompt),
      doneReason: res.done_reason, evalCount: res.eval_count, evalSeconds: res.eval_duration / 1e9 };
    try { validateGenerativeJson('smart_import', content); r.schema = 'ok'; }
    catch (e) { r.schema = 'ko'; r.schemaError = (e.issues ?? []).map(i => i.path.join('.') + ':' + i.code).slice(0, 6); if (!e.issues) r.schemaError = String(e.message).slice(0, 200); }
    try {
      const parsed = parseSmartImportExtractionResponse(content);
      r.usable = isEnvelopeUsable(parsed);
      const raw = JSON.parse(content).data ?? {};
      const bad = [];
      for (const k of ['diagnoses', 'therapies', 'servicePrescriptions']) for (const v of raw[k] ?? []) {
        if (v && !sourceIds.has(v.sourceId)) bad.push(k + ':' + v.sourceId);
        for (const n of (k === 'servicePrescriptions' ? v?.items ?? [] : [])) if (n && !sourceIds.has(n.sourceId)) bad.push(k + '.items:' + n.sourceId);
      }
      r.badSourceIds = bad;
      r.rawCounts = { diagnoses: (raw.diagnoses ?? []).length, therapies: (raw.therapies ?? []).length, services: (raw.servicePrescriptions ?? []).length,
        items: (raw.servicePrescriptions ?? []).reduce((n, s) => n + (s?.items?.length ?? 0), 0) };
    } catch (e) { r.parseError = String(e?.message ?? e).slice(0, 200); }
    try { parsePatientSmartImportCapabilityProposal(content, context, '2026-11-11T18:00:01.000Z'); r.host = 'ok'; }
    catch (e) { r.host = 'ko'; r.hostError = e.code ?? e.message; }
    out.push(r);
  }
  fs.writeFileSync(output, out.map(x => JSON.stringify(x)).join('\n') + '\n');
  console.log('rigiocate', out.length);
}
main();
