/* @Codex: one delivery closure, not a runtime installer. Only reads the current
 * checkout and already-normalized app; Next's installed tracer is build-only. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { physicalPath, physicalFiles, physicalRecord, sha256 } from './launch-bundled-headless-supervisor.mjs';
import { assertNodeRuntime, readNodeContract } from './node-runtime-contract.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/u, '');
const SEEDS = ['scripts/mediflow-headless-supervisor.mjs', 'scripts/intelligent-host-mcp-stdio.mjs',
  'scripts/node-runtime-contract.mjs', 'scripts/register-strip-types-loader.mjs', 'scripts/run-strip-types.mjs'];
const TOKEN = '__MEDIFLOW_HEADLESS_ROSTER_SHA256__';
const PREFIX = 'Resources/WebRuntime/HeadlessRuntime/';
const WRAPPER = `/* @Codex: same guarded loader in the parent and exact MCP child. */
import { installHeadlessLoader } from '../../../mediflow-headless-supervisor.mjs';
await installHeadlessLoader();
`;
function deny(message) { throw new Error(message); }
export function appLayout(app, writing = false) {
  physicalPath(app, true);
  if (!app.endsWith('.app')) deny('Expected a physical .app directory.');
  const contents = physicalPath(path.join(app, 'Contents'), true);
  const resources = physicalPath(path.join(contents, 'Resources'), true);
  const web = physicalPath(path.join(resources, 'WebRuntime'), true);
  if (writing) for (const name of ['_CodeSignature', 'CodeResources']) {
    try { fs.lstatSync(path.join(contents, name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    deny('Refusing to stage into a sealed app.');
  }
  return { contents, resources, web, runtime: path.join(web, 'HeadlessRuntime'),
    launcher: path.join(resources, 'mediflow-headless-supervisor.mjs') };
}
function copyFile(source, target) {
  physicalPath(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  physicalPath(path.dirname(target), true);
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, fs.statSync(source).mode & 0o755);
  if (physicalRecord(source).sha256 !== physicalRecord(target).sha256) deny('Copy changed bytes.');
}
export function traceSourceText(ts, file, source, root) {
  if (/\.[cm]?tsx?$/u.test(file)) {
    // Match register-strip-types-loader exactly; this transformation is trace-only.
    const cjs = /\brequire\s*\(/u.test(source) || /\bmodule\.exports\b/u.test(source);
    const esm = /\bimport\.meta\b/u.test(source)
      || /\bfrom\s+['"]\.{1,2}\/[^'"]+\.[cm]?tsx?['"]/u.test(source)
      || /\bimport\s*\(\s*['"]\.{1,2}\/[^'"]+\.[cm]?tsx?['"]\s*\)/u.test(source);
    source = ts.transpileModule(source, { fileName: file, compilerOptions: {
      esModuleInterop: true, isolatedModules: true, jsx: ts.JsxEmit.ReactJSX,
      module: esm && !cjs ? ts.ModuleKind.ES2022 : ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false,
    } }).outputText;
  }
  // The runtime loader owns this inert shim. It is not a package dependency.
  source = source.replace(/\bimport\s*['"]server-only['"]\s*;?/gu, '')
    .replace(/\brequire\(\s*['"]server-only['"]\s*\)/gu, '({})');
  return source.replace(/(\bfrom\s*|\bimport\s*\(\s*|\brequire(?:\.resolve)?\s*\(\s*|\bimport\s*)(['"])([^'"]+)\2/gu,
    (whole, lead, quote, specifier) => {
      if (!specifier.startsWith('@/') && !specifier.startsWith('./') && !specifier.startsWith('../')) return whole;
      const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      const candidates = path.extname(base) ? [base] : [base + '.ts', base + '.tsx', base + '.mts', base + '.js', base + '.mjs',
        path.join(base, 'index.ts'), path.join(base, 'index.tsx'), path.join(base, 'index.js')];
      const resolved = candidates.find(item => fs.existsSync(item) && fs.statSync(item).isFile());
      if (!resolved) deny(`Missing source dependency: ${path.relative(root, base)}`);
      return `${lead}${JSON.stringify(resolved)}`;
    });
}
async function trace(nodeFileTrace, seeds, root, options = {}) {
  const result = await nodeFileTrace(seeds.map(file => path.join(root, file)), {
    base: root, processCwd: root, mixedModules: true,
    // Do not turn computed imports into a directory/package sweep.
    analysis: { emitGlobs: false, computeFileReferences: true, evaluatePureExpressions: true }, ...options,
  });
  if (result.warnings.size) deny(`Headless trace is not closed:\n${[...result.warnings].map(value => value.message).sort().join('\n')}`);
  return [...result.fileList].sort().map(relative => {
    const file = path.join(root, relative);
    if (!file.startsWith(`${root}${path.sep}`) || path.normalize(file) !== file) deny('Trace escaped its root.');
    physicalPath(file); return relative.split(path.sep).join('/');
  });
}
export async function stageHeadlessRuntime(app) {
  const layout = appLayout(app, true);
  assertNodeRuntime(readNodeContract(ROOT));
  physicalPath(process.execPath); physicalPath(path.join(ROOT, 'node_modules'), true);
  for (const file of SEEDS) physicalPath(path.join(ROOT, file));
  for (const name of [layout.runtime, layout.launcher]) {
    try {
      fs.lstatSync(name);
      if (name === layout.runtime) deny('Headless destination must be absent; use a fresh WebRuntime.');
      physicalPath(name);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const require = createRequire(path.join(ROOT, 'package.json'));
  const { nodeFileTrace } = require('next/dist/compiled/@vercel/nft');
  const ts = require('typescript');
  const sourceFiles = await trace(nodeFileTrace, SEEDS, ROOT, {
    // Share the already-normalized SQLite loader/native target, never a second Mach-O.
    // Web standalone is shared separately. Mini is a different delivery lane,
    // and SQLite uses the normalized/signed copy already inside the app.
    ignore: file => /(?:^|\/)(?:\.next|packages\/mini|node_modules\/better-sqlite3)(?:\/|$)/u.test(file),
    readFile: async file => {
      let bytes;
      try { bytes = await fs.promises.readFile(file, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'EISDIR') return null; throw error; }
      return /\.[cm]?[jt]sx?$/u.test(file) && !file.includes(`${path.sep}node_modules${path.sep}`)
        ? traceSourceText(ts, file, bytes, ROOT) : bytes;
    },
  });
  const files = new Set([...sourceFiles, '.nvmrc', 'package.json']);
  // The existing DB bootstrap reads the migration journal and SQL by filename.
  const drizzle = physicalPath(path.join(ROOT, 'drizzle'), true);
  for (const name of fs.readdirSync(drizzle).filter(name => /^\d[^/]*\.sql$/u.test(name)).sort()) files.add(`drizzle/${name}`);
  files.add('drizzle/meta/_journal.json');
  for (const name of files) {
    if (/(?:^|\/)(?:\.git|\.codex|\.env|packages\/mini)(?:\/|$)|\.test\.[cm]?[jt]s$/u.test(name)
      || /\.(?:node|dylib|so|dll)$/u.test(name)) deny(`Unexpected Headless dependency: ${name}`);
    const file = physicalPath(path.join(ROOT, name));
    const fd = fs.openSync(file, 'r'), magic = Buffer.alloc(4);
    try { fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
    if ([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca, 0x7f454c46]
      .includes(magic.readUInt32BE(0)) || magic.subarray(0, 2).toString() === 'MZ') deny('Unexpected native Headless payload.');
  }
  // Next already produced and the builder already validated the standalone Web
  // closure. Retain only the exact Web entry/identity plus the shared SQLite
  // package used by the source Supervisor; retracing server.js sweeps optional
  // Next/Sharp platform branches and is neither closed nor minimal.
  const requireWeb = createRequire(path.join(layout.web, 'package.json'));
  const sqlite = physicalPath(requireWeb.resolve('better-sqlite3'));
  const sqlitePackage = physicalPath(path.dirname(requireWeb.resolve('better-sqlite3/package.json')), true);
  if (!sqlite.startsWith(`${sqlitePackage}${path.sep}`)
    || sqlitePackage !== path.join(layout.web, 'node_modules/better-sqlite3')) deny('SQLite escaped the app.');
  const required = ['server.js', 'package.json', '.next/BUILD_ID', 'mediflow-build-identity.json',
    'mediflow-runtime-contract.json'].map(name => `Resources/WebRuntime/${name}`);
  const shared = [...required,
    ...physicalFiles(sqlitePackage).map(name => `Resources/WebRuntime/node_modules/better-sqlite3/${name}`),
    'Frameworks/mediflow-web-better-sqlite3.node'];
  const identity = JSON.parse(fs.readFileSync(path.join(layout.web, 'mediflow-build-identity.json'), 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(layout.web, 'mediflow-runtime-contract.json'), 'utf8'));
  if (contract.schemaVersion !== 1 || contract.node?.major !== 24 || contract.node.version !== process.versions.node
    || contract.node.moduleVersion !== process.versions.modules || contract.platform !== process.platform
    || contract.arch !== process.arch) deny('WebRuntime and packaging Node do not match.');
  const node = { ...contract.node, platform: contract.platform, arch: contract.arch, ...physicalRecord(process.execPath) };
  const entries = [...new Set(shared)].sort().map(name => {
    if (!name.startsWith('Resources/WebRuntime/') && !name.startsWith('Frameworks/')) deny('Web trace escaped the existing runtime.');
    return { path: name, ...physicalRecord(path.join(layout.contents, name)) };
  });
  // All graph/ABI preflight completes before any Headless write.
  fs.mkdirSync(layout.runtime);
  const temporaryLauncher = `${layout.launcher}.${process.pid}.tmp`;
  try {
    for (const name of [...files].sort()) {
      const destination = name === 'scripts/register-strip-types-loader.mjs' ? 'scripts/headless-source-loader.mjs' : name;
      copyFile(path.join(ROOT, name), path.join(layout.runtime, destination));
    }
    fs.writeFileSync(path.join(layout.runtime, 'scripts/register-strip-types-loader.mjs'), WRAPPER, { flag: 'wx', mode: 0o644 });
    for (const name of physicalFiles(layout.runtime)) entries.push({ path: PREFIX + name, ...physicalRecord(path.join(layout.runtime, name)) });
    entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    const roster = `${JSON.stringify({ schemaVersion: 1, mode: 'mcp', node, identity, files: entries }, null, 2)}\n`;
    fs.writeFileSync(path.join(layout.runtime, 'headless-roster.json'), roster, { flag: 'wx', mode: 0o644 });
    const template = fs.readFileSync(path.join(ROOT, 'scripts/launch-bundled-headless-supervisor.mjs'), 'utf8');
    if (template.split(TOKEN).length !== 2) deny('Launcher roster commitment must occur exactly once.');
    fs.writeFileSync(temporaryLauncher, template.replace(TOKEN, sha256(roster)), { flag: 'wx', mode: 0o644 });
    appLayout(app, true); // Refuse a seal introduced while tracing/staging.
    fs.renameSync(temporaryLauncher, layout.launcher);
    await checkHeadlessRuntime(app);
  } catch (error) {
    // Never repair or remove anything after a concurrent outer seal.
    appLayout(app, true);
    fs.rmSync(layout.runtime, { recursive: true, force: true });
    fs.rmSync(temporaryLauncher, { force: true });
    throw error;
  }
}
export async function checkHeadlessRuntime(app) {
  const { launcher } = appLayout(app);
  physicalPath(launcher);
  const rosterFile = path.join(path.dirname(launcher), 'WebRuntime/HeadlessRuntime/headless-roster.json');
  physicalPath(rosterFile);
  const template = fs.readFileSync(path.join(ROOT, 'scripts/launch-bundled-headless-supervisor.mjs'), 'utf8');
  if (fs.readFileSync(launcher, 'utf8') !== template.replace(TOKEN, sha256(fs.readFileSync(rosterFile)))) {
    deny('Bundled launcher differs from the source template.');
  }
  const { verifyHeadlessBundle } = await import(pathToFileURL(launcher).href);
  verifyHeadlessBundle(); // read-only, also valid AFTER the outer seal
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, flag, app, ...rest] = process.argv.slice(2);
    if (!['--stage', '--check'].includes(mode) || flag !== '--app' || !app || rest.length) deny('Usage: stage-headless-runtime.mjs --stage|--check --app <physical.app>');
    if (mode === '--stage') await stageHeadlessRuntime(app); else await checkHeadlessRuntime(app);
  } catch (error) { process.stderr.write(`Headless delivery: ${error.message}\n`); process.exitCode = 1; }
}
