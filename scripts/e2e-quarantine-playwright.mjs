import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadQuarantine, quarantineFor, reportQuarantine, sourcePath } from './e2e-quarantine.mjs';

export default class QuarantineReporter {
  constructor(options = {}) { this.entries = loadQuarantine(options.manifestPath); this.directory = options.outputDir; this.globalErrors = []; }
  onBegin(config, suite) { this.config = config; this.suite = suite; }
  onError(error) { this.globalErrors.push(error); }
  resultFor(test, result) {
    return { runner: 'playwright', file: sourcePath(test.location.file), title: test.title,
      errors: result.errors.map(error => (error.message ?? error.value ?? '').replace(/^Error: /u, '')) };
  }
  onTestEnd(test, result) {
    if (!['failed', 'timedOut'].includes(result.status)) return;
    const failure = this.resultFor(test, result);
    const entry = quarantineFor(failure, this.entries);
    if (entry) {
      test.annotations.push({ type: 'quarantine', description: `${entry.id}; owner=${entry.owner}; expires=${entry.expiresAt}; ${entry.diagnosis}` });
      reportQuarantine(failure, entry);
    }
  }
  onEnd(result) {
    const failed = this.suite.allTests().filter(test => !test.ok());
    const decisions = failed.map(test => {
      const attempts = test.results.filter(attempt => ['failed', 'timedOut'].includes(attempt.status));
      const entries = attempts.map(attempt => quarantineFor(this.resultFor(test, attempt), this.entries));
      return { file: sourcePath(test.location.file), title: test.title,
        quarantined: attempts.length > 0 && test.results.every(attempt => ['failed', 'timedOut'].includes(attempt.status)) && entries.every(Boolean),
        entries: entries.filter(Boolean).map(entry => entry.id) };
    });
    const admitted = result.status === 'failed' && !this.globalErrors.length && decisions.length > 0 && decisions.every(test => test.quarantined);
    const directory = this.directory ?? join(this.config.rootDir, '..', 'test-results');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'quarantine-playwright.json'), JSON.stringify({ originalStatus: result.status,
      gateStatus: admitted ? 'passed-with-quarantine' : result.status, globalErrors: this.globalErrors, tests: decisions }, null, 2));
    // The list/HTML reporters retain the real failures. Only the gate changes.
    if (admitted) return { status: 'passed' };
  }
}
