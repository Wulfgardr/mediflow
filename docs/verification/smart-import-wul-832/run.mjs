import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const [arm, evidenceDir, limit = '20'] = process.argv.slice(2);
if (!arm || !evidenceDir) throw new Error('Uso: run.mjs braccio directory [giri]');
const root = process.cwd();
const corpusPath = new URL('./corpus.json', import.meta.url);
const corpusBytes = fs.readFileSync(corpusPath);
const corpus = JSON.parse(corpusBytes);
fs.mkdirSync(evidenceDir, { recursive: true });
const load = (name) => import(pathToFileURL(path.join(root, name)).href);
const { createPatientSmartImportHostCapability } = await load('lib/domain/documents/patient-smart-import-host-capability.ts');
const { localProviderRegistry } = await load('lib/ai-providers/registry.ts');
const { routeHostResolvedCandidateCapability } = await load('lib/ai-providers/fabric/candidate-router.ts');
const endpoint = 'http://127.0.0.1:64812';
const model = 'qwen3.5:35b-a3b';
const nativeFetch = globalThis.fetch;
const version = await (await nativeFetch(`${endpoint}/api/version`)).json();
const tags = await (await nativeFetch(`${endpoint}/api/tags`)).json();
const modelTag = tags.models.find((m) => m.name === model);
if (!modelTag) throw new Error('Modello assente sul banco');
const append = (file, row) => fs.appendFileSync(path.join(evidenceDir, file), JSON.stringify(row) + '\n');
let trial;
globalThis.fetch = async (input, init) => {
  if (String(input) !== `${endpoint}/api/chat`) return nativeFetch(input, init);
  if (!trial) throw new Error('Richiesta fuori da una prova');
  const request = JSON.parse(init.body);
  const attempt = trial.attempt++;
  request.options.seed = trial.seed + attempt;
  const at = new Date().toISOString();
  const response = await nativeFetch(input, { ...init, body: JSON.stringify(request) });
  const body = await response.clone().text();
  append('cattura.jsonl', { arm, patient: trial.patient, round: trial.round, attempt, seed: request.options.seed, at, request: JSON.stringify(request), response: body, httpStatus: response.status });
  return response;
};
const lifecycle = {
  schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1',
  lifecycle: { schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' },
  actorClass: 'host_service', actorRef: `actor_${'a'.repeat(32)}`, version: 1,
  hostTimestamp: '2026-11-11T18:00:00.000Z', receiptRef: `receipt_${'b'.repeat(32)}`,
};
const metadata = { arm, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(), node: process.version, version, model: modelTag, corpusSha256: createHash('sha256').update(corpusBytes).digest('hex'), rounds: Number(limit), endpoint, sourceRuntime: 'host capability + real Ollama adapter; synthetic dependency fixtures' };
fs.writeFileSync(path.join(evidenceDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
for (let round = 0; round < Number(limit); round++) {
  for (const [patientIndex, item] of corpus.cases.entries()) {
    trial = { patient: item.id, round, seed: corpus.seedBase + patientIndex * 1000 + round * 10, attempt: 0 };
    const binding = localProviderRegistry.resolve({ task: 'clinical', models: { clinical: model }, endpoint, disableThinking: true, chatTimeoutMs: 180000 });
    const capability = createPatientSmartImportHostCapability({
      killSwitch: { read: async () => ({ status: 'enabled' }) },
      broker: { consume: () => item.projection },
      lifecycle: { read: () => ({ status: 'available', record: lifecycle }) },
      binding: { readClinical: async () => ({ status: 'available', resolution: binding }) },
      readiness: { observeClinical: async () => ({ status: 'available', code: null, observation: { venue: 'local_process', state: 'available', reason: null } }) },
      route: routeHostResolvedCandidateCapability,
      sources: { clock: () => '2026-11-11T18:00:01.000Z', entropy: () => new Uint8Array(16).fill(7) },
    });
    const started = Date.now();
    const result = await capability.preview({ handle: `prj_${'1'.repeat(32)}`, requestId: `request.wul832.${item.id}.${String(round).padStart(3, '0')}` });
    append('results.jsonl', { arm, ...trial, milliseconds: Date.now() - started, result });
    console.log(JSON.stringify({ arm, patient: item.id, round, status: result.status, code: result.code, attempts: trial.attempt, milliseconds: Date.now() - started }));
    if (result.status === 'denied' || result.code === 'provider_failed') throw new Error(`Banco interrotto: ${result.code}`);
  }
}
fs.writeFileSync(path.join(evidenceDir, 'complete.json'), JSON.stringify({ completedAt: new Date().toISOString(), requests: Number(limit) * corpus.cases.length }) + '\n');
