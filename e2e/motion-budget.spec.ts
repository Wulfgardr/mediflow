/* @Codex */
import { test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

type MotionSample = { infinite: string[]; running: string[] };

async function sampleMotion(page: Page): Promise<MotionSample> {
  return page.evaluate(() => {
    const targetFor = (animation: Animation) =>
      animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
    const label = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return 'documento';
      return target.getAttribute('data-testid') || target.className || target.tagName.toLowerCase();
    };
    const active = document.getAnimations().filter((animation) => {
      const target = targetFor(animation);
      return animation.playState === 'running'
        && !(target instanceof Element && target.closest('[data-lume-direct-gesture="true"]'));
    });
    return {
      infinite: active
        .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
        .map((animation) => label(targetFor(animation))),
      running: active.map((animation) => label(targetFor(animation))),
    };
  });
}

async function assertQuietViewport(page: Page, view: string): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  const failures: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const sample = await sampleMotion(page);
    if (sample.infinite.length > 0) failures.push(`${view}, campione ${index}: loop ${sample.infinite.join(', ')}`);
    if (sample.running.length > 1) failures.push(`${view}, campione ${index}: ${sample.running.length} animazioni ${sample.running.join(', ')}`);
    await page.waitForTimeout(200);
  }
  if (failures.length > 0) throw new Error(`Budget di movimento Lume violato\n${failures.join('\n')}`);
}

test('budget Lume: nessun loop e un solo moto non gestuale per viewport', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await assertQuietViewport(page, 'cockpit');

  const patientHref = await page.locator('a[href^="/patients/"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).find((href) => href && href !== '/patients/new'),
  );
  if (patientHref) {
    await page.goto(patientHref);
    await assertQuietViewport(page, 'scheda paziente');
  }

  await page.goto('/settings');
  await assertQuietViewport(page, 'impostazioni');
});
