/* @Codex — SYNTHETIC TEST FIXTURES ONLY. Never imported by the production CLI.
 * Tiny wheels exercise real Python/venv/pip, NOT GLiNER or Mac qualification. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { sha256 } from './guards.mjs';
import { createProcessAdapter } from './process.mjs';

export const TEST_PYTHON = process.env.MEDIFLOW_REDACTION_TEST_PYTHON;
export const TEST_PIP_WHEEL = process.env.MEDIFLOW_REDACTION_TEST_PIP_WHEEL;
const ZIP_CODE = String.raw`
import base64,csv,hashlib,io,json,stat,sys,zipfile
p=json.load(sys.stdin); files=p['files']; records=[]
for name,text in files.items():
 b=text.encode(); records.append([name,'sha256='+base64.urlsafe_b64encode(hashlib.sha256(b).digest()).decode().rstrip('='),str(len(b))])
record=p['prefix']+'/RECORD'; records.append([record,'','']); s=io.StringIO(); csv.writer(s,lineterminator='\n').writerows(records); files[record]=s.getvalue()
with zipfile.ZipFile(p['out'],'w',compression=zipfile.ZIP_DEFLATED) as z:
 for name,text in files.items():
  i=zipfile.ZipInfo(name,(2020,1,1,0,0,0)); i.create_system=3; i.external_attr=(stat.S_IFREG|0o644)<<16; z.writestr(i,text)
 for e in p.get('extra',[]):
  i=zipfile.ZipInfo(e['path'],(2020,1,1,0,0,0)); i.create_system=3; i.external_attr=(stat.S_IFLNK|0o777 if e.get('symlink') else stat.S_IFREG|0o644)<<16; z.writestr(i,e.get('text','synthetic'))
`;
function runPython(args, input) {
  const result = spawnSync(TEST_PYTHON, ['-I', '-B', ...args], { input, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeout: 30_000 });
  if (result.status !== 0) throw new Error('synthetic_fixture_python_failed'); return result.stdout;
}
export const digest = file => { const b = fs.readFileSync(file); return { sha256: sha256(b), bytes: b.length }; };
export function fixture(t, settings = {}) {
  if (!TEST_PYTHON || !path.isAbsolute(TEST_PYTHON) || !TEST_PIP_WHEEL || !path.isAbsolute(TEST_PIP_WHEEL)) throw new Error('Set MEDIFLOW_REDACTION_TEST_PYTHON and MEDIFLOW_REDACTION_TEST_PIP_WHEEL to explicit local test inputs.');
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mediflow-synthetic-install-'));
  fs.chmodSync(parent, 0o700); t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  // Real macOS application paths contain spaces. Also exercise quote-safe argv.
  const root = path.join(parent, "Application Support 'synthetic'", 'redaction');
  fs.mkdirSync(path.dirname(root), { mode: 0o700 });
  const inputs = path.join(parent, 'inputs'); fs.mkdirSync(inputs, { mode: 0o700 });
  const model = path.join(inputs, 'model'); fs.mkdirSync(model, { mode: 0o700 });
  const wheelhouse = path.join(inputs, 'wheelhouse'); fs.mkdirSync(wheelhouse, { mode: 0o700 });
  const write = (file, text, mode = 0o600) => { fs.writeFileSync(file, text, { mode }); return file; };
  write(path.join(model, 'config.json'), '{"synthetic":true,"not_a_model":true}\n');
  const wheels = [];
  for (const [name, module, requirements] of [
    ['mfl-install-dep', 'mfl_install_dep', []],
    ['mfl-install-probe', 'mfl_install_probe', settings.requires ?? ['mfl-install-dep==1.0.0']],
  ]) {
    const dist = name.replaceAll('-', '_'), prefix = `${dist}-1.0.0.dist-info`, filename = `${dist}-1.0.0-py3-none-any.whl`;
    const files = {
      [`${prefix}/METADATA`]: `Metadata-Version: 2.1\nName: ${name}\nVersion: 1.0.0\n${requirements.map(r => `Requires-Dist: ${r}\n`).join('')}\nSYNTHETIC TEST ONLY\n`,
      [`${prefix}/WHEEL`]: 'Wheel-Version: 1.0\nGenerator: mediflow-synthetic-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n',
      [`${module}/__init__.py`]: name.endsWith('-dep') ? 'VALUE = "synthetic-dependency-present"\n'
        : 'from mfl_install_dep import VALUE\ndef main():\n    print(VALUE)\n',
      [`${module}/empty.py`]: '',
    };
    if (name.endsWith('-probe')) files[`${prefix}/entry_points.txt`] = '[console_scripts]\nmfl-synthetic-check = mfl_install_probe:main\n';
    const out = path.join(wheelhouse, filename);
    runPython(['-c', ZIP_CODE], JSON.stringify({ files, prefix, out, extra: name.endsWith('-probe') ? settings.extraWheelEntries ?? [] : [] }));
    fs.chmodSync(out, 0o600); wheels.push({ name, version: '1.0.0', file: filename, ...digest(out) });
  }
  const pyInfo = JSON.parse(runPython(['-c', 'import sys,platform,json; print(json.dumps({"version":platform.python_version(),"platform":sys.platform,"arch":{"x86_64":"x64","aarch64":"arm64"}.get(platform.machine(),platform.machine())}))']));
  const pipFile = path.basename(TEST_PIP_WHEEL);
  const pipVersion = pipFile.split('-')[1];
  fs.copyFileSync(TEST_PIP_WHEEL, path.join(wheelhouse, pipFile)); fs.chmodSync(path.join(wheelhouse, pipFile), 0o600);
  wheels.push({ name: 'pip', version: pipVersion, file: pipFile, ...digest(path.join(wheelhouse, pipFile)) });
  const contract = { target: { platform: pyInfo.platform, arch: pyInfo.arch },
    runtimeSchema: 'mediflow.redaction-runtime-binding.v1', adapter: 'SYNTHETIC_TEST_ONLY', model: 'SYNTHETIC_NOT_GLINER',
    revision: '0'.repeat(40), packages: { 'mfl-install-probe': '1.0.0' }, files: { 'config.json': digest(path.join(model, 'config.json')).sha256 } };
  const worker = path.join(inputs, 'synthetic-worker.py');
  const behavior = settings.workerBehavior ?? 'normal';
  write(worker, `# SYNTHETIC TEST ONLY. Not the production worker; never accepted by canonical pins.\n`
    + `import hashlib,importlib.metadata,json,pathlib,sys\nfrom mfl_install_probe import VALUE\nassert VALUE == "synthetic-dependency-present"\n`
    + `def digest(p):\n    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()\n`
    + `identity = ${JSON.stringify({ schema: contract.runtimeSchema, adapter: contract.adapter, model: contract.model, revision: contract.revision })}\n`
    + `identity.update(workerSha256=digest(__file__),pythonSha256=digest(sys.executable),packages={"mfl-install-probe":importlib.metadata.version("mfl-install-probe")},files={"config.json":digest(pathlib.Path(sys.argv[1])/"config.json")})\n`
    + (behavior === 'badIdentity' ? 'identity["pythonSha256"] = "0"*64\n' : '')
    + (behavior === 'crash' ? 'sys.exit(9)\n' : '')
    + `print(json.dumps({"ready":${JSON.stringify(contract.revision)}${behavior === 'missingIdentity' ? '' : ',"runtimeIdentity":identity'}}),flush=True)\n`
    + `for line in sys.stdin:\n    request = json.loads(line)\n`
    + (behavior === 'hang' ? '    import time\n    time.sleep(60)\n' : '')
    + `    print(json.dumps({"id":request["id"],"entities":${behavior === 'badSpan' ? '{"person":[{"start":0,"end":99999,"confidence":1,"text":"bad"}]}' : '{}'}}),flush=True)\n`
    + (behavior === 'extraLine' ? '    print("{}",flush=True)\n' : ''));
  contract.workerSha256 = digest(worker).sha256;
  const manifest = { schema: 'mediflow.redaction-offline-input.v1', target: contract.target,
    python: { ...digest(fs.realpathSync(TEST_PYTHON)), version: pyInfo.version },
    worker: digest(worker), model: { revision: contract.revision, files: [{ path: 'config.json', ...digest(path.join(model, 'config.json')) }] }, wheels };
  const options = { root, python: TEST_PYTHON, worker, model, wheelhouse, manifest: path.join(inputs, 'manifest.json') };
  const refresh = () => { write(options.manifest, JSON.stringify(manifest, null, 2) + '\n'); Object.assign(options, { manifestSha256: digest(options.manifest).sha256, manifestBytes: digest(options.manifest).bytes }); };
  refresh();
  const calls = [];
  const adapter = createProcessAdapter(({ python, args, work, env }) => {
    calls.push({ python, args, work, env });
    return spawn(python, args, { cwd: work, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  });
  return { options, manifest, contract, adapter, parent, inputs, calls, refresh, write };
}
