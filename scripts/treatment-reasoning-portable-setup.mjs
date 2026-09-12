#!/usr/bin/env node
/* @Codex: explicit offline host CLI. No network, installer, user command or DB. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertNodeRuntime, readNodeContract } from './node-runtime-contract.mjs';
import { createPortableProvisioning, PortableProvisioningError } from '../lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.ts';

/**
 * @param {string[]} argv
 * @param {Parameters<typeof createPortableProvisioning>[0] & {signal?: AbortSignal}} [options]
 */
export async function runPortableSetup(argv, options = {}) {
    const provisioning = createPortableProvisioning({ applicationRoot: process.cwd(), ...options });
    const [command, flag, value, ...extra] = argv;
    if (extra.length || (['status', 'hardware'].includes(command) && (flag || value)) || (['recover', 'inventory'].includes(command) && (flag !== '--confirm' || value))
        || (!['status', 'hardware', 'recover', 'inventory'].includes(command) && (flag !== '--consent-digest' || !/^[0-9a-f]{64}$/u.test(value ?? '')))
        || !['status', 'hardware', 'inventory', 'import', 'activate', 'revoke', 'recover'].includes(command)) throw new PortableProvisioningError('consent_required');
    if (command === 'hardware') return provisioning.hardware();
    if (command === 'inventory') return provisioning.inventoryOffline({ confirmed: true, signal: options.signal });
    if (command === 'status') return provisioning.status();
    if (command === 'recover') return provisioning.recover({ confirmed: true });
    if (command === 'revoke') return provisioning.revoke({ consentDigest: value });
    return command === 'import' ? provisioning.importOffline({ consentDigest: value, signal: options.signal })
        : provisioning.activate({ consentDigest: value, signal: options.signal });
}
// @Codex: source closure only, never package Python distributions, weights or admission state.
export const TREATMENT_PORTABLE_SOURCE_CLOSURE = Object.freeze([
  "scripts/treatment-reasoning-portable-worker.py",
  "scripts/treatment-reasoning-portable-setup.mjs",
  "lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.ts",
  "lib/athena-model-identity.ts",
  "scripts/node-runtime-contract.mjs",
  ".nvmrc"
]);
export function treatmentPortablePrivateArtifact(relative) {
  return /(?:^|\/)(?:treatment-reasoning-portable|\.venv|site-packages|__pycache__)(?:\/|$)/u.test(relative)
    || /\.(?:safetensors|gguf|ckpt|pt|pth)$/iu.test(relative)
    || /(?:^|\/)(?:\.env(?:\.[^/]*)?|id_rsa|id_ed25519|credentials\.json|auth\.json)$/iu.test(relative)
    || /(?:^|\/)(?:python(?:\d+(?:\.\d+)*)?(?:\.exe|\.dll|\.zip)?|libpython[^/]*\.(?:so(?:\.\d+)*|dylib))$/iu.test(relative);
}
export function bundledTreatmentPortableFailure(standaloneDir, sourceRoot) {
  try {
    const bundle = fs.realpathSync(standaloneDir);
    const physical = (relative) => {
      if (path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) throw new Error();
      let current = bundle;
      for (const part of relative.split('/')) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error();
      }
      if (!fs.lstatSync(current).isFile() || fs.statSync(current).size > 8 * 1024 * 1024
        || fs.realpathSync(current) !== current) throw new Error();
      return current;
    };
    for (const relative of TREATMENT_PORTABLE_SOURCE_CLOSURE) {
      const bundled = physical(relative);
      const source = path.join(sourceRoot, relative);
      if (createHash('sha256').update(fs.readFileSync(bundled)).digest('hex')
        !== createHash('sha256').update(fs.readFileSync(source)).digest('hex')) {
        return 'Standalone Treatment portable source digest mismatch.';
      }
    }
    // The CLI reads this package contract. Next may serialize the package file,
    // so verify its exact Node semantics rather than require identical formatting.
    physical('package.json');
    const deployedNode = readNodeContract(bundle);
    const sourceNode = readNodeContract(sourceRoot);
    if (deployedNode.major !== sourceNode.major || deployedNode.engines !== sourceNode.engines) {
      return 'Standalone Treatment portable Node contract mismatch.';
    }
    // These are the two real production boundaries, not a disconnected CLI smoke.
    const dist = path.basename(path.dirname(standaloneDir));
    for (const action of ['preview', 'ingest']) {
      const route = `${dist}/server/app/api/ai/treatment-reasoning/${action}/route.js`;
      physical(route);
      const tracePath = physical(`${route}.nft.json`);
      const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
      if (trace.version !== 1 || !Array.isArray(trace.files)
        || !trace.files.every(file => typeof file === 'string' && !path.isAbsolute(file))) {
        return 'Standalone Treatment portable route trace invalid.';
      }
      const traced = new Set(trace.files.map(file => path.resolve(path.dirname(tracePath), file)));
      for (const relative of [...TREATMENT_PORTABLE_SOURCE_CLOSURE, 'package.json']) {
        if (!traced.has(path.join(bundle, relative))) return 'Standalone Treatment portable source closure missing from route trace.';
      }
    }
    let count = 0;
    const walkPortable = (directory, depth = 0) => {
      if (depth > 64 || count > 200_000) throw new Error();
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        count++;
        const absolute = path.join(directory, item.name);
        const relative = path.relative(bundle, absolute).split(path.sep).join('/');
        if (treatmentPortablePrivateArtifact(relative)) throw new Error();
        if (item.isDirectory()) walkPortable(absolute, depth + 1);
        // Other package symlinks remain governed by existing bundle guards.
      }
    };
    walkPortable(bundle);
    return null;
  } catch { return 'Standalone Treatment portable closure missing, non-physical, or contains model/runtime/private data.'; }
}
export function runTreatmentPortableSelfTest() {
  const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  // Canonicalize ONLY this newly owned test directory; production guard is unchanged.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-treatment-bundle-test-')));
  const bundle = path.join(root, '.next-synthetic', 'standalone');
  const write = (relative, bytes) => {
    const filename = path.join(bundle, relative); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes);
  };
  const reset = () => {
    fs.rmSync(bundle, { recursive: true, force: true }); fs.mkdirSync(bundle, { recursive: true });
    for (const relative of TREATMENT_PORTABLE_SOURCE_CLOSURE) write(relative, fs.readFileSync(path.join(source, relative)));
    write('package.json', fs.readFileSync(path.join(source, 'package.json')));
    for (const action of ['preview', 'ingest']) {
      const route = `.next-synthetic/server/app/api/ai/treatment-reasoning/${action}/route.js`;
      write(route, '// Synthetic packaging route only. No inference or auth simulation.\n');
      const trace = { version: 1, files: [...TREATMENT_PORTABLE_SOURCE_CLOSURE, 'package.json'].map(relative => path.relative(path.dirname(path.join(bundle, route)), path.join(bundle, relative)).split(path.sep).join('/')) };
      write(`${route}.nft.json`, JSON.stringify(trace));
    }
  };
  let cases = 0;
  const denied = (mutate) => { reset(); mutate(); if (!bundledTreatmentPortableFailure(bundle, source)) throw new Error('Treatment bundle negative case admitted.'); cases++; };
  try {
    reset(); if (bundledTreatmentPortableFailure(bundle, source)) throw new Error('Treatment synthetic closure denied.'); cases++;
    for (const relative of TREATMENT_PORTABLE_SOURCE_CLOSURE) {
      denied(() => fs.rmSync(path.join(bundle, relative)));
      denied(() => fs.appendFileSync(path.join(bundle, relative), '\nsynthetic tamper'));
    }
    denied(() => fs.rmSync(path.join(bundle, 'package.json')));
    denied(() => write('package.json', JSON.stringify({ engines: { node: '>=22 <23' } })));
    denied(() => {
      const relative = '.next-synthetic/server/app/api/ai/treatment-reasoning/preview/route.js.nft.json';
      const trace = JSON.parse(fs.readFileSync(path.join(bundle, relative), 'utf8'));
      trace.files = trace.files.filter(file => !file.endsWith('/package.json'));
      write(relative, JSON.stringify(trace));
    });
    denied(() => write('.next-synthetic/server/app/api/ai/treatment-reasoning/preview/route.js.nft.json', '{'));
    denied(() => write('.next-synthetic/server/app/api/ai/treatment-reasoning/ingest/route.js.nft.json', JSON.stringify({ version: 1, files: [] })));
    denied(() => write('.next-synthetic/server/app/api/ai/treatment-reasoning/preview/route.js.nft.json', JSON.stringify({ version: 2, files: [] })));
    for (const relative of ['payload/model.safetensors', 'payload/model.gguf', 'runtime/python.exe', 'runtime/site-packages/torch/config.json',
      'treatment-reasoning-portable/selected.json', '.env.local', 'credentials.json']) denied(() => write(relative, 'SYNTHETIC PRIVATE ARTIFACT'));
    // Junction creation needs no developer-mode file symlink privilege on Windows.
    denied(() => {
      const directory = path.join(bundle, 'lib'); const outside = path.join(root, 'outside-lib');
      fs.rmSync(outside, { recursive: true, force: true }); fs.renameSync(directory, outside);
      fs.symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
    });
    return Object.freeze({ check: 'treatment-portable-bundle-synthetic', cases, liveInference: false });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.versions.node.split('.')[0] !== '24') {
        process.stderr.write('NODE_24_REQUIRED\n'); process.exitCode = 2;
    } else {
        const controller = new AbortController(); const cancel = () => controller.abort();
        process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
        try {
            assertNodeRuntime(readNodeContract());
            // Direct Node CLI is its own launcher: locate the deployed application next
            // to this script, even when the operator's cwd is elsewhere. This branch
            // is not a Next module and never derives a path from a bundled URL.
            const applicationRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
            const status = await runPortableSetup(process.argv.slice(2), { applicationRoot, signal: controller.signal });
            process.stdout.write(JSON.stringify(status) + '\n');
            if ('blockers' in status ? status.blockers.length !== 0 : !['admitted', 'needs_activation'].includes(status.state)) process.exitCode = 3;
        } catch (error) {
            const code = error instanceof PortableProvisioningError ? error.code : 'unavailable';
            process.stdout.write(JSON.stringify({ status: 'denied', code, writesPerformed: 0, applyPolicy: 'none' }) + '\n');
            process.exitCode = code === 'cancelled' ? 130 : 2;
        } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    }
}
