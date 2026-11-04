import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
export default class AssertionsReporter implements Reporter {
  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    if (!['expect', 'test.step'].includes(step.category)) return;
    appendFileSync(path.join(process.env.VISUAL_091_OUTPUT!, 'assertions.jsonl'), JSON.stringify({
      test: test.titlePath(), step: step.titlePath(), category: step.category,
      durationMs: step.duration, status: step.error ? 'failed' : 'passed', error: step.error?.message,
    }) + '\n');
  }
}
