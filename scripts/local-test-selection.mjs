import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const kinds = new Set(['node-test', 'strip-test', 'mac-login', 'bash', 'python']);
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
      || Object.keys(recipe).some(key => !['id', 'mode', 'kind', 'files', 'prerequisites'].includes(key))) throw new Error('Invalid local recipe');
    ids.add(recipe.id);
    for (const file of recipe.files) regular(root, file);
    let executable = process.execPath;
    let args;
    if (recipe.kind === 'node-test') args = ['--test', ...recipe.files];
    if (recipe.kind === 'strip-test') { regular(root, 'scripts/run-strip-types.mjs'); args = ['scripts/run-strip-types.mjs', '--test', ...recipe.files]; }
    if (recipe.kind === 'mac-login') {
      if (recipe.files.length !== 1 || recipe.files[0] !== 'lib/chatgpt-execution/execution-mac-login-integration.test.mjs') throw new Error('Invalid mac-login recipe');
      regular(root, 'lib/chatgpt-execution/fixtures/mac-login-loader.mjs');
      args = ['--experimental-vm-modules', '--import', './lib/chatgpt-execution/fixtures/mac-login-loader.mjs', '--test', ...recipe.files];
    }
    if (recipe.kind === 'bash' || recipe.kind === 'python') {
      if (recipe.files.length !== 1 || !recipe.files[0].endsWith(recipe.kind === 'bash' ? '.sh' : '.py')) throw new Error('Invalid script recipe');
      executable = recipe.kind === 'bash' ? 'bash' : 'python3'; args = [...recipe.files];
    }
    return { ...recipe, executable, args };
  });
}
export function collectLocalTestSelections(root) {
  // An absent registry is allowed for small synthetic inventory fixtures. A mapped
  // local entry still fails UNKNOWN_SUITE; deleting the real registry never waives it.
  if (!fs.existsSync(path.join(root, 'scripts/local-test-recipes.json'))) return {};
  try { return Object.fromEntries(localTestCommands(root).map(command => ['local:' + command.id,
    { files: command.files, errors: [], mode: 'local', binding: { command: ['node', 'scripts/local-test-selection.mjs', command.id], prerequisites: command.prerequisites } }])); }
  catch (error) { return { 'local:invalid': { files: [], errors: [error.message], mode: 'local' } }; }
}
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/local-test-selection.mjs <recipe-id>');
    const command = localTestCommands(root).find(item => item.id === process.argv[2]);
    if (!command) throw new Error('Unknown local recipe');
    console.log(`Local selection only: ${command.prerequisites}`);
    const result = spawnSync(command.executable, command.args, { cwd: root, stdio: 'inherit', shell: false,
      env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` } });
    if (result.error) throw result.error;
    process.exitCode = result.signal ? 1 : result.status ?? 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
