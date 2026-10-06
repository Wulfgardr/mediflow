import assert from 'node:assert/strict';
import { test, type Locator } from '@playwright/test';
import { expectActionableTouchTarget } from './actionable-touch-target';

type Geometry = { width: number; height: number; radius: string };
const compliant: Geometry = { width: 44, height: 44, radius: '12px' };

function target(before: Geometry, after = before, readinessError?: Error) {
  let geometry = before;
  const calls: string[] = [];
  const action = {
    async click(options: { trial?: boolean }) {
      assert.deepEqual(options, { trial: true });
      calls.push('trial');
      await Promise.resolve();
      if (readinessError) throw readinessError;
      geometry = after;
      calls.push('ready');
    },
    async evaluate() {
      calls.push('measure');
      return geometry;
    },
  } as unknown as Locator;
  return { action, calls };
}

test('touch target is measured after the awaited trial, without activating it', async () => {
  const before = { ...compliant, height: 43.999969482421875 };
  assert.throws(() => assert.ok(before.height >= 44));
  const fixture = target(before, compliant);
  await expectActionableTouchTarget(fixture.action);
  assert.deepEqual(fixture.calls, ['trial', 'ready', 'measure']);
});

for (const [name, geometry] of [
  ['persistent subpixel height', { ...compliant, height: 43.999969482421875 }],
  ['undersized height', { ...compliant, height: 40 }],
  ['undersized width', { ...compliant, width: 43 }],
  ['wrong radius', { ...compliant, radius: '11px' }],
] as const) {
  test(`touch target rejects ${name} after readiness`, async () => {
    const fixture = target(geometry);
    await assert.rejects(expectActionableTouchTarget(fixture.action));
    assert.deepEqual(fixture.calls, ['trial', 'ready', 'measure']);
  });
}

test('touch target propagates readiness failure without measuring', async () => {
  const failure = new Error('synthetic readiness failure');
  const fixture = target(compliant, compliant, failure);
  await assert.rejects(expectActionableTouchTarget(fixture.action), (error) => error === failure);
  assert.deepEqual(fixture.calls, ['trial']);
});
