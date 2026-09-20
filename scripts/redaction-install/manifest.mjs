/* @Codex — local manifest is byte integrity, NOT provenance or model qualification. */
import fs from 'node:fs';
import path from 'node:path';
import { absolute, demand, exactKeys, relative, equal, checkFile, pathGuard, closedTree, strictJson } from './guards.mjs';

export const INPUT_SCHEMA = 'mediflow.redaction-offline-input.v1';
export const DESCRIPTOR_SCHEMA = 'mediflow.redaction-installation.v1';
export const RECEIPT_SCHEMA = 'mediflow.redaction-installation-receipt.v1';
export const normalizeName = name => name.toLowerCase().replace(/[-_.]+/g, '-');
export function artifact(entry, extra = []) {
  exactKeys(entry, ['bytes', 'sha256', ...extra]);
  demand(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= 4 * 1024 ** 3
    && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256), 'artifact_schema_invalid');
}
function packageVersion(name, version) {
  demand(typeof name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
    && typeof version === 'string' && /^[0-9][A-Za-z0-9.!+_-]{0,100}$/.test(version), 'package_pin_invalid');
}
export function loadManifest(options, contract) {
  absolute(options.manifest);
  demand(Number.isSafeInteger(options.manifestBytes) && options.manifestBytes > 0 && options.manifestBytes <= 2 * 1024 ** 2
    && /^[a-f0-9]{64}$/.test(options.manifestSha256), 'manifest_digest_required');
  const raw = checkFile(options.manifest, { bytes: options.manifestBytes, sha256: options.manifestSha256 }, { keep: true, maximum: 2 * 1024 ** 2 });
  const m = strictJson(raw.data.toString('utf8'));
  exactKeys(m, ['schema', 'target', 'python', 'worker', 'model', 'wheels']);
  demand(m.schema === INPUT_SCHEMA, 'manifest_schema_invalid');
  exactKeys(m.target, ['platform', 'arch']); demand(equal(m.target, contract.target), 'target_mismatch');
  artifact(m.python, ['version']);
  demand(typeof m.python.version === 'string' && /^3\.(?:1[1-9]|[2-9][0-9])\.\d+$/.test(m.python.version), 'python_version_invalid');
  artifact(m.worker); demand(m.worker.sha256 === contract.workerSha256, 'worker_pin_mismatch');
  exactKeys(m.model, ['revision', 'files']); demand(m.model.revision === contract.revision && Array.isArray(m.model.files), 'model_pin_mismatch');
  demand(m.model.files.length === Object.keys(contract.files).length, 'model_inventory_invalid');
  const seenModels = new Set();
  for (const entry of m.model.files) {
    artifact(entry, ['path']); relative(entry.path);
    demand(!seenModels.has(entry.path) && contract.files[entry.path] === entry.sha256, 'model_pin_mismatch'); seenModels.add(entry.path);
  }
  demand(Array.isArray(m.wheels) && m.wheels.length > 0 && m.wheels.length <= 512, 'wheel_inventory_invalid');
  const names = new Set(), filenames = new Set();
  for (const wheel of m.wheels) {
    artifact(wheel, ['file', 'name', 'version']); packageVersion(wheel.name, wheel.version); relative(wheel.file);
    demand(/^[A-Za-z0-9][A-Za-z0-9_.+!-]*\.whl$/.test(wheel.file) && !wheel.file.includes('/')
      && !names.has(wheel.name) && !filenames.has(wheel.file.toLowerCase()), 'wheel_inventory_invalid');
    names.add(wheel.name); filenames.add(wheel.file.toLowerCase());
  }
  demand(names.has('pip'), 'explicit_pip_wheel_required');
  for (const [name, version] of Object.entries(contract.packages)) {
    demand(m.wheels.some(w => w.name === name && w.version === version), 'runtime_package_pin_mismatch');
  }
  return { manifest: m, raw: raw.data, sha256: raw.sha256 };
}

export function checkPython(input, manifest) {
  absolute(input);
  // Only this explicitly selected interpreter may be a symlink. Its physical bytes
  // are verified; invocation in the NEW venv must remain the venv pathname.
  let physical; try { physical = fs.realpathSync(input); } catch { demand(false, 'python_missing'); }
  absolute(physical); const info = pathGuard(physical);
  demand(info.isFile() && (info.mode & 0o111), 'python_not_executable');
  checkFile(physical, manifest.python, { maximum: 256 * 1024 ** 2 }); return physical;
}
export function checkInputs(options, m) {
  for (const name of ['worker', 'model', 'wheelhouse']) absolute(options[name]);
  const wheelEntries = m.wheels.map(w => ({ path: w.file, bytes: w.bytes, sha256: w.sha256 }));
  checkFile(options.worker, m.worker, { maximum: 1024 ** 2 });
  closedTree(options.model, m.model.files); closedTree(options.wheelhouse, wheelEntries);
  const paths = ['manifest', 'worker', 'model', 'wheelhouse', 'python'].map(k => fs.realpathSync(options[k]));
  demand(paths.every(p => p !== options.root && !p.startsWith(options.root + path.sep)
    && !options.root.startsWith(p + path.sep)), 'input_destination_overlap');
}
export function lockText(manifest) {
  return '# Generated ONLY from verified explicit local artifact digests.\n'
    + [...manifest.wheels].sort((a, b) => a.name.localeCompare(b.name))
      .map(w => `${w.name}==${w.version} --hash=sha256:${w.sha256}`).join('\n') + '\n';
}
export function expectedPackages(m) {
  return Object.fromEntries(m.wheels.map(w => [w.name, w.version]));
}
