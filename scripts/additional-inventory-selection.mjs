import fs from 'node:fs';
import path from 'node:path';
import { collectChatgptFocusedTests, SOAP_CHILD_FILES, soapChildArguments, PROTOTYPE_TEST_FILES, SOFT_DELETE_TS_FILES, SOFT_DELETE_ROUTE_FILES, UI06_DOMAIN_FILES } from './additional-test-selection.mjs';
import { collectNpmScriptBinding, collectLiteralCiBinding } from './explicit-npm-test-selection.mjs';
import { CLINICAL_HTTP_TEST_FILES } from './run-clinical-http-suite.mjs';

const browserCall = 'CHATGPT_PRODUCT_DATA_DIR="$(mktemp -d "${RUNNER_TEMP}/mediflow-chatgpt-product.XXXXXX")"\nMEDIFLOW_DATA_DIR="${CHATGPT_PRODUCT_DATA_DIR}" \\\n  node scripts/chatgpt-product-focused-tests.mjs --browser-only';
// Bounded lexical matching: comments disappear, quoted strings/templates stay
// indivisible tokens. A code-shaped decoy inside a literal cannot supply a call.
export function consumerTokens(source) {
  return (source.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[A-Za-z_$][\w$]*|[0-9]+|[^\s]/gu) ?? [])
    .filter(token => !token.startsWith('//') && !token.startsWith('/*'));
}
function source(root, file, fragments) {
  filesExist(root, [file, 'scripts/additional-test-selection.mjs']);
  const tokens = consumerTokens(fs.readFileSync(path.join(root, file), 'utf8'));
  for (const fragment of fragments) {
    const expected = consumerTokens(fragment);
    let count = 0;
    for (let i = 0; i <= tokens.length - expected.length; i++) {
      if (expected.every((token, offset) => tokens[i + offset] === token)) count++;
    }
    if (count !== 1) throw new Error(`Missing or duplicate consumer binding: ${file}: ${fragment}`);
  }
}
function filesExist(root, files) {
  if (!files.length || new Set(files).size !== files.length) throw new Error('Empty or duplicate additional selection');
  for (const file of files) if (!fs.lstatSync(path.join(root, file)).isFile()
    || !fs.realpathSync(path.join(root, file)).startsWith(fs.realpathSync(root) + path.sep)) throw new Error(`Invalid selected file: ${file}`);
  return [...files];
}
export function collectAdditionalInventorySelections(root) {
  // Synthetic CLI fixtures without these consumers retain the original contract.
  const out = {};
  function add(id, mode, consumer, collect) {
    if (!fs.existsSync(path.join(root, consumer))) return;
    try { const value = collect(); out[id] = { ...value, files: filesExist(root, value.files), errors: [], mode, conditional: mode === 'conditional' }; }
    catch (error) { out[id] = { files: [], errors: [error.message], mode }; }
  }
  add('npm:test:clinical-http', 'ordinary', 'scripts/run-clinical-http-suite.mjs', () => ({
    files: CLINICAL_HTTP_TEST_FILES,
    binding: collectNpmScriptBinding(root, { script: 'test:clinical-http', workflow: '.github/workflows/web-core.yml', job: 'web-core' }, 'node scripts/run-clinical-http-suite.mjs'),
  }));
  const chatgpt = () => source(root, 'scripts/chatgpt-product-focused-tests.mjs', [
    "import { collectChatgptFocusedTests } from './additional-test-selection.mjs';",
    "const tests = collectChatgptFocusedTests(root, { browserOnly, browser: args.includes('--browser'), loopbackProxy: args.includes('--loopback-proxy') });",
    "const command = [join(root, 'scripts/run-strip-types.mjs'), '--test', '--test-concurrency=1', ...tests];",
    '? runNodeWithQuarantine(command, options)', ': spawnSync(process.execPath, command, options)',
  ]);
  add('chatgpt:browser', 'ordinary', 'scripts/chatgpt-product-focused-tests.mjs', () => {
    chatgpt(); return { files: collectChatgptFocusedTests(root, { browserOnly: true }), binding: collectLiteralCiBinding(root, { workflow: '.github/workflows/e2e.yml', job: 'e2e', ciCall: browserCall }) };
  });
  add('chatgpt:local', 'local', 'scripts/chatgpt-product-focused-tests.mjs', () => {
    chatgpt(); return { files: collectChatgptFocusedTests(root), binding: { command: 'node scripts/chatgpt-product-focused-tests.mjs', prerequisites: 'Explicit fresh synthetic data, exact installed owner; no live provider or OS qualification.' } };
  });
  for (const item of [
    ['prototype:local', 'scripts/check-09x-prototypes.mjs', 'PROTOTYPE_TEST_FILES', 'tests', PROTOTYPE_TEST_FILES, "spawnSync(process.execPath, ['--test', ...tests],"],
    ['soft-delete:local', 'scripts/run-patient-soft-delete-suite.mjs', 'SOFT_DELETE_ROUTE_FILES', 'routeWiringTests', [...SOFT_DELETE_TS_FILES, ...SOFT_DELETE_ROUTE_FILES], "run(['--test', ...routeWiringTests], env)"],
    ['ui06:domain:local', 'tests/ui06/run-domain-tests.mjs', 'UI06_DOMAIN_FILES', 'entries', UI06_DOMAIN_FILES, "spawnSync(process.execPath, ['--test', ...entries.map(file => path.join(temporary, file.replace(/\\.ts$/, '.js')))],"],
  ]) {
    const [id, consumer, symbol, variable, files, call] = item;
    add(id, 'local', consumer, () => {
      const selectorModule = consumer.startsWith('scripts/') ? './additional-test-selection.mjs' : '../../scripts/additional-test-selection.mjs';
      source(root, consumer, [`import { ${symbol} } from '${selectorModule}';`, `const ${variable} = ${symbol};`, call]);
      if (id === 'soft-delete:local') source(root, consumer, ["import { SOFT_DELETE_TS_FILES } from './additional-test-selection.mjs';", 'const typeScriptTests = SOFT_DELETE_TS_FILES;', "run(['scripts/run-strip-types.mjs', '--test', ...typeScriptTests], env)"]);
      return { files, binding: { command: `node ${consumer}`, prerequisites: id.startsWith('prototype:') ? 'Synthetic research suite; not release qualification.' : 'Existing owned synthetic fixture/bootstrap and loader retained.' } };
    });
  }
  const parent = 'lib/security/headless-soap-active-role-session-grant.test.ts';
  add('soap:child', 'child', parent, () => {
    source(root, parent, ["import { soapChildArguments } from '../../scripts/additional-test-selection.mjs';"]);
    for (const kind of Object.keys(SOAP_CHILD_FILES)) source(root, parent, [
      `    const result = spawnSync(process.execPath, soapChildArguments('${kind}'), { cwd: process.cwd(), encoding: 'utf8' });\n    assert.equal(result.status, 0, ` + '`${result.stdout}\\n${result.stderr}`);',
    ]);
    return { files: Object.keys(SOAP_CHILD_FILES).map(kind => soapChildArguments(kind)[1]), binding: { consumer: parent, invocationVerified: true, command: 'Parent spawnSync with shared argv and exit status assertion' } };
  });
  return out;
}
