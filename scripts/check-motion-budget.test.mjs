// @Codex
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { formatReport, scanMotionBudget, scanMotionBudgetDelta } from './check-motion-budget.mjs';

function withFixture(files, run) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-motion-budget-'));
  try {
    mkdirSync(path.join(rootDir, 'app'));
    mkdirSync(path.join(rootDir, 'components'));
    for (const [file, contents] of Object.entries(files)) {
      const target = path.join(rootDir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    return run(rootDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

test('riconosce le violazioni del contratto in CSS e TSX', () => {
  const result = withFixture({
    'app/surface.css': `
      .surface { animation: waiting 1s infinite; transition: all 200ms; }
      .shadow { transition: box-shadow 200ms ease; }
      @keyframes raised { to { box-shadow: 0 1px black; } }
      .filo { border-inline-start: 1px solid var(--lume-filo-fill); }
      .shimmer { animation: shimmer 1s infinite; }
      @keyframes shimmer { to { transform: translateX(1px); } }
    `,
    'components/card.tsx': '<div className="transition-all animate-pulse transition-[box-shadow] animate-[spin_1s_infinite]" />',
  }, (rootDir) => scanMotionBudget({ rootDir, allowlist: [] }));

  assert.deepEqual(new Set(result.violations.map((item) => item.rule)), new Set([
    'animazione infinita',
    'animazione ambientale shimmer o pulse',
    'transizione generica',
    'ombra animata',
    'filo usato come bordo',
  ]));
  assert.match(formatReport(result), /CONTRATTO VIOLATO/);
});

test('rispetta solo la allowlist con path, regola e dichiarazione esatti', () => {
  const files = {
    'components/spinner.css': '.spinner { animation: spin 900ms linear infinite; }',
  };
  const allowlist = [{
    path: 'components/spinner.css',
    rule: 'animazione infinita',
    snippet: 'animation: spin 900ms linear infinite',
    reason: 'Spinner transiente.',
  }];
  const allowed = withFixture(files, (rootDir) => scanMotionBudget({ rootDir, allowlist }));
  assert.equal(allowed.violations.length, 0);
  assert.equal(allowed.allowed, 1);

  const changed = withFixture({
    'components/spinner.css': '.spinner { animation: spin 1s linear infinite; }',
  }, (rootDir) => scanMotionBudget({ rootDir, allowlist }));
  assert.equal(changed.violations.length, 1);
});

test('una fixture senza moto vietato passa', () => {
  const result = withFixture({
    'app/lume.css': '@keyframes commitPulse { to { opacity: 1; } } .focal { animation: commitPulse 200ms ease; transition: opacity 165ms ease; }',
    'components/filo.tsx': '<svg className="lume-filo-draw" />',
  }, (rootDir) => scanMotionBudget({ rootDir, allowlist: [] }));
  assert.equal(result.violations.length, 0);
  assert.match(formatReport(result), /OK/);
});

test('collega un keyframe shimmer alla utility Tailwind infinita', () => {
  const result = withFixture({
    'components/shimmer.tsx': '<div className="animate-[shimmer_1.5s_infinite_linear]" />\n<style>{`@keyframes shimmer { to { opacity: 1; } }`}</style>',
  }, (rootDir) => scanMotionBudget({ rootDir, allowlist: [] }));
  assert.ok(result.violations.some((item) => item.snippet === '@keyframes shimmer'));
});

test('il gate incrementale conserva il debito ma blocca una nuova violazione', () => {
  withFixture({
    'app/surface.tsx': '<div className="transition-all" />',
  }, (rootDir) => {
    execFileSync('git', ['init', '-q'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.name', 'Motion Test'], { cwd: rootDir });
    execFileSync('git', ['add', '.'], { cwd: rootDir });
    execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: rootDir });

    writeFileSync(
      path.join(rootDir, 'app/surface.tsx'),
      '<div className="transition-all" />\n<div className="animate-pulse" />',
    );

    const result = scanMotionBudgetDelta({ rootDir, allowlist: [], baseRef: 'HEAD' });
    assert.equal(result.existing, 1);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].snippet, 'animate-pulse');
  });
});

test('un branch pulito confronta tutta la divergenza dal branch base', () => {
  withFixture({
    'app/surface.tsx': '<div />',
  }, (rootDir) => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.name', 'Motion Test'], { cwd: rootDir });
    execFileSync('git', ['add', '.'], { cwd: rootDir });
    execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: rootDir });
    execFileSync('git', ['switch', '-qc', 'feature'], { cwd: rootDir });

    writeFileSync(path.join(rootDir, 'app/surface.tsx'), '<div className="animate-pulse" />');
    execFileSync('git', ['add', '.'], { cwd: rootDir });
    execFileSync('git', ['commit', '-qm', 'introduce motion'], { cwd: rootDir });
    writeFileSync(path.join(rootDir, 'components/stable.tsx'), '<div />');
    execFileSync('git', ['add', '.'], { cwd: rootDir });
    execFileSync('git', ['commit', '-qm', 'later clean commit'], { cwd: rootDir });

    const result = scanMotionBudgetDelta({ rootDir, allowlist: [] });
    assert.equal(result.existing, 0);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].snippet, 'animate-pulse');
  });
});

test('un push multi-commit usa lo SHA precedente dichiarato da GitHub', () => {
  withFixture({
    'app/surface.tsx': '<div />',
  }, (rootDir) => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.name', 'Motion Test'], { cwd: rootDir });
    execFileSync('git', ['add', '.'], { cwd: rootDir });
    execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: rootDir });
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();

    writeFileSync(path.join(rootDir, 'app/surface.tsx'), '<div className="animate-pulse" />');
    execFileSync('git', ['add', '.'], { cwd: rootDir });
    execFileSync('git', ['commit', '-qm', 'introduce motion'], { cwd: rootDir });
    writeFileSync(path.join(rootDir, 'components/stable.tsx'), '<div />');
    execFileSync('git', ['add', '.'], { cwd: rootDir });
    execFileSync('git', ['commit', '-qm', 'later clean commit'], { cwd: rootDir });

    const eventPath = path.join(rootDir, 'push-event.json');
    writeFileSync(eventPath, JSON.stringify({ before }));
    const previousEventPath = process.env.GITHUB_EVENT_PATH;
    process.env.GITHUB_EVENT_PATH = eventPath;
    try {
      const result = scanMotionBudgetDelta({ rootDir, allowlist: [] });
      assert.equal(result.baseRef, before);
      assert.equal(result.violations.length, 1);
      assert.equal(result.violations[0].snippet, 'animate-pulse');
    } finally {
      if (previousEventPath === undefined) delete process.env.GITHUB_EVENT_PATH;
      else process.env.GITHUB_EVENT_PATH = previousEventPath;
    }
  });
});

test('una violazione spostata su un nuovo selettore non eredita il debito', () => {
  withFixture({
    'app/surface.css': '.old { transition: all 200ms; }',
  }, (rootDir) => {
    execFileSync('git', ['init', '-q'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.name', 'Motion Test'], { cwd: rootDir });
    execFileSync('git', ['add', '.'], { cwd: rootDir });
    execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: rootDir });

    writeFileSync(path.join(rootDir, 'app/surface.css'), '.new { transition: all 200ms; }');
    const result = scanMotionBudgetDelta({ rootDir, allowlist: [], baseRef: 'HEAD' });
    assert.equal(result.existing, 0);
    assert.equal(result.violations.length, 2);
    assert.ok(result.violations.every((violation) => violation.context === '.new'));
  });
});

test('una violazione TSX spostata fra elementi multilinea resta nuova', () => {
  withFixture({
    'components/panel.tsx': `
      export function Panel() {
        return <section>
          <button
            data-slot="old"
            className="transition-all"
          />
          <button data-slot="new" />
        </section>;
      }
    `,
  }, (rootDir) => {
    execFileSync('git', ['init', '-q'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: rootDir });
    execFileSync('git', ['config', 'user.name', 'Motion Test'], { cwd: rootDir });
    execFileSync('git', ['add', '.'], { cwd: rootDir });
    execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: rootDir });

    writeFileSync(path.join(rootDir, 'components/panel.tsx'), `
      export function Panel() {
        return <section>
          <button data-slot="old" />
          <button
            data-slot="new"
            className="transition-all"
          />
        </section>;
      }
    `);
    const result = scanMotionBudgetDelta({ rootDir, allowlist: [], baseRef: 'HEAD' });
    assert.equal(result.existing, 0);
    assert.equal(result.violations.length, 1);
    assert.ok(result.violations.every((violation) => violation.context.includes('data-slot="new"')));
  });
});
