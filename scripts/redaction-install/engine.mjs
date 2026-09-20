/* @Codex — local provisioning transaction. A slot is staging until runtime.json
 * is linked atomically. The slot pathname NEVER changes: venvs are not relocated.
 * This module's dependency seam is for synthetic tests, not a CLI/HTTP authority. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  InstallError, absolute, demand, exactKeys, equal, inode, pathGuard, hashFile, checkFile,
  copyVerified, closedTree, writeNew, syncDirectory, strictJson,
} from './guards.mjs';
import {
  DESCRIPTOR_SCHEMA, RECEIPT_SCHEMA, loadManifest, checkPython, checkInputs, lockText, expectedPackages,
} from './manifest.mjs';
import { pipArguments } from './process.mjs';

function assertRoot(root, stamp) {
  const stat = pathGuard(root, { privateLeaf: true });
  demand(inode(stat) === stamp, 'root_changed');
}
function assertSlot(root, rootStamp, slot, slotStamp) {
  assertRoot(root, rootStamp);
  const stat = pathGuard(slot, { privateLeaf: true }); demand(inode(stat) === slotStamp, 'staging_changed');
}
function noPublishedDescriptor(root, slot) {
  demand(equal(fs.readdirSync(root), [path.basename(slot)]), 'destination_changed');
}
function cancel(signal, phase) { demand(!signal?.aborted, 'interrupted', phase); }
function mkdir(directory) { fs.mkdirSync(directory, { mode: 0o700 }); }
function identity(m, c) {
  return { schema: c.runtimeSchema, adapter: c.adapter, model: c.model, revision: c.revision,
    workerSha256: c.workerSha256, pythonSha256: m.python.sha256, packages: c.packages, files: c.files };
}
function assertBase(observed, m, physical) {
  demand(observed.implementation === 'CPython' && observed.version === m.python.version
    && observed.platform === m.target.platform && observed.arch === m.target.arch
    && observed.pythonSha256 === m.python.sha256 && observed.physicalExecutable === physical
    && observed.prefix === observed.basePrefix,
  'base_interpreter_mismatch');
}
function assertEnvironment(observed, m, slot, physical, basePrefix, packages) {
  demand(observed.implementation === 'CPython' && observed.version === m.python.version
    && observed.platform === m.target.platform && observed.arch === m.target.arch
    && observed.pythonSha256 === m.python.sha256 && observed.physicalExecutable === physical
    && observed.executable === path.join(slot, 'venv', 'bin', 'python')
    && observed.prefix === path.join(slot, 'venv') && observed.basePrefix === basePrefix
    && observed.prefix !== observed.basePrefix && equal(observed.packages, packages), 'venv_environment_mismatch');
}
function verifyAssets(slot, m, raw, physical) {
  checkFile(path.join(slot, 'worker.py'), m.worker);
  closedTree(path.join(slot, 'model'), m.model.files);
  closedTree(path.join(slot, 'wheels'), m.wheels.map(w => ({ ...w, path: w.file })));
  demand(fs.readFileSync(path.join(slot, 'artifact-manifest.json')).equals(raw), 'stored_manifest_mismatch');
  demand(fs.readFileSync(path.join(slot, 'requirements.lock'), 'utf8') === lockText(m), 'lock_changed');
  const config = hashFile(path.join(slot, 'venv', 'pyvenv.cfg'), { keep: true, maximum: 64 * 1024 }).data.toString('utf8');
  const matches = config.split(/\r?\n/).filter(line => /^include-system-site-packages\s*=/.test(line));
  demand(matches.length === 1 && /^include-system-site-packages\s*=\s*false\s*$/.test(matches[0]), 'venv_system_packages_denied');
  demand(fs.realpathSync(path.join(slot, 'venv', 'bin', 'python')) === physical, 'venv_interpreter_changed');
  checkFile(physical, m.python, { maximum: 256 * 1024 ** 2 });
}

/** No chmod/read/remove through symlinks. Only venv-created interpreter aliases
 * and Linux lib64 (test portability) are admitted; all resolve to known targets. */
export function inventorySlot(slot, physical, { seal = false, publishedDescriptor } = {}) {
  const result = [];
  function walk(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (rel === 'installation.json') continue;
      demand(result.length < 200_000, 'installed_inventory_too_large');
      const file = path.join(directory, name); let stat = fs.lstatSync(file);
      demand(stat.uid === process.getuid(), 'installed_owner_invalid');
      if (stat.isSymbolicLink()) {
        const resolved = fs.realpathSync(file), target = fs.readlinkSync(file);
        // @Codex Python 3.14 on macOS also creates the documented Unicode
        // `𝜋thon` launcher. Keep the allowlist exact and bind every alias to
        // the already verified physical interpreter.
        const interpreter = (/^venv\/bin\/python(?:3(?:\.\d+)?)?$/.test(rel)
          || rel === 'venv/bin/𝜋thon') && resolved === physical;
        const lib64 = rel === 'venv/lib64' && resolved === path.join(slot, 'venv', 'lib');
        demand(interpreter || lib64, 'installed_symlink_denied');
        result.push({ path: rel, type: 'symlink', target }); continue;
      }
      demand(stat.isDirectory() || stat.isFile(), 'installed_special_file');
      demand(!(stat.mode & 0o6000), 'installed_privileged_file');
      if (stat.isFile() && stat.nlink !== 1) {
        demand(rel === 'descriptor.json' && stat.nlink === 2 && publishedDescriptor
          && inode(fs.lstatSync(publishedDescriptor)) === inode(stat), 'installed_hardlink_denied');
      }
      if (seal) {
        fs.chmodSync(file, stat.isDirectory() || (stat.mode & 0o111) ? 0o700 : 0o600);
        stat = fs.lstatSync(file);
      }
      demand(!(stat.mode & 0o077), 'installed_permissions_invalid');
      if (stat.isDirectory()) {
        result.push({ path: rel, type: 'directory', mode: stat.mode & 0o777 }); walk(file, rel);
        if (seal) syncDirectory(file);
      } else {
        const hashed = hashFile(file, { allowEmpty: true });
        result.push({ path: rel, type: 'file', mode: stat.mode & 0o777, bytes: hashed.bytes, sha256: hashed.sha256 });
        if (seal) {
          const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
          try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        }
      }
    }
  }
  walk(slot); if (seal) syncDirectory(slot); return result;
}
function result(status, manifestSha256, receiptSha256, durability) {
  return { schema: 'mediflow.redaction-install-result.v1', status, manifestSha256, receiptSha256,
    authority: 'installation_only', runtimeQualification: 'not_assessed', readiness: 'not_assessed',
    technicalSmoke: status === 'installed' ? 'passed' : 'not_run_read_only', durability };
}

export async function install(options, contract, adapter, signal) {
  let phase = 'preflight', rootStamp, slot, slotStamp, committed = false;
  try {
    absolute(options.root); cancel(signal, phase);
    const previous = pathGuard(options.root, { missingLeaf: true });
    if (previous) {
      pathGuard(options.root, { privateLeaf: true }); demand(fs.readdirSync(options.root).length === 0, 'destination_not_empty');
    }
    const parent = pathGuard(path.dirname(options.root));
    demand(parent.isDirectory() && parent.uid === process.getuid() && !(parent.mode & 0o022), 'destination_parent_not_owned');
    const parentStamp = inode(parent);
    const loaded = loadManifest(options, contract), m = loaded.manifest;
    const physical = checkPython(options.python, m);
    checkInputs(options, m); cancel(signal, phase);
    // All supplied artifacts have been hashed before executing the interpreter or pip.
    demand(inode(pathGuard(path.dirname(options.root))) === parentStamp, 'destination_parent_changed');
    if (!previous) mkdir(options.root);
    rootStamp = inode(pathGuard(options.root, { privateLeaf: true }));
    if (previous) demand(rootStamp === inode(previous), 'root_changed');
    demand(fs.readdirSync(options.root).length === 0, 'destination_not_empty');
    slot = path.join(options.root, `runtime-${randomUUID()}`); mkdir(slot); slotStamp = inode(fs.lstatSync(slot));
    noPublishedDescriptor(options.root, slot);
    for (const name of ['model', 'wheels', 'work']) mkdir(path.join(slot, name));
    const work = path.join(slot, 'work');
    const context = extra => ({ python: physical, work, writable: slot, phase, signal, ...extra });
    const checkStage = () => { cancel(signal, phase); assertSlot(options.root, rootStamp, slot, slotStamp); };
    phase = 'snapshot';
    writeNew(path.join(slot, 'artifact-manifest.json'), loaded.raw);
    writeNew(path.join(slot, 'requirements.lock'), lockText(m));
    copyVerified(options.worker, path.join(slot, 'worker.py'), m.worker);
    for (const entry of m.model.files) {
      const target = path.join(slot, 'model', entry.path);
      const parts = entry.path.split('/').slice(0, -1); let directory = path.join(slot, 'model');
      for (const part of parts) { directory = path.join(directory, part); if (!fs.existsSync(directory)) mkdir(directory); }
      copyVerified(path.join(options.model, entry.path), target, entry);
    }
    for (const wheel of m.wheels) copyVerified(path.join(options.wheelhouse, wheel.file), path.join(slot, 'wheels', wheel.file), wheel);
    checkStage(); checkFile(physical, m.python, { maximum: 256 * 1024 ** 2 });
    phase = 'base-interpreter';
    const base = await adapter.inspect('base', context()); assertBase(base, m, physical); checkStage();
    phase = 'wheel-audit';
    const payload = { wheels: m.wheels, wheelhouse: path.join(slot, 'wheels') };
    const audited = await adapter.inspect('wheels', context({ timeout: 900_000 }), payload);
    demand(audited.auditedWheels === m.wheels.length, 'wheel_audit_incomplete'); checkStage();
    phase = 'venv';
    const venv = path.join(slot, 'venv'), python = path.join(venv, 'bin', 'python');
    await adapter.module('venv', ['--without-pip', '--symlinks', venv], context()); checkStage();
    // Audit immediately, before writing packages through venv paths.
    inventorySlot(slot, physical, { seal: true });
    demand(fs.realpathSync(python) === physical, 'venv_interpreter_changed');
    phase = 'empty-venv';
    const empty = await adapter.inspect('environment', context({ python }));
    assertEnvironment(empty, m, slot, physical, base.basePrefix, {});
    const pipArtifact = m.wheels.find(w => w.name === 'pip');
    const pipWheel = path.join(slot, 'wheels', pipArtifact.file);
    phase = 'dependency-closure';
    await adapter.pip(pipWheel, pipArguments(slot, 'plan'), context({ python, timeout: 900_000 })); checkStage();
    const plan = await adapter.inspect('plan', context({ python }), { ...payload, report: path.join(work, 'plan.json') });
    demand(plan.lockedWheels === m.wheels.length, 'dependency_closure_incomplete');
    phase = 'packages';
    await adapter.pip(pipWheel, pipArguments(slot, 'install'), context({ python, timeout: 900_000 })); checkStage();
    const applied = await adapter.inspect('plan', context({ python }), { ...payload, report: path.join(work, 'install.json') });
    demand(applied.lockedWheels === m.wheels.length, 'installation_plan_mismatch');
    await adapter.module('pip', ['--isolated', '--disable-pip-version-check', '--no-cache-dir', 'check'], context({ python }));
    phase = 'final-environment';
    const installed = await adapter.inspect('environment', context({ python }));
    assertEnvironment(installed, m, slot, physical, base.basePrefix, expectedPackages(m));
    // Exercises the actual final-path shebang, including spaces in Application Support.
    const pip = await adapter.entryPoint(path.join(venv, 'bin', 'pip'), ['--isolated', '--version'], context({ python }));
    demand(pip.startsWith(`pip ${pipArtifact.version} from ${venv}${path.sep}`), 'venv_entrypoint_invalid');
    checkStage(); inventorySlot(slot, physical, { seal: true }); verifyAssets(slot, m, loaded.raw, physical);
    phase = 'technical-smoke';
    await adapter.smoke(context({ python }), identity(m, contract), path.join(slot, 'worker.py'), path.join(slot, 'model'));
    checkStage(); verifyAssets(slot, m, loaded.raw, physical);
    phase = 'seal';
    // work is inside this run's owned staging slot. No caller input is removed.
    fs.rmSync(work, { recursive: true, force: false });
    demand(equal(fs.readdirSync(slot).sort(), ['artifact-manifest.json', 'model', 'requirements.lock', 'venv', 'wheels', 'worker.py'].sort()), 'staging_inventory_changed');
    const descriptor = { schema: DESCRIPTOR_SCHEMA, pythonExecutable: python,
      workerPath: path.join(slot, 'worker.py'), modelDirectory: path.join(slot, 'model') };
    writeNew(path.join(slot, 'descriptor.json'), JSON.stringify(descriptor, null, 2) + '\n');
    const inventory = inventorySlot(slot, physical, { seal: true });
    const receipt = { schema: RECEIPT_SCHEMA, authority: 'installation_only', manifestSha256: loaded.sha256,
      pythonPhysical: physical, pythonBasePrefix: base.basePrefix, packages: expectedPackages(m), inventory };
    writeNew(path.join(slot, 'installation.json'), JSON.stringify(receipt, null, 2) + '\n');
    const receiptHash = hashFile(path.join(slot, 'installation.json'), { maximum: 64 * 1024 ** 2 }).sha256;
    demand(equal(inventorySlot(slot, physical), inventory), 'installed_inventory_changed');
    verifyAssets(slot, m, loaded.raw, physical); checkStage(); noPublishedDescriptor(options.root, slot);
    syncDirectory(slot); syncDirectory(options.root); cancel(signal, phase);
    phase = 'publish';
    // link is a same-filesystem, atomic NO-REPLACE publication. Unlike rename,
    // it cannot overwrite a descriptor which appeared after the preflight.
    fs.linkSync(path.join(slot, 'descriptor.json'), path.join(options.root, 'runtime.json'));
    committed = true;
    // No throwable post-commit cleanup: the descriptor and stable slot must stay.
    let durability = 'confirmed';
    try { syncDirectory(options.root); } catch { durability = 'not_confirmed'; }
    return result('installed', loaded.sha256, receiptHash, durability);
  } catch (error) {
    let rollback = 'not_needed';
    if (!committed && slot && slotStamp) {
      try {
        assertSlot(options.root, rootStamp, slot, slotStamp);
        fs.rmSync(slot, { recursive: true, force: false }); rollback = 'own_staging_removed';
      } catch { rollback = 'staging_preserved_identity_or_cleanup_failed'; }
    }
    const safe = error instanceof InstallError ? error : new InstallError(error?.code === 'EEXIST' ? 'no_overwrite' : 'installation_io_failed', phase);
    safe.phase = phase; safe.rollback = rollback; throw safe;
  }
}

/** Read-only and deliberately not a repair command. No new smoke/report/grant. */
export async function verify(options, contract, adapter, signal) {
  const phase = 'verify';
  try {
    absolute(options.root); const stamp = inode(pathGuard(options.root, { privateLeaf: true }));
    demand(typeof options.receiptSha256 === 'string' && /^[a-f0-9]{64}$/.test(options.receiptSha256), 'receipt_digest_required');
    const loaded = loadManifest(options, contract), m = loaded.manifest, physical = checkPython(options.python, m);
    const descriptorFile = path.join(options.root, 'runtime.json');
    const rawDescriptor = hashFile(descriptorFile, { maximum: 2 * 1024 ** 2, keep: true });
    const d = strictJson(rawDescriptor.data.toString('utf8'));
    exactKeys(d, ['schema', 'pythonExecutable', 'workerPath', 'modelDirectory']);
    demand(d.schema === DESCRIPTOR_SCHEMA, 'descriptor_schema_invalid');
    for (const p of [d.pythonExecutable, d.workerPath, d.modelDirectory]) absolute(p);
    const slot = path.dirname(d.workerPath);
    demand(path.dirname(slot) === options.root && /^runtime-[a-f0-9-]{36}$/.test(path.basename(slot))
      && d.workerPath === path.join(slot, 'worker.py') && d.modelDirectory === path.join(slot, 'model')
      && d.pythonExecutable === path.join(slot, 'venv', 'bin', 'python'), 'descriptor_path_invalid');
    const slotStamp = inode(pathGuard(slot, { privateLeaf: true }));
    demand(inode(fs.lstatSync(path.join(slot, 'descriptor.json'))) === inode(fs.lstatSync(descriptorFile)), 'descriptor_binding_invalid');
    const rawReceipt = hashFile(path.join(slot, 'installation.json'), { maximum: 64 * 1024 ** 2, keep: true });
    demand(rawReceipt.sha256 === options.receiptSha256, 'receipt_integrity_mismatch');
    const r = strictJson(rawReceipt.data.toString('utf8'), 2_000_000);
    exactKeys(r, ['schema', 'authority', 'manifestSha256', 'pythonPhysical', 'pythonBasePrefix', 'packages', 'inventory']);
    demand(r.schema === RECEIPT_SCHEMA && r.authority === 'installation_only' && r.manifestSha256 === loaded.sha256
      && r.pythonPhysical === physical && equal(r.packages, expectedPackages(m)) && Array.isArray(r.inventory), 'receipt_mismatch');
    demand(equal(inventorySlot(slot, physical, { publishedDescriptor: descriptorFile }), r.inventory), 'installed_inventory_changed');
    verifyAssets(slot, m, loaded.raw, physical); cancel(signal, phase);
    // Inspection uses stdlib metadata only, -I -B and a read-only sandbox.
    const context = { python: physical, work: options.root, phase, signal };
    const base = await adapter.inspect('base', context); assertBase(base, m, physical);
    demand(base.basePrefix === r.pythonBasePrefix, 'base_interpreter_mismatch');
    const env = await adapter.inspect('environment', { ...context, python: d.pythonExecutable });
    assertEnvironment(env, m, slot, physical, r.pythonBasePrefix, expectedPackages(m));
    assertSlot(options.root, stamp, slot, slotStamp); cancel(signal, phase);
    demand(hashFile(descriptorFile).sha256 === rawDescriptor.sha256
      && hashFile(path.join(slot, 'installation.json'), { maximum: 64 * 1024 ** 2 }).sha256 === rawReceipt.sha256
      && equal(inventorySlot(slot, physical, { publishedDescriptor: descriptorFile }), r.inventory), 'verification_changed');
    return result('verified', loaded.sha256, rawReceipt.sha256, 'not_reassessed_read_only');
  } catch (error) {
    const safe = error instanceof InstallError ? error : new InstallError('verification_io_failed', phase);
    safe.phase = phase; safe.rollback = 'read_only'; throw safe;
  }
}
