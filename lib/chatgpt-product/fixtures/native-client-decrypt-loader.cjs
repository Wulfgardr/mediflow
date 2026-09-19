/* @Codex — test-only, bounded-snapshot loader. Never imported by production. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../../..');
let ts;
try { ts = require(process.env.MEDIFLOW_TEST_TYPESCRIPT || 'typescript'); }
catch { throw Error('NOT_RUN: TypeScript is required; use the repository devDependency or MEDIFLOW_TEST_TYPESCRIPT pointing to its local module. No fetch is performed.'); }
function loader(stubs = new Map()) {
  const cache = new Map();
  const normalize = file => path.resolve(root, file).replace(/\.(ts|js|cjs)$/, '');
  const substitutions = new Map([...stubs].map(([key, value]) => [normalize(key), value]));
  function load(file) {
    const key = normalize(file);
    if (substitutions.has(key)) return substitutions.get(key);
    if (cache.has(key)) return cache.get(key).exports;
    const filename = [file, key + '.ts', key + '.cjs', key + '.js'].map(p => path.resolve(root, p)).find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!filename) throw Error('NOT_RUN: omitted snapshot dependency ' + path.relative(root, key));
    const module = { exports: {} }; cache.set(key, module);
    const source = fs.readFileSync(filename, 'utf8').replace(/import\.meta\.url/g, JSON.stringify(require('node:url').pathToFileURL(filename).href));
    const output = filename.endsWith('.ts') ? ts.transpileModule(source, { fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText : source;
    const localRequire = request => {
      if (request === 'server-only') return {};
      if (request.startsWith('.') || request.startsWith('@/')) return load(request.startsWith('@/') ? path.join(root, request.slice(2)) : path.resolve(path.dirname(filename), request));
      if (stubs.has(request)) return stubs.get(request);
      if (Module.isBuiltin(request)) return require(request);
      throw Error('NOT_RUN: unavailable external dependency ' + request);
    };
    new Function('require', 'module', 'exports', '__filename', '__dirname', output)(localRequire, module, module.exports, filename, path.dirname(filename));
    return module.exports;
  }
  return { load, root, ts };
}
module.exports = { loader, root, ts };
