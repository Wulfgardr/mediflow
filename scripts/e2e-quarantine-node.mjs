import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadQuarantine, quarantineFor, reportQuarantine, root } from './e2e-quarantine.mjs';

export function evaluateNodeReport(events, entries, now = Date.now()) {
  const summaries = events.filter(event => event.type === 'test:summary' && !event.file);
  const failures = events.filter(event => event.type === 'test:fail');
  const leaves = failures.filter(event => event.failureType !== 'subtestsFailed');
  const decisions = leaves.map(failure => ({ failure, entry: quarantineFor({ ...failure, runner: 'node' }, entries, now) }));
  const summary = summaries.at(-1);
  const complete = summaries.length === 1 && !!summary && summary.counts.tests > 0 && summary.counts.cancelled === 0
    && summary.counts.failed === failures.length;
  return { complete, admitted: complete && leaves.length > 0 && decisions.every(decision => decision.entry), decisions };
}

export function runNodeWithQuarantine(command, options, { entries = loadQuarantine(), directory = join(root, 'test-results') } = {}) {
  mkdirSync(directory, { recursive: true });
  const report = join(directory, 'quarantine-node-events.jsonl');
  rmSync(report, { force: true });
  const index = command.indexOf('--test');
  if (index < 0) throw new Error('E2E_QUARANTINE_NODE_TEST_COMMAND_REQUIRED');
  const args = [...command];
  args.splice(index + 1, 0, '--test-reporter=spec', '--test-reporter-destination=stdout',
    `--test-reporter=${join(root, 'scripts/e2e-quarantine-node-reporter.mjs')}`, `--test-reporter-destination=${report}`);
  const result = spawnSync(process.execPath, args, options);
  if (result.error || result.signal || ![0, 1].includes(result.status)) return result;
  try {
    const events = readFileSync(report, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const evaluation = evaluateNodeReport(events, entries);
    if (!evaluation.complete) throw new Error('missing or inconsistent terminal summary');
    evaluation.decisions.forEach(({ failure, entry }) => { if (entry) reportQuarantine(failure, entry); });
    writeFileSync(join(directory, 'quarantine-node.json'), JSON.stringify({ originalExitCode: result.status,
      gateExitCode: result.status === 1 && evaluation.admitted ? 0 : result.status,
      decisions: evaluation.decisions }, null, 2));
    return result.status === 1 && evaluation.admitted ? { ...result, status: 0 } : result;
  } catch (error) {
    console.error(`E2E_QUARANTINE_REPORT_INVALID: ${error.message}`);
    return { ...result, status: result.status || 1 };
  }
}
