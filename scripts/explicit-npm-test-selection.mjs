import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { load, JSON_SCHEMA } from 'js-yaml';

export const EXPLICIT_NPM_SUITES = Object.freeze([
  { script: 'test:launcher-helpers', workflow: '.github/workflows/cross-platform.yml', job: 'headless-contracts' },
  { script: 'test:native-launcher', workflow: '.github/workflows/cross-platform.yml', job: 'headless-contracts', stepIf: "runner.os == 'macOS'" },
  { script: 'test:usage-dashboard', workflow: '.github/workflows/openapi-contract-guard.yml', job: 'repository-guards' },
  { script: 'test:fabric-generative-runtime-crosswalk', workflow: '.github/workflows/openapi-contract-guard.yml', job: 'repository-guards' },
  { script: 'test:anydoc-diagnostics', workflow: '.github/workflows/e2e.yml', job: 'e2e' },
  { script: 'test:lume-tokens', workflow: '.github/workflows/web-core.yml', job: 'web-core' },
].map(suite => Object.freeze({ ...suite, id: `npm:${suite.script}` })));

export const GUARD_SELF_TEST_SUITES = Object.freeze([
  { script: 'check:claims', file: 'scripts/check-claims-guard.mjs' },
  { script: 'check:schema-writers', file: 'scripts/check-schema-writers.mjs' },
  { script: 'check:ai-clinical-writes', file: 'scripts/check-ai-clinical-write-gate.mjs' },
  { script: 'check:api-error-leak', file: 'scripts/check-api-error-leak.mjs' },
  { script: 'check:openapi:drift', file: 'scripts/check-openapi-drift.mjs',
    companionCall: 'check:openapi:drift -- --base-ref origin/main' },
].map(suite => Object.freeze({ ...suite, id: `npm:${suite.script}:self-test`,
  workflow: '.github/workflows/openapi-contract-guard.yml', job: 'repository-guards', selfTest: true })));

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

function npmRunBlock(run, selfTestCall, companionCall) {
  if (typeof run !== 'string') return null;
  const commands = [];
  for (const raw of run.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Argument-bearing calls must match a declared literal. The OpenAPI scan
    // may accompany its self-test, but never satisfies the self-test binding.
    if (selfTestCall && line === `npm run ${selfTestCall}`) {
      commands.push(selfTestCall);
      continue;
    }
    if (companionCall && line === `npm run ${companionCall}`) {
      commands.push(companionCall);
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
  if (suite.triggers && !isDeepStrictEqual(workflow.on, suite.triggers)) throw new Error('Required CI triggers changed');
  const job = workflow?.jobs?.[suite.job];
  if (!object(workflow) || !object(job) || !Array.isArray(job.steps)) throw new Error(`Missing CI job: ${suite.job}`);
  const matches = [];
  const selfTestCall = suite.selfTest === true ? `${suite.script} -- --self-test` : null;
  const expectedCall = selfTestCall ?? suite.script;
  job.steps.forEach((step, index) => {
    if (!object(step)) return;
    const commands = suite.ciCall
      ? (typeof step.run === 'string' && step.run.trim() === suite.ciCall ? [suite.script] : null)
      : npmRunBlock(step.run, selfTestCall, suite.companionCall);
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
  if (suite.workingDirectory) {
    if (directory !== suite.workingDirectory) throw new Error('Required CI working directory changed');
  } else if (directory !== undefined && directory !== '.' && directory !== './') throw new Error('CI binding must run at repository root');
  const shell = effective.shell;
  if (shell !== undefined && !['bash', 'sh', 'pwsh'].includes(shell)) throw new Error('Unsupported CI binding shell');
  return {
    workflow: suite.workflow, triggers: workflow.on ?? null, job: suite.job, stepIndex: index, stepName: step.name ?? null,
    run: step.run, commands, jobIf, stepIf, needs: job.needs ?? null,
    runsOn: job['runs-on'] ?? null, matrix: job.strategy?.matrix ?? null,
    workflowDefaults, jobDefaults, workingDirectory: directory ?? null, shell: shell ?? null,
    jobContinueOnError: job['continue-on-error'] ?? null, stepContinueOnError: step['continue-on-error'] ?? null,
  };
}

/** Reuse the same closed YAML binding for a literal non-npm runner call. */
export function collectLiteralCiBinding(root, suite) {
  if (typeof suite.ciCall !== 'string' || !suite.ciCall.trim()) throw new Error('Literal CI call required');
  return ciBinding(root, suite);
}

/** Verify a known runner entrypoint without launching npm or parsing its source. */
export function collectNpmScriptBinding(root, suite, expectedCommand) {
  const pkg = JSON.parse(readText(root, suite.packageFile ?? 'package.json'));
  if (pkg.scripts?.[suite.script] !== expectedCommand) {
    throw new Error(`Required npm command changed or missing: ${suite.script}`);
  }
  return ciBinding(root, suite);
}

/** Only stat the guard and inspect its npm/CI binding; never import its source. */
function collectGuardSelfTestSelection(root, suite) {
  try {
    regularFile(root, suite.file);
    const binding = collectNpmScriptBinding(root, suite, `node ${suite.file}`);
    return { files: [suite.file], errors: [], binding };
  } catch (error) {
    return { files: [], errors: [error.message], binding: null };
  }
}

export function collectClaimsSelfTestSelection(root) {
  return collectGuardSelfTestSelection(root, GUARD_SELF_TEST_SUITES[0]);
}

export function collectGuardSelfTestSelections(root) {
  return Object.fromEntries(GUARD_SELF_TEST_SUITES.map(suite =>
    [suite.id, collectGuardSelfTestSelection(root, suite)]));
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


/** Closed model for the existing, path-conditional synthetic plugin workflow. */
export function collectSyntheticPluginSelections(root) {
  const directory = 'plugins/mediflow-synthetic';
  const workflow = '.github/workflows/synthetic-plugin.yml';
  const paths = [`${directory}/**`, 'packages/mcp/src/contracts.ts', workflow];
  const common = { workflow, job: 'synthetic-plugin', workingDirectory: directory,
    packageFile: `${directory}/package.json`,
    triggers: { pull_request: { paths }, push: { branches: ['main'], paths } } };
  return Object.fromEntries([
    { script: 'test', ciCall: 'npm test', command: 'node --test test/*.test.mjs' },
    { script: 'test:browser', ciCall: 'npm run test:browser', command: 'node scripts/browser-smoke.mjs' },
  ].map(suite => {
    const id = `npm:synthetic-plugin:${suite.script}`;
    try {
      const binding = collectNpmScriptBinding(root, { ...common, ...suite }, suite.command);
      let files;
      if (suite.script === 'test') {
        // Exactly the package's literal nonrecursive shell glob; hidden files
        // are not matched. No second roster and no test imports or execution.
        const group = `${directory}/test`;
        const real = fs.realpathSync(path.join(root, group));
        if (!real.startsWith(fs.realpathSync(root) + path.sep)) throw new Error('Plugin test group escapes root');
        files = fs.readdirSync(path.join(root, group)).filter(name => !name.startsWith('.') && name.endsWith('.test.mjs'))
          .sort().map(name => `${group}/${name}`);
        if (!files.length) throw new Error('Required synthetic plugin test group is empty');
      } else files = [`${directory}/scripts/browser-smoke.mjs`];
      for (const file of files) regularFile(root, file);
      return [id, { files, errors: [], binding, conditional: true }];
    } catch (error) {
      return [id, { files: [], errors: [error.message], binding: null, conditional: true }];
    }
  }));
}
