/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
const LAUNCH_AGENT_LABEL = 'com.mediflow.loop-orchestrator';
const TOOL_VERSION = 2;

function defaultStateDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow', 'loop-orchestrator');
  }
  return path.join(os.homedir(), '.mediflow', 'loop-orchestrator');
}

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

function ensureStateDir(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function statePath(stateDir) {
  return path.join(stateDir, 'state.json');
}

function digestPath(stateDir) {
  return path.join(stateDir, 'latest-digest.md');
}

function runsPath(stateDir) {
  return path.join(stateDir, 'runs.jsonl');
}

function lockPath(stateDir) {
  return path.join(stateDir, 'runner.lock');
}

function acquireLock(stateDir) {
  ensureStateDir(stateDir);
  const lockFile = lockPath(stateDir);
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    return () => {
      fs.closeSync(fd);
      fs.rmSync(lockFile, { force: true });
    };
  } catch {
    return null;
  }
}

function getLocalParts(date = new Date(), timezone = 'Europe/Rome') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localMinuteOfDay(parts) {
  return (Number(parts.hour) * 60) + Number(parts.minute);
}

function parseTimeLocal(value) {
  const match = String(value || '00:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function sameLocalDay(firstIso, now, timezone) {
  if (!firstIso) return false;
  const first = getLocalParts(new Date(firstIso), timezone);
  const second = getLocalParts(now, timezone);
  return first.year === second.year && first.month === second.month && first.day === second.day;
}

function sameLocalWeek(firstIso, now, timezone) {
  if (!firstIso) return false;
  const firstDate = new Date(firstIso);
  const ageMs = now.getTime() - firstDate.getTime();
  if (ageMs < 0 || ageMs >= 7 * 24 * 60 * 60 * 1000) return false;
  const first = getLocalParts(firstDate, timezone);
  const second = getLocalParts(now, timezone);
  return first.weekday === second.weekday ? sameLocalDay(firstIso, now, timezone) : true;
}

function sameFortnight(firstIso, now) {
  if (!firstIso) return false;
  const ageMs = now.getTime() - new Date(firstIso).getTime();
  return ageMs >= 0 && ageMs < 14 * 24 * 60 * 60 * 1000;
}

export function isLoopDue(loop, state, now = new Date()) {
  const lastRunAt = state.loops?.[loop.id]?.lastRunAt;
  const timezone = loop.cadence?.timezone || 'Europe/Rome';
  const parts = getLocalParts(now, timezone);
  const currentMinute = localMinuteOfDay(parts);
  const targetMinute = parseTimeLocal(loop.cadence?.timeLocal);

  if (loop.id === 'orchestrator') return true;
  if (!lastRunAt) return currentMinute >= targetMinute;

  if (loop.cadence.frequency === 'daily') {
    return !sameLocalDay(lastRunAt, now, timezone) && currentMinute >= targetMinute;
  }
  if (loop.cadence.frequency === 'weekly') {
    return parts.weekday === loop.cadence.day && !sameLocalWeek(lastRunAt, now, timezone) && currentMinute >= targetMinute;
  }
  if (loop.cadence.frequency === 'fortnightly') {
    return parts.weekday === loop.cadence.day && !sameFortnight(lastRunAt, now) && currentMinute >= targetMinute;
  }
  return false;
}

function tail(value, maxLength = 2400) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return text.slice(text.length - maxLength);
}

function parseTrailingJson(stdout) {
  const text = String(stdout || '');
  const jsonStart = text.lastIndexOf('\n{');
  const candidate = jsonStart === -1 ? text.trim() : text.slice(jsonStart + 1).trim();
  if (!candidate.startsWith('{')) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function runShellCheck(command, repoRoot) {
  const startedAt = new Date();
  const env = {
    ...process.env,
    PATH: [
      path.dirname(process.execPath),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      process.env.PATH || ''
    ].filter(Boolean).join(':')
  };
  const result = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    encoding: 'utf8',
    env,
    timeout: 10 * 60 * 1000,
    maxBuffer: 1024 * 1024
  });
  const parsedJson = parseTrailingJson(result.stdout);
  const monitorDecision = parsedJson?.decision?.status;
  const status = result.status !== 0 || ['needs_codex', 'blocked'].includes(monitorDecision)
    ? 'fail'
    : 'pass';
  return {
    command,
    status,
    exitCode: result.status,
    signal: result.signal,
    decisionStatus: monitorDecision || null,
    durationMs: new Date().getTime() - startedAt.getTime(),
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr)
  };
}

function runLoop(loop, options) {
  const checks = [];
  if (Array.isArray(loop.checks) && loop.checks.length > 0) {
    for (const command of loop.checks) {
      checks.push(runShellCheck(command, options.repo));
    }
  }

  return {
    id: loop.id,
    kind: loop.kind,
    status: checks.some((check) => check.status === 'fail') ? 'needs_attention' : 'complete',
    ranAt: new Date().toISOString(),
    checks,
    outputs: loop.outputs,
    hardStops: loop.hardStops,
    note: checks.length > 0
      ? 'Executed declared deterministic checks.'
      : 'Recorded as due; strategic/delegate work requires a curated packet before expensive reasoning.'
  };
}

export function runScheduledOnce(config, options = {}) {
  const stateDir = options.stateDir || defaultStateDir();
  const repo = path.resolve(options.repo || process.cwd());
  const now = options.now || new Date();
  const force = Boolean(options.force);
  ensureStateDir(stateDir);

  const releaseLock = acquireLock(stateDir);
  if (!releaseLock) {
    return {
      version: TOOL_VERSION,
      generatedAt: now.toISOString(),
      repo,
      stateDir,
      status: 'skipped',
      reason: 'another loop-orchestrator run is active',
      dueLoops: [],
      loopResults: []
    };
  }

  try {
    const previousState = readJsonFile(statePath(stateDir), { version: TOOL_VERSION, loops: {} });
    const dueLoops = config.loops.filter((loop) => force || isLoopDue(loop, previousState, now));
    const loopResults = dueLoops.map((loop) => runLoop(loop, { repo, stateDir }));
    const nextState = {
      version: TOOL_VERSION,
      updatedAt: new Date().toISOString(),
      repo,
      configPath: options.configPath || DEFAULT_CONFIG_PATH,
      privacyBoundary: {
        diffContentRead: false,
        clinicalDatabaseRead: false,
        mailRead: false,
        privateDocContentRead: false,
        continuousModelCalls: false
      },
      loops: { ...(previousState.loops || {}) }
    };

    for (const result of loopResults) {
      nextState.loops[result.id] = {
        lastRunAt: result.ranAt,
        lastStatus: result.status,
        lastCheckCount: result.checks.length
      };
    }

    const summary = {
      version: TOOL_VERSION,
      generatedAt: new Date().toISOString(),
      repo,
      stateDir,
      status: loopResults.some((result) => result.status === 'needs_attention') ? 'needs_attention' : 'ok',
      dueLoops: dueLoops.map((loop) => loop.id),
      loopResults,
      nextDueHint: 'launchd wakes the runner frequently; each loop self-throttles from the manifest cadence.'
    };

    writeJsonFile(statePath(stateDir), nextState);
    fs.appendFileSync(runsPath(stateDir), `${JSON.stringify(summary)}\n`, 'utf8');
    fs.writeFileSync(digestPath(stateDir), renderRunDigest(summary), 'utf8');
    return summary;
  } finally {
    releaseLock();
  }
}

function renderRunDigest(summary) {
  const lines = [
    '# MediFlow Loop Orchestrator Digest',
    '',
    `Generated: ${summary.generatedAt}`,
    `Repo: ${summary.repo}`,
    `State dir: ${summary.stateDir}`,
    `Status: ${summary.status}`,
    '',
    'Due loops:',
    ...summary.dueLoops.map((id) => `- ${id}`),
    ''
  ];

  for (const result of summary.loopResults) {
    lines.push(`## ${result.id}`, '', `Status: ${result.status}`, result.note, '');
    for (const check of result.checks) {
      lines.push(`- ${check.status}: ${check.command} (${check.durationMs}ms)`);
    }
    lines.push('');
  }

  lines.push('Privacy: no PHI/PII, no clinical DB, no mail, no private doc content, no continuous model calls.', '');
  return lines.join('\n');
}

export function readStatus(stateDir = defaultStateDir()) {
  return {
    stateDir,
    state: readJsonFile(statePath(stateDir), null),
    latestDigestPath: digestPath(stateDir),
    latestDigestExists: fs.existsSync(digestPath(stateDir)),
    launchAgentPath: launchAgentPath(),
    launchAgentInstalled: fs.existsSync(launchAgentPath())
  };
}

function launchAgentPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

function globalRunnerPath(stateDir) {
  return path.join(stateDir, 'bin', 'loop-orchestrator.mjs');
}

function globalConfigPath(stateDir) {
  return path.join(stateDir, 'config', 'loop-orchestrator.config.json');
}

function escapePlist(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function buildLaunchAgentPlist(options) {
  const scriptPath = options.runnerPath || fileURLToPath(import.meta.url);
  const configPath = options.installedConfigPath || options.configPath || DEFAULT_CONFIG_PATH;
  const args = [
    process.execPath,
    path.resolve(scriptPath),
    'run-once',
    '--repo',
    path.resolve(options.repo),
    '--state-dir',
    options.stateDir,
    '--config',
    path.resolve(configPath),
    '--attention-exit-zero',
    '--quiet'
  ];

  const arrayItems = args.map((arg) => `    <string>${escapePlist(arg)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${arrayItems}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${options.launchIntervalSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${escapePlist(path.join(options.stateDir, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapePlist(path.join(options.stateDir, 'launchd.err.log'))}</string>
</dict>
</plist>
`;
}

function runLaunchctl(args) {
  return spawnSync('launchctl', args, { encoding: 'utf8' });
}

function installGlobalRunner(options) {
  if (process.platform !== 'darwin') {
    throw new Error('launchd install is available only on macOS');
  }
  ensureStateDir(options.stateDir);
  const runnerPath = globalRunnerPath(options.stateDir);
  const configPath = globalConfigPath(options.stateDir);
  fs.mkdirSync(path.dirname(runnerPath), { recursive: true });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.copyFileSync(fileURLToPath(import.meta.url), runnerPath);
  fs.copyFileSync(options.configPath, configPath);
  fs.chmodSync(runnerPath, 0o755);

  const plist = buildLaunchAgentPlist({
    ...options,
    runnerPath,
    installedConfigPath: configPath
  });
  fs.mkdirSync(path.dirname(launchAgentPath()), { recursive: true });
  fs.writeFileSync(launchAgentPath(), plist, 'utf8');

  const domain = `gui/${process.getuid()}`;
  runLaunchctl(['bootout', domain, launchAgentPath()]);
  const bootstrap = runLaunchctl(['bootstrap', domain, launchAgentPath()]);
  if (bootstrap.status !== 0) {
    throw new Error(bootstrap.stderr.trim() || 'launchctl bootstrap failed');
  }
  runLaunchctl(['kickstart', '-k', `${domain}/${LAUNCH_AGENT_LABEL}`]);

  const metadata = {
    version: TOOL_VERSION,
    installedAt: new Date().toISOString(),
    label: LAUNCH_AGENT_LABEL,
    runnerPath,
    configPath,
    plistPath: launchAgentPath(),
    repo: path.resolve(options.repo),
    intervalSeconds: options.launchIntervalSeconds,
    privacyBoundary: {
      diffContentRead: false,
      clinicalDatabaseRead: false,
      mailRead: false,
      privateDocContentRead: false,
      continuousModelCalls: false
    }
  };
  writeJsonFile(path.join(options.stateDir, 'runner-install.json'), metadata);
  return metadata;
}

function uninstallLaunchAgent(options) {
  if (process.platform !== 'darwin') {
    throw new Error('launchd uninstall is available only on macOS');
  }
  const domain = `gui/${process.getuid()}`;
  runLaunchctl(['bootout', domain, launchAgentPath()]);
  fs.rmSync(launchAgentPath(), { force: true });
  return {
    label: LAUNCH_AGENT_LABEL,
    removed: true,
    path: launchAgentPath(),
    stateDir: options.stateDir
  };
}

function parseArgs(argv) {
  const command = argv[2] ?? 'validate';
  const json = argv.includes('--json');
  const quiet = argv.includes('--quiet');
  const force = argv.includes('--force');
  const attentionExitZero = argv.includes('--attention-exit-zero');
  const configIndex = argv.indexOf('--config');
  const configPath = configIndex === -1 ? DEFAULT_CONFIG_PATH : path.resolve(argv[configIndex + 1]);
  const repoIndex = argv.indexOf('--repo');
  const repo = repoIndex === -1 ? process.cwd() : path.resolve(argv[repoIndex + 1]);
  const stateDirIndex = argv.indexOf('--state-dir');
  const stateDir = stateDirIndex === -1 ? defaultStateDir() : path.resolve(argv[stateDirIndex + 1]);
  const intervalIndex = argv.indexOf('--launch-interval-seconds');
  const launchIntervalSeconds = intervalIndex === -1 ? 900 : Math.max(300, Number.parseInt(argv[intervalIndex + 1], 10) || 900);
  return { command, json, quiet, force, attentionExitZero, configPath, repo, stateDir, launchIntervalSeconds };
}

export function run(argv = process.argv, stdout = process.stdout, stderr = process.stderr) {
  const { command, json, quiet, force, attentionExitZero, configPath, repo, stateDir, launchIntervalSeconds } = parseArgs(argv);
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

  if (command === 'run-once') {
    if (errors.length > 0) {
      stderr.write(`Cannot run invalid config:\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
      return 1;
    }
    const summary = runScheduledOnce(config, { repo, stateDir, configPath, force });
    if (!quiet) stdout.write(json ? `${JSON.stringify(summary, null, 2)}\n` : renderRunDigest(summary));
    return summary.status === 'needs_attention' && !attentionExitZero ? 2 : 0;
  }

  if (command === 'status') {
    const status = readStatus(stateDir);
    if (json) stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    else stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return 0;
  }

  if (command === 'install-global-runner') {
    if (errors.length > 0) {
      stderr.write(`Cannot install invalid config:\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
      return 1;
    }
    const result = installGlobalRunner({ repo, stateDir, configPath, launchIntervalSeconds });
    if (!quiet) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (command === 'uninstall-launch-agent') {
    const result = uninstallLaunchAgent({ stateDir });
    if (!quiet) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  stderr.write(`Unknown command: ${command}\n`);
  return 1;
}

const currentModulePath = fs.realpathSync(path.resolve(fileURLToPath(import.meta.url)));
const entrypointPath = process.argv[1] ? fs.realpathSync(path.resolve(process.argv[1])) : '';
if (currentModulePath === entrypointPath) {
  process.exitCode = run();
}
