import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const kinds = new Set(['node-test', 'strip-test', 'mac-login', 'bash', 'python', 'network-write', 'network-fixed', 'wrapped-node', 'strip-serial', 'node-self', 'strip-self', 'bash-self', 'node-script', 'strip-script', 'node-parameters', 'rust-compare']);
const relative = value => typeof value === 'string' && /^[\w./-]+$/u.test(value)
  && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
function regular(root, file) {
  if (!relative(file) || !fs.lstatSync(path.join(root, file)).isFile()
    || !fs.realpathSync(path.join(root, file)).startsWith(fs.realpathSync(root) + path.sep)) throw new Error(`Invalid local test path: ${file}`);
}
export function localTestCommands(root) {
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'scripts/local-test-recipes.json'), 'utf8'));
  if (registry.version !== 1 || !Array.isArray(registry.recipes) || !registry.recipes.length
    || Object.keys(registry).some(key => !['version', 'recipes'].includes(key))) throw new Error('Invalid local recipe registry');
  const ids = new Set();
  return registry.recipes.map(recipe => {
    if (!recipe || typeof recipe.id !== 'string' || !recipe.id || ids.has(recipe.id)
      || recipe.mode !== 'local' || !kinds.has(recipe.kind)
      || typeof recipe.prerequisites !== 'string' || !recipe.prerequisites.trim()
      || !Array.isArray(recipe.files) || !recipe.files.length || new Set(recipe.files).size !== recipe.files.length
      || Object.keys(recipe).some(key => !['id', 'mode', 'kind', 'files', 'prerequisites', 'parameters'].includes(key))) throw new Error('Invalid local recipe');
    if (['node-parameters', 'rust-compare'].includes(recipe.kind)) {
      if (!Array.isArray(recipe.parameters) || !recipe.parameters.length
        || recipe.parameters.some(key => typeof key !== 'string' || !/^(?:--)?[a-z][a-z-]*$/u.test(key))
        || new Set(recipe.parameters).size !== recipe.parameters.length) throw new Error('Invalid local parameters');
    } else if (recipe.parameters !== undefined) throw new Error('Unexpected local parameters');
    ids.add(recipe.id);
    for (const file of recipe.files) regular(root, file);
    let executable = process.execPath;
    let args;
    let env = {};
    if (['node-parameters', 'rust-compare'].includes(recipe.kind)) {
      if (recipe.files.length !== 1) throw new Error('Parameterized command requires one entrypoint');
      args = recipe.kind === 'rust-compare' ? ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', recipe.files[0]] : [...recipe.files];
    }
    if (recipe.kind === 'node-test') args = ['--test', ...recipe.files];
    if (recipe.kind === 'strip-test') { regular(root, 'scripts/run-strip-types.mjs'); args = ['scripts/run-strip-types.mjs', '--test', ...recipe.files]; }
    if (['strip-serial', 'node-self', 'strip-self', 'bash-self', 'node-script', 'strip-script'].includes(recipe.kind)) {
      if (recipe.files.length !== 1) throw new Error('Script mode requires one file');
      const file = recipe.files[0];
      if (recipe.kind.startsWith('strip-')) regular(root, 'scripts/run-strip-types.mjs');
      const self = ['--', 'self-test'].join('');
      if (recipe.kind === 'strip-serial') args = ['scripts/run-strip-types.mjs', '--test', '--test-concurrency=1', file];
      if (recipe.kind === 'node-self') args = [file, self];
      if (recipe.kind === 'strip-self') args = ['scripts/run-strip-types.mjs', file, self];
      if (recipe.kind === 'bash-self') { if (!file.endsWith('.sh')) throw new Error('Invalid bash self test'); executable = 'bash'; args = [file, self]; }
      if (recipe.kind === 'node-script') args = [file];
      if (recipe.kind === 'strip-script') args = ['scripts/run-strip-types.mjs', file];
    }
    if (recipe.kind === 'mac-login') {
      if (recipe.files.length !== 1 || recipe.files[0] !== 'lib/chatgpt-execution/execution-mac-login-integration.test.mjs') throw new Error('Invalid mac-login recipe');
      regular(root, 'lib/chatgpt-execution/fixtures/mac-login-loader.mjs');
      args = ['--experimental-vm-modules', '--import', './lib/chatgpt-execution/fixtures/mac-login-loader.mjs', '--test', ...recipe.files];
    }
    if (recipe.kind === 'bash' || recipe.kind === 'python') {
      if (recipe.files.length !== 1 || !recipe.files[0].endsWith(recipe.kind === 'bash' ? '.sh' : '.py')) throw new Error('Invalid script recipe');
      executable = recipe.kind === 'bash' ? 'bash' : 'python3'; args = [...recipe.files];
    }
    if (['network-write', 'network-fixed', 'wrapped-node'].includes(recipe.kind)) {
      if (recipe.files.length !== 1) throw new Error('Wrapper requires one test');
      const file = recipe.files[0];
      let wrapper;
      if (recipe.kind === 'network-write') {
        if (!/^scripts\/network-home-base-[a-z-]+\.test\.mjs$/u.test(file)) throw new Error('Invalid network test');
        wrapper = 'scripts/network-home-base-write-smoke.sh';
        env = { MEDIFLOW_NETWORK_WRITE_TEST_SCRIPT: file, ...(file.endsWith('documents-write.test.mjs') ? { MEDIFLOW_ATTACHMENT_MAX_BYTES: '1024' } : {}) };
      } else if (recipe.kind === 'network-fixed') {
        if (!/^scripts\/network-home-base-(?:readonly|catalog-read)\.test\.mjs$/u.test(file)) throw new Error('Invalid fixed network test');
        wrapper = file.replace('.test.mjs', '-smoke.sh');
      } else {
        if (!['scripts/api-v1-put-negative-routes.test.mjs', 'scripts/legacy-clinical-writes.test.mjs', 'scripts/patient-concurrency.test.mjs'].includes(file)) throw new Error('Invalid wrapped test');
        wrapper = file === 'scripts/patient-concurrency.test.mjs' ? 'scripts/patient-concurrency-smoke.sh' : file.replace('.test.mjs', '-test.sh');
      }
      regular(root, wrapper);
      const body = fs.readFileSync(path.join(root, wrapper), 'utf8');
      const call = recipe.kind === 'network-write' ? 'node --test --test-concurrency=1 "$TEST_SCRIPT"' : `node --test --test-concurrency=1 ${file}`;
      if (body.split('\n').filter(line => line === call).length !== 1) throw new Error('Wrapper invocation changed');
      if (recipe.kind === 'network-write' && !body.split('\n').includes('TEST_SCRIPT="${MEDIFLOW_NETWORK_WRITE_TEST_SCRIPT:-scripts/network-home-base-write.test.mjs}"')) throw new Error('Wrapper selector changed');
      executable = 'bash'; args = [wrapper];
    }
    return { ...recipe, executable, args, env };
  });
}
export function collectLocalTestSelections(root) {
  // An absent registry is allowed for small synthetic inventory fixtures. A mapped
  // local entry still fails UNKNOWN_SUITE; deleting the real registry never waives it.
  if (!fs.existsSync(path.join(root, 'scripts/local-test-recipes.json'))) return {};
  try { return Object.fromEntries(localTestCommands(root).map(command => ['local:' + command.id,
    { files: command.files, errors: [], mode: 'local', binding: { command: ['node', 'scripts/local-test-selection.mjs', command.id], parameters: command.parameters ?? [], prerequisites: command.prerequisites } }])); }
  catch (error) { return { 'local:invalid': { files: [], errors: [error.message], mode: 'local' } }; }
}
export function localInvocationArguments(command, values) {
  const parameters = command.parameters ?? [];
  if (values.length !== parameters.length || values.some(value => typeof value !== 'string' || !value || value.startsWith('-') || /[\u0000-\u001f\u007f]/u.test(value))) throw new Error('Supply exactly the required local parameter values');
  return [...command.args, ...parameters.flatMap((key, index) => key.startsWith('--') ? [key, values[index]] : [values[index]])];
}
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length < 3) throw new Error('Usage: node scripts/local-test-selection.mjs <recipe-id> [required parameter values in registry order]');
    const command = localTestCommands(root).find(item => item.id === process.argv[2]);
    if (!command) throw new Error('Unknown local recipe');
    console.log(`Local selection only: ${command.prerequisites}`);
    const result = spawnSync(command.executable, localInvocationArguments(command, process.argv.slice(3)), { cwd: root, stdio: 'inherit', shell: false,
      env: { ...process.env, ...command.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` } });
    if (result.error) throw result.error;
    process.exitCode = result.signal ? 1 : result.status ?? 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
