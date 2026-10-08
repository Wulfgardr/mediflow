import fs from 'node:fs';
import path from 'node:path';
import { load, JSON_SCHEMA } from 'js-yaml';

export const EXPLICIT_NPM_SUITES = Object.freeze([
  { script: 'test:launcher-helpers', workflow: '.github/workflows/cross-platform.yml', job: 'headless-contracts' },
  { script: 'test:native-launcher', workflow: '.github/workflows/cross-platform.yml', job: 'headless-contracts', stepIf: "runner.os == 'macOS'" },
  { script: 'test:usage-dashboard', workflow: '.github/workflows/openapi-contract-guard.yml', job: 'repository-guards' },
  { script: 'test:fabric-generative-runtime-crosswalk', workflow: '.github/workflows/openapi-contract-guard.yml', job: 'repository-guards' },
  { script: 'test:lume-tokens', workflow: '.github/workflows/web-core.yml', job: 'web-core' },
].map(suite => Object.freeze({ ...suite, id: `npm:${suite.script}` })));

function regularFile(root, relative) {
  const file = path.join(root, relative);
  if (!fs.lstatSync(file).isFile()) throw new Error(`Not a regular file: ${relative}`);
  const real = fs.realpathSync(file);
  if (!real.startsWith(fs.realpathSync(root) + path.sep)) throw new Error(`Path escapes root: ${relative}`);
  return real;
}

function readText(root, relative) {
  return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(regularFile(root, relative)));
}

/** Only the script body is modeled; no npm process, lifecycle hook or test is run. */
export function collectExplicitNpmNodeTests(root, scriptName) {
  const pkg = JSON.parse(readText(root, 'package.json'));
  const command = pkg.scripts?.[scriptName];
  if (typeof command !== 'string' || !/^node --test [^\r\n]+$/u.test(command)) {
    throw new Error(`Unsupported or missing node --test command: ${scriptName}`);
  }
  const files = command.slice('node --test '.length).split(/[ \t]+/u);
  const seen = new Set();
  const realPaths = new Set();
  for (const file of files) {
    // Closed literal grammar: no flags, traversal, expansion, quoting or shell.
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/u.test(file)) {
      throw new Error(`Unsupported literal test path: ${JSON.stringify(file)}`);
    }
    const real = regularFile(root, file);
    if (seen.has(file) || realPaths.has(real)) throw new Error(`Duplicate test path: ${file}`);
    seen.add(file); realPaths.add(real);
  }
  return files;
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function checkYamlTree(value, ancestors = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (ancestors.has(value)) throw new Error('Cyclic YAML aliases are unsupported');
  if (Object.hasOwn(value, '<<')) throw new Error('YAML merge keys are unsupported');
  const next = new Set(ancestors).add(value);
  for (const child of Object.values(value)) checkYamlTree(child, next);
}

function npmRunBlock(run, selfTestCall) {
  if (typeof run !== 'string') return null;
  const commands = [];
  for (const raw of run.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Only the declared self-test invocation may carry arguments. Other lines
    // retain the closed no-arguments grammar used by existing bindings.
    if (selfTestCall && line === `npm run ${selfTestCall}`) {
      commands.push(selfTestCall);
      continue;
    }
    const match = /^npm run ([A-Za-z0-9_][A-Za-z0-9:_-]*)$/u.exec(line);
    if (!match) return null;
    commands.push(match[1]);
  }
  return commands;
}

function condition(value, label) {
  if (value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'boolean') throw new Error(`Unsupported ${label}`);
  if (value === false || (typeof value === 'string' && /^(?:false|\$\{\{\s*false\s*\}\})$/u.test(value.trim()))) {
    throw new Error(`Disabled ${label}`);
  }
  return value;
}

function runDefaults(owner, label) {
  if (owner.defaults === undefined) return {};
  if (!object(owner.defaults) || (owner.defaults.run !== undefined && !object(owner.defaults.run))) {
    throw new Error(`Unsupported ${label} defaults`);
  }
  return owner.defaults.run ?? {};
}

function ciBinding(root, suite) {
  // JSON schema keeps booleans unambiguous and rejects custom executable tags.
  // js-yaml's default duplicate-key check stays enabled (json option is not used).
  const workflow = load(readText(root, suite.workflow), { schema: JSON_SCHEMA });
  checkYamlTree(workflow);
  const job = workflow?.jobs?.[suite.job];
  if (!object(workflow) || !object(job) || !Array.isArray(job.steps)) throw new Error(`Missing CI job: ${suite.job}`);
  const matches = [];
  const selfTestCall = suite.selfTest === true ? `${suite.script} -- --self-test` : null;
  const expectedCall = selfTestCall ?? suite.script;
  job.steps.forEach((step, index) => {
    if (!object(step)) return;
    const commands = npmRunBlock(step.run, selfTestCall);
    for (const command of commands ?? []) if (command === expectedCall) matches.push({ step, index, commands });
  });
  if (matches.length !== 1) throw new Error(`Expected exactly one literal CI call: ${expectedCall}; found ${matches.length}`);
  const { step, index, commands } = matches[0];
  if (step.uses !== undefined) throw new Error('CI binding cannot combine uses and run');
  for (const [label, owner] of [['job', job], ['step', step]]) {
    if (owner['continue-on-error'] !== undefined && owner['continue-on-error'] !== false) throw new Error(`Unsupported ${label} continue-on-error`);
  }
  const jobIf = condition(job.if, 'job if');
  const stepIf = condition(step.if, 'step if');
  if (suite.stepIf !== undefined && stepIf !== suite.stepIf) throw new Error(`Required platform condition changed: ${suite.script}`);
  const workflowDefaults = runDefaults(workflow, 'workflow');
  const jobDefaults = runDefaults(job, 'job');
  const effective = { ...workflowDefaults, ...jobDefaults, ...step };
  const directory = effective['working-directory'];
  if (directory !== undefined && directory !== '.' && directory !== './') throw new Error('CI binding must run at repository root');
  const shell = effective.shell;
  if (shell !== undefined && !['bash', 'sh', 'pwsh'].includes(shell)) throw new Error('Unsupported CI binding shell');
  return {
    workflow: suite.workflow, job: suite.job, stepIndex: index, stepName: step.name ?? null,
    run: step.run, commands, jobIf, stepIf, needs: job.needs ?? null,
    runsOn: job['runs-on'] ?? null, matrix: job.strategy?.matrix ?? null,
    workflowDefaults, jobDefaults, workingDirectory: directory ?? null, shell: shell ?? null,
    jobContinueOnError: job['continue-on-error'] ?? null, stepContinueOnError: step['continue-on-error'] ?? null,
  };
}

/** Verify a known runner entrypoint without launching npm or parsing its source. */
export function collectNpmScriptBinding(root, suite, expectedCommand) {
  const pkg = JSON.parse(readText(root, 'package.json'));
  if (pkg.scripts?.[suite.script] !== expectedCommand) {
    throw new Error(`Required npm command changed or missing: ${suite.script}`);
  }
  return ciBinding(root, suite);
}

/** Model the Claims guard's declared self-test entrypoint without importing it. */
export function collectClaimsSelfTestSelection(root) {
  const file = 'scripts/check-claims-guard.mjs';
  try {
    regularFile(root, file);
    const binding = collectNpmScriptBinding(root, {
      script: 'check:claims', workflow: '.github/workflows/openapi-contract-guard.yml',
      job: 'repository-guards', selfTest: true,
    }, `node ${file}`);
    return { files: [file], errors: [], binding };
  } catch (error) {
    return { files: [], errors: [error.message], binding: null };
  }
}

/** Required suites stay present with errors; invalid bindings never promote files. */
export function collectExplicitNpmSelections(root) {
  return Object.fromEntries(EXPLICIT_NPM_SUITES.map(suite => {
    try {
      const files = collectExplicitNpmNodeTests(root, suite.script);
      const binding = ciBinding(root, suite);
      return [suite.id, { files, errors: [], binding }];
    } catch (error) {
      return [suite.id, { files: [], errors: [error.message], binding: null }];
    }
  }));
}
