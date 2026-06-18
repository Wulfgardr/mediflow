/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REQUIRED_LOOP_IDS = [
  'orchestrator',
  'maintainer',
  'forward-thinker',
  'docs-claims',
  'risk-compliance',
  'loop-auditor',
  'loop-gardener'
];

const DEFAULT_CONFIG_PATH = path.resolve('docs/loop-orchestrator.config.json');

export function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

export function validateConfig(config) {
  const errors = [];

  if (config.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }

  if (config.project?.id !== 'mediflow') {
    errors.push('project.id must be mediflow');
  }

  if (config.project?.sensitivity !== 'clinical-high') {
    errors.push('project.sensitivity must be clinical-high');
  }

  if (config.costPolicy?.continuousModelCalls !== false) {
    errors.push('costPolicy.continuousModelCalls must be false');
  }

  if (!Array.isArray(config.loops) || config.loops.length === 0) {
    errors.push('loops must be a non-empty array');
    return errors;
  }

  const seen = new Set();
  for (const loop of config.loops) {
    if (!loop.id) errors.push('each loop needs an id');
    if (seen.has(loop.id)) errors.push(`duplicate loop id: ${loop.id}`);
    seen.add(loop.id);

    if (!['core', 'meta'].includes(loop.kind)) {
      errors.push(`${loop.id}: kind must be core or meta`);
    }
    if (!loop.cadence?.mode || !loop.cadence?.frequency) {
      errors.push(`${loop.id}: cadence.mode and cadence.frequency are required`);
    }
    if (!Array.isArray(loop.permissions) || loop.permissions.length === 0) {
      errors.push(`${loop.id}: permissions must be non-empty`);
    }
    if (!Array.isArray(loop.outputs) || loop.outputs.length === 0) {
      errors.push(`${loop.id}: outputs must be non-empty`);
    }
    if (!Array.isArray(loop.hardStops) || loop.hardStops.length === 0) {
      errors.push(`${loop.id}: hardStops must be non-empty`);
    }
  }

  for (const requiredId of REQUIRED_LOOP_IDS) {
    if (!seen.has(requiredId)) errors.push(`missing required loop: ${requiredId}`);
  }

  const byId = new Map(config.loops.map((loop) => [loop.id, loop]));
  if (byId.get('maintainer')?.cadence?.frequency !== 'daily') {
    errors.push('maintainer must run daily');
  }
  if (byId.get('forward-thinker')?.cadence?.frequency !== 'weekly') {
    errors.push('forward-thinker must run weekly');
  }
  if (byId.get('loop-auditor')?.cadence?.frequency !== 'weekly') {
    errors.push('loop-auditor must run weekly');
  }
  if (byId.get('loop-gardener')?.cadence?.frequency !== 'weekly') {
    errors.push('loop-gardener must run weekly');
  }

  const automergeRequires = config.guardedAutomerge?.requires ?? [];
  if (!config.guardedAutomerge?.enabled) {
    errors.push('guardedAutomerge.enabled must be true');
  }
  if (!automergeRequires.includes('No PHI/PII used')) {
    errors.push('guardedAutomerge.requires must include "No PHI/PII used"');
  }
  if (!Array.isArray(config.guardedAutomerge?.hardStopPaths) || config.guardedAutomerge.hardStopPaths.length === 0) {
    errors.push('guardedAutomerge.hardStopPaths must be non-empty');
  }

  return errors;
}

export function buildPlan(config) {
  const lines = [
    `Loop Orchestrator plan for ${config.project.id} (${config.project.sensitivity})`,
    `Linear: ${config.linearIssue}`,
    `Cost policy: ${config.costPolicy.mode}; continuous model calls: ${String(config.costPolicy.continuousModelCalls)}`,
    '',
    'Loops:'
  ];

  for (const loop of config.loops) {
    const cadence = [
      loop.cadence.frequency,
      loop.cadence.day,
      loop.cadence.timeLocal
    ].filter(Boolean).join(' ');
    lines.push(`- ${loop.id} [${loop.kind}]: ${cadence || loop.cadence.mode}`);
  }

  lines.push('', 'Guarded automerge hard stops:');
  for (const hardStop of config.guardedAutomerge.hardStopPaths) {
    lines.push(`- ${hardStop}`);
  }

  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const command = argv[2] ?? 'validate';
  const json = argv.includes('--json');
  const configIndex = argv.indexOf('--config');
  const configPath = configIndex === -1 ? DEFAULT_CONFIG_PATH : path.resolve(argv[configIndex + 1]);
  return { command, json, configPath };
}

export function run(argv = process.argv, stdout = process.stdout, stderr = process.stderr) {
  const { command, json, configPath } = parseArgs(argv);
  const config = loadConfig(configPath);
  const errors = validateConfig(config);

  if (command === 'validate') {
    if (json) {
      stdout.write(`${JSON.stringify({ ok: errors.length === 0, errors }, null, 2)}\n`);
    } else if (errors.length === 0) {
      stdout.write('Loop orchestrator config: ok\n');
    } else {
      stderr.write(`Loop orchestrator config failed:\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
    }
    return errors.length === 0 ? 0 : 1;
  }

  if (command === 'plan') {
    if (errors.length > 0) {
      stderr.write(`Cannot build plan from invalid config:\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
      return 1;
    }
    if (json) {
      stdout.write(`${JSON.stringify({ ok: true, loops: config.loops.map((loop) => ({ id: loop.id, kind: loop.kind, cadence: loop.cadence })) }, null, 2)}\n`);
    } else {
      stdout.write(buildPlan(config));
    }
    return 0;
  }

  stderr.write(`Unknown command: ${command}\n`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = run();
}
